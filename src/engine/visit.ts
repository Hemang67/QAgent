import type { BrowserContext, Page } from 'playwright-core';
import type { Budgets, EnvName, LoginPlan, PlannedPage, Problem, Readiness, TestType, VisualSettings } from '../shared/types';
import { assessView } from './assess';
import { checkA11y } from './checks/a11y';
import { checkLinks, type LinkCache } from './checks/links';
import { checkPerf } from './checks/perf';
import { checkResponsive } from './checks/responsive';
import { checkVisual } from './checks/visual';
import { PageMonitor, type MonitorOptions, type NetworkEvent } from './monitor';
import { contentRoot, guardDialogs, inspectContent, waitForReady } from './readiness';
import type { PageRecord } from './records';
import { exploreTabs } from './tabs';

// Opening these would end the session (or is pointless to test)
export const LOGOUT_PATH = /(^|\/)(log-?out|sign-?out|logoff|sign_out|log_out)(\/|$|\?)/i;
const NOT_A_PAGE = /\.(pdf|zip|csv|xlsx?|docx?|pptx?|png|jpe?g|gif|svg|webp|ico|mp4|mp3|json|xml|txt)$/i;

export interface VisitOptions {
  monitor: MonitorOptions;
  readiness: Readiness;
  login: LoginPlan | undefined;
  loggedIn: boolean;
  exploreTabs: boolean;
  /** Collect same-origin links for the crawler */
  collectLinks: boolean;
  /** The test type's own check, run on every page that rendered */
  checks?: PageChecks;
}

export interface PageChecks {
  type: TestType;
  env: EnvName;
  budgets: Budgets;
  contentSelector: string;
  readyTimeoutMs: number;
  visual: VisualSettings;
  links?: LinkCache;
  knownRoute?: ((pathname: string) => boolean) | null;
}

const runCheck = async (c: PageChecks, page: Page, monitor: PageMonitor, rec: PageRecord, network: NetworkEvent[], waitReady: () => Promise<unknown>): Promise<Problem[]> => {
  switch (c.type) {
    case 'a11y':
      return checkA11y(page, (await firstMatching(page, c.contentSelector)) ?? 'body');
    case 'perf':
      return checkPerf(rec.perf!, monitor.apiTimings, c.budgets);
    case 'links':
      return checkLinks(page, c.links!, network, c.knownRoute ?? null);
    case 'responsive':
      return checkResponsive(page, waitReady, c.readyTimeoutMs);
    case 'visual':
      return checkVisual(page, c.env, rec.route, c.visual);
    default:
      return [];
  }
};

/** The first selector of a comma list that exists on the page (axe needs one concrete selector). */
const firstMatching = async (page: Page, list: string) => {
  for (const s of list.split(',').map((x) => x.trim())) if ((await page.locator(s).count().catch(() => 0)) > 0) return s;
  return null;
};

export interface VisitOutcome {
  records: PageRecord[];
  links: string[];
  /** Links inside the site's navigation (nav, header, sidebar): the top menu pages */
  menuLinks: string[];
}

const MENU_SCOPE = 'nav, [role="navigation"], header, aside, [class*="sidebar" i], [class*="navbar" i], [class*="menu" i]';

const samePath = (a: string, b: string) => a.replace(/\/+$/, '').toLowerCase() === b.replace(/\/+$/, '').toLowerCase();
const pathOf = (url: string) => new URL(url).pathname;

const blank = (p: PlannedPage, o: Partial<PageRecord>): PageRecord => ({
  route: p.route,
  kind: 'page',
  url: p.url,
  file: p.file,
  result: 'unverified',
  classification: '',
  problems: [],
  consoleErrors: 0,
  failedApi: 0,
  durationMs: 0,
  ...o,
});

/** Largest Contentful Paint as observed by the browser for the current document. */
const readLcp = (page: Page) =>
  page
    .evaluate(
      () =>
        new Promise<number | null>((resolve) => {
          let last: number | null = null;
          try {
            const po = new PerformanceObserver((list) => {
              for (const e of list.getEntries()) last = e.startTime;
            });
            po.observe({ type: 'largest-contentful-paint', buffered: true });
            setTimeout(() => {
              po.disconnect();
              resolve(last === null ? null : Math.round(last));
            }, 50);
          } catch {
            resolve(null);
          }
        }),
    )
    .catch(() => null);

/** Same-origin page links on the current page (optionally only inside `scope`), as absolute URLs without hash. */
export const pageLinks = async (page: Page, origin: string, scope?: string): Promise<string[]> => {
  const hrefs: string[] = await page
    .evaluate(
      (scope) =>
        [...document.querySelectorAll(scope ? scope.split(',').map((s) => `${s.trim()} a[href]`).join(', ') : 'a[href]')].map((a) => (a as HTMLAnchorElement).href),
      scope ?? null,
    )
    .catch(() => []);
  const out = new Set<string>();
  for (const h of hrefs) {
    try {
      const u = new URL(h);
      if (u.origin !== origin || NOT_A_PAGE.test(u.pathname) || LOGOUT_PATH.test(u.pathname)) continue;
      u.hash = '';
      out.add(u.toString());
    } catch {
      // mailto:, javascript: and similar
    }
  }
  return [...out];
};

export const visitPage = async (context: BrowserContext, p: PlannedPage, o: VisitOptions): Promise<VisitOutcome> => {
  if (p.skip) return { records: [blank(p, { result: 'skipped', classification: 'configured-skip', problems: [{ type: 'configured-skip', severity: 'info', detail: p.skip }] })], links: [], menuLinks: [] };
  if (!p.url) {
    return {
      records: [blank(p, { classification: 'missing-test-data', problems: [{ type: 'missing-test-data', severity: 'info', detail: p.missing ?? 'No URL' }] })],
      links: [],
      menuLinks: [],
    };
  }
  if (LOGOUT_PATH.test(pathOf(p.url))) {
    return { records: [blank(p, { result: 'skipped', classification: 'logout-page', problems: [{ type: 'logout-page', severity: 'info', detail: 'Opening it would end the session' }] })], links: [], menuLinks: [] };
  }

  const started = Date.now();
  const page = await context.newPage();
  const monitor = new PageMonitor(page, o.monitor);
  const dialogs: string[] = [];
  try {
    await monitor.attach();
    guardDialogs(page, dialogs);
    const r = o.readiness;

    monitor.touch();
    let response;
    try {
      response = await page.goto(p.url, { waitUntil: 'domcontentloaded', timeout: r.readyTimeoutMs });
    } catch (e) {
      const msg = (e as Error).message.split('\n')[0];
      return { records: [blank(p, { result: 'failed', classification: 'navigation-failed', problems: [{ type: 'navigation-failed', severity: 'error', detail: msg }], durationMs: Date.now() - started })], links: [], menuLinks: [] };
    }
    const ready = await waitForReady(page, monitor, page.locator('body > *'), r);
    const loadToReadyMs = Math.max(0, Date.now() - started - (ready.ready ? r.quietWindowMs : 0));

    const finalUrl = page.url();
    const finalPath = pathOf(finalUrl);
    const expectedPath = pathOf(p.url);
    const loginPath = o.login?.loginPath ?? '/login';
    const homePaths = ['/', o.login?.loggedInPath].filter(Boolean) as string[];
    const toLogin = !samePath(expectedPath, loginPath) && samePath(finalPath, loginPath);
    // "/" forwarding to the logged-in page is the normal landing, not a missing permission
    const toHome = !samePath(expectedPath, '/') && !samePath(finalPath, expectedPath) && homePaths.some((h) => samePath(finalPath, h));

    const root = await contentRoot(page, r.contentSelector);
    const content = await inspectContent(root);
    const all = monitor.since({ console: 0, network: 0, api: 0, blocked: 0 });
    const a = assessView({
      ready,
      content,
      console: all.console,
      network: all.network,
      apiRequests: all.apiRequests,
      blocked: all.blocked,
      documentStatus: response?.status() ?? null,
    });

    const rec = blank(p, {
      finalUrl,
      heading: content.heading,
      result: a.result,
      classification: a.classification,
      problems: a.problems,
      consoleErrors: all.console.filter((c) => c.severity === 'error').length,
      failedApi: all.network.filter((n) => n.severity === 'error').length,
    });

    // Being sent to the login page means the page was not really checked
    if (toLogin) {
      rec.result = 'unverified';
      rec.classification = o.loggedIn ? 'session-rejected' : 'login-required';
      rec.problems.unshift({
        type: rec.classification,
        severity: 'info',
        detail: o.loggedIn ? `Redirected to ${finalPath}: the session was not accepted` : `Redirected to ${finalPath}: login was skipped`,
      });
    } else if (toHome && !o.loggedIn) {
      rec.result = 'unverified';
      rec.classification = 'login-required';
      rec.problems.unshift({ type: 'login-required', severity: 'info', detail: `Redirected to ${finalPath}; login was skipped` });
    } else if (toHome) {
      rec.result = 'skipped';
      rec.classification = 'inaccessible-permission';
      rec.problems.unshift({ type: 'inaccessible-permission', severity: 'info', detail: `Redirected to ${finalPath}: the account may not open this page` });
    } else if (!samePath(finalPath, expectedPath)) {
      rec.problems.push({ type: 'redirected', severity: 'warning', detail: `Landed on ${finalPath}` });
    }
    for (const d of dialogs) rec.problems.push({ type: 'dialog', severity: 'warning', detail: `Dismissed ${d}` });

    const slowest = [...monitor.apiTimings].sort((x, y) => y.ms - x.ms)[0] ?? null;
    rec.perf = {
      loadToReadyMs,
      lcpMs: await readLcp(page),
      apiCalls: monitor.apiTimings.length,
      slowestApi: slowest ? { method: slowest.method, url: slowest.url, ms: slowest.ms } : null,
    };

    const records = [rec];
    const rendered = rec.result === 'passed' || (rec.result === 'failed' && !content.errorScreen && rec.classification !== 'page-http-error');
    if (o.exploreTabs && rendered) records.push(...(await exploreTabs(page, monitor, root, p.route, r)));

    // Links are read before the type check: Responsive reloads the page at other widths
    const collect = o.collectLinks && !toLogin;
    const origin = new URL(p.url).origin;
    const links = collect ? await pageLinks(page, origin) : [];
    const menuLinks = collect ? await pageLinks(page, origin, MENU_SCOPE) : [];

    // The test type's own check, only on a page that really rendered
    if (o.checks && rendered) {
      const problems = await runCheck(o.checks, page, monitor, rec, all.network, () => waitForReady(page, monitor, page.locator('body > *'), r));
      rec.problems.push(...problems);
      const error = problems.find((x) => x.severity === 'error');
      if (error) {
        if (rec.result === 'passed') rec.classification = error.type;
        rec.result = 'failed';
      } else if (rec.classification === 'ok' && problems.some((x) => x.severity === 'warning')) {
        rec.classification = 'passed-with-warnings';
      }
    }
    rec.durationMs = Date.now() - started;
    return { records, links, menuLinks };
  } catch (e) {
    // A QAgent or browser problem (crashed tab, closed context): not a verdict on the page
    const detail = (e as Error).message.split('\n')[0];
    return { records: [blank(p, { classification: 'qagent-error', problems: [{ type: 'qagent-error', severity: 'info', detail }], durationMs: Date.now() - started })], links: [], menuLinks: [] };
  } finally {
    await page.close().catch(() => {});
  }
};
