import type { Browser, BrowserContext } from 'playwright-core';
import type { EngineMessage, EnvName, LoginPlan, PageResult, PlannedPage, RunJob, RunPlan, TestType } from '../shared/types';
import { launcher } from './browser';
import { applySessionStorage, login, logout, type LoginState } from './login';
import type { MonitorOptions } from './monitor';
import { countResults, jobStatus, type JobResult, type PageRecord } from './records';
import { Session } from './session';
import { LinkCache, routeMatcher } from './checks/links';
import { runCrud, runFlow } from './flows';
import { runSecurityScan } from './security/scan';
import { visitPage, type VisitOptions } from './visit';

// Test types that run a check on every page
const PAGE_CHECKS: TestType[] = ['a11y', 'perf', 'links', 'responsive', 'visual'];

const SMOKE_MENU_PAGES = 10;

type Emit = (m: EngineMessage) => void;

const pathKey = (url: string) => {
  const u = new URL(url);
  return u.pathname.replace(/\/+$/, '').toLowerCase() || '/';
};

/** Runs every job in the plan; environments in order, Smoke first within each. */
export class Runner {
  private cancelled = false;
  private session: Session | null = null;

  constructor(
    private plan: RunPlan,
    private emit: Emit,
  ) {}

  cancel() {
    this.cancelled = true;
  }

  /** Deletes the login state. Safe to call more than once (exit handlers). */
  cleanup() {
    this.session?.remove();
  }

  async run(): Promise<JobResult[]> {
    const results: JobResult[] = [];
    this.session = new Session();
    const launch = launcher(this.plan);
    const envs = [...new Set(this.plan.jobs.map((j) => j.env))];
    try {
      for (const env of envs) {
        const jobs = this.plan.jobs.filter((j) => j.env === env).sort((a, b) => Number(b.type === 'smoke') - Number(a.type === 'smoke'));
        results.push(...(await this.runEnv(env, jobs, launch)));
      }
    } finally {
      this.cleanup();
    }
    return results;
  }

  private async runEnv(env: EnvName, jobs: RunJob[], launch: (headless: boolean) => Promise<Browser>): Promise<JobResult[]> {
    const out: JobResult[] = [];
    const baseUrl = jobs[0].baseUrl;
    const loginPlan: LoginPlan = this.plan.logins[env] ?? { mode: 'skip', loginPath: '/login' };

    if (this.cancelled) return jobs.map((j) => this.cancelledJob(j, ''));

    this.emit({ kind: 'log', text: `${env}: ${loginPlan.mode === 'browser' ? 'log in in the browser window that opened' : loginPlan.mode === 'credentials' ? 'logging in' : 'login skipped'}` });
    const state = await login(loginPlan, baseUrl, this.session!, env, launch);
    this.emit({ kind: 'log', text: `${env}: ${state.detail}` });

    const browser = await launch(this.plan.browser.headless);
    try {
      const context = await browser.newContext({
        storageState: state.storageFile,
        ignoreHTTPSErrors: true,
        // Service workers could send requests the guard never sees
        serviceWorkers: 'block',
      });
      await applySessionStorage(context, new URL(baseUrl).origin, state.sessionStorage);

      // The security scan's role checks use a second, low-permission login
      let lowContext: BrowserContext | null = null;
      const lowPlan = this.plan.lowLogins[env];
      let lowState: LoginState | null = null;
      if (lowPlan && jobs.some((j) => j.type === 'security')) {
        this.emit({ kind: 'log', text: `${env}: second login (low permission)` });
        lowState = await login(lowPlan, baseUrl, this.session!, `${env}-low`, launch);
        this.emit({ kind: 'log', text: `${env}: second login: ${lowState.detail}` });
        if (lowState.ok) {
          lowContext = await browser.newContext({ storageState: lowState.storageFile, ignoreHTTPSErrors: true, serviceWorkers: 'block' });
          await applySessionStorage(lowContext, new URL(baseUrl).origin, lowState.sessionStorage);
        }
      }

      let gate: string | null = null;
      for (const job of jobs) {
        if (this.cancelled) {
          out.push(this.cancelledJob(job, state.appAccount));
          continue;
        }
        if (gate) {
          out.push({ ...this.emptyJob(job, state.appAccount), status: 'skipped', notes: [gate] });
          this.emit({ kind: 'job-end', env, type: job.type, status: 'skipped', counts: { passed: 0, failed: 0, skipped: 0, unverified: 0 } });
          continue;
        }
        const result = await this.runJob(job, browser, context, lowContext, loginPlan, state);
        out.push(result);
        if (job.type === 'smoke' && result.status === 'failed') gate = `Skipped: Smoke failed on ${env}`;
      }
      await context.close().catch(() => {});
      await lowContext?.close().catch(() => {});

      const loggedOut = await logout(browser, state, loginPlan, baseUrl);
      if (loggedOut) this.emit({ kind: 'log', text: `${env}: ${loggedOut}` });
      if (lowPlan && lowState) await logout(browser, lowState, lowPlan, baseUrl);
    } finally {
      await browser.close().catch(() => {});
    }
    return out;
  }

  private emptyJob(job: RunJob, appAccount: string): JobResult {
    const now = Date.now();
    return { env: job.env, type: job.type, baseUrl: job.baseUrl, startedAt: now, endedAt: now, status: 'unverified', records: [], notes: [], readOnly: job.type !== 'crud', appAccount };
  }

  private cancelledJob(job: RunJob, appAccount: string): JobResult {
    // Smoke's pages are only chosen at run time, so a cancelled Smoke has no rows
    const pages = job.type === 'smoke' ? [] : job.pages;
    const records = pages.map((p) => this.unverified(p, 'cancelled', 'The run was cancelled before this page'));
    return { ...this.emptyJob(job, appAccount), records, status: 'unverified', notes: ['Cancelled'] };
  }

  private unverified(p: PlannedPage, type: string, detail: string): PageRecord {
    return { route: p.route, kind: 'page', url: p.url, file: p.file, result: 'unverified', classification: type, problems: [{ type, severity: 'info', detail }], consoleErrors: 0, failedApi: 0, durationMs: 0 };
  }

  private monitorOptions(job: RunJob): MonitorOptions {
    return {
      ownOrigins: [new URL(job.baseUrl).origin, ...job.apiOrigins],
      readOnly: job.type !== 'crud',
      blockedEndpoints: this.plan.blockedEndpoints,
      readOnlyAllow: this.plan.readOnlyAllow,
    };
  }

  private async runJob(job: RunJob, browser: Browser, context: BrowserContext, lowContext: BrowserContext | null, loginPlan: LoginPlan, state: LoginState): Promise<JobResult> {
    const started = Date.now();
    const result: JobResult = { ...this.emptyJob(job, state.appAccount), startedAt: started };
    const checked = PAGE_CHECKS.includes(job.type);
    const visit: VisitOptions = {
      monitor: this.monitorOptions(job),
      readiness: this.plan.readiness,
      login: loginPlan,
      loggedIn: state.ok,
      // Tabs are opened by the types that look for broken views; the checks look at the page itself
      exploreTabs: job.type === 'regression' || job.type === 'impact',
      collectLinks: job.crawl || job.type === 'smoke',
      checks: checked
        ? {
            type: job.type,
            env: job.env,
            budgets: this.plan.budgets,
            contentSelector: this.plan.readiness.contentSelector,
            readyTimeoutMs: this.plan.readiness.readyTimeoutMs,
            visual: this.plan.visual,
            links: job.type === 'links' ? new LinkCache(context.request) : undefined,
            knownRoute: job.type === 'links' && !job.crawl ? routeMatcher(job.pages.map((p) => p.route)) : null,
          }
        : undefined,
    };
    result.notes.push(...(job.notes ?? []));
    if (!state.ok && loginPlan.mode !== 'skip') result.notes.push(state.detail);

    if (job.type === 'smoke') await this.smoke(job, context, visit, state, loginPlan, result);
    else if (job.type === 'flows') await this.flows(job, context, result);
    else if (job.type === 'crud') await this.crud(job, context, result);
    else if (job.type === 'security') await this.security(job, browser, context, lowContext, visit, loginPlan, state, result);
    else await this.pages(job, context, visit, result);

    result.endedAt = Date.now();
    result.status = jobStatus(result.records);
    this.emit({ kind: 'job-end', env: job.env, type: job.type, status: result.status, counts: countResults(result.records) });
    return result;
  }

  /** Critical flows, one at a time (a journey may depend on the state the previous one left). */
  private async flows(job: RunJob, context: BrowserContext, result: JobResult) {
    const flows = job.flows ?? [];
    this.emit({ kind: 'job-start', env: job.env, type: job.type, pages: flows.length });
    if (!flows.length) result.notes.push('No critical flows recorded yet: record them on the Flows screen');
    for (const flow of flows) {
      if (this.cancelled) break;
      // Writes only when the flow allows them, and never on Live
      const mo = { ...this.monitorOptions(job), readOnly: !(flow.allowWrites && job.env !== 'live') };
      this.emit({ kind: 'page-start', env: job.env, type: job.type, route: flow.name });
      this.record(job, result, await runFlow(context, flow, job.baseUrl, mo, this.plan.readiness), flows.length);
    }
  }

  /** CRUD on each chosen screen: create, read, update, delete a QAgent-… record. Never on Live. */
  private async crud(job: RunJob, context: BrowserContext, result: JobResult) {
    if (job.env === 'live') throw new Error('CRUD never runs on Live');
    const defs = job.crud ?? [];
    this.emit({ kind: 'job-start', env: job.env, type: job.type, pages: defs.length * 4 });
    if (!defs.length) result.notes.push('No CRUD screens recorded yet: record them on the Flows screen');
    for (const def of defs) {
      if (this.cancelled) break;
      this.emit({ kind: 'page-start', env: job.env, type: job.type, route: def.name });
      for (const row of await runCrud(context, def, job.baseUrl, this.monitorOptions(job), this.plan.readiness)) this.record(job, result, row, defs.length * 4);
    }
  }

  /** Security scan: one row per check, findings for the sheet. */
  private async security(job: RunJob, browser: Browser, context: BrowserContext, lowContext: BrowserContext | null, visit: VisitOptions, loginPlan: LoginPlan, state: LoginState, result: JobResult) {
    this.emit({ kind: 'job-start', env: job.env, type: job.type, pages: 16 });
    result.findings = await runSecurityScan({
      job,
      plan: this.plan,
      browser,
      context,
      lowContext,
      loginPlan,
      loggedIn: state.ok,
      monitor: visit.monitor,
      isCancelled: () => this.cancelled,
      onStart: (route) => this.emit({ kind: 'page-start', env: job.env, type: job.type, route }),
      onRow: (row) => this.record(job, result, row, 16),
    });
  }

  /** Visits a page, announcing it first so the app can show what is being tested right now. */
  private visit(job: RunJob, context: BrowserContext, p: PlannedPage, opts: VisitOptions) {
    if (p.url && !p.skip) this.emit({ kind: 'page-start', env: job.env, type: job.type, route: p.route });
    return visitPage(context, p, opts);
  }

  private record(job: RunJob, result: JobResult, rec: PageRecord, total: number) {
    result.records.push(rec);
    if (rec.kind === 'tab') return;
    const done = result.records.filter((r) => r.kind !== 'tab').length;
    this.emit({ kind: 'page', env: job.env, type: job.type, route: rec.route, step: rec.kind, part: rec.kind === 'crud' || rec.kind === 'flow' || rec.kind === 'check' ? rec.tabPath : undefined, result: rec.result, reason: rec.classification, done, total, file: rec.file });
  }

  /** Site answers → login worked → home and top menu pages load. No tabs. */
  private async smoke(job: RunJob, context: BrowserContext, visit: VisitOptions, state: LoginState, loginPlan: LoginPlan, result: JobResult) {
    const home = new URL(loginPlan.loggedInPath ?? '/', job.baseUrl).toString();
    const step = (route: string, kind: 'site' | 'login', res: PageResult, type: string, detail: string, ms = 0): PageRecord => ({
      route, kind, url: job.baseUrl, result: res, classification: type, problems: [{ type, severity: res === 'failed' ? 'error' : 'info', detail }], consoleErrors: 0, failedApi: 0, durationMs: ms,
    });
    this.emit({ kind: 'job-start', env: job.env, type: job.type, pages: job.smokeList.length || SMOKE_MENU_PAGES });

    // 1. The site answers at all
    const t0 = Date.now();
    const res = await context.request.get(job.baseUrl, { timeout: 30_000, maxRedirects: 10 }).catch((e: Error) => e);
    if (res instanceof Error || res.status() >= 500) {
      const detail = res instanceof Error ? res.message.split('\n')[0] : `HTTP ${res.status()}`;
      this.record(job, result, step('/', 'site', 'failed', 'site-down', `${job.baseUrl} did not answer: ${detail}`, Date.now() - t0), 1);
      return;
    }
    this.record(job, result, step('/', 'site', 'passed', 'ok', `HTTP ${res.status()}`, Date.now() - t0), 0);

    // 2. Login worked
    if (loginPlan.mode === 'skip') this.record(job, result, step(loginPlan.loginPath, 'login', 'unverified', 'login-skipped', 'Login was skipped; pages behind login are not checked'), 0);
    else this.record(job, result, step(loginPlan.loginPath, 'login', state.ok ? 'passed' : 'failed', state.ok ? 'ok' : 'login-failed', state.detail, state.durationMs), 0);
    if (loginPlan.mode !== 'skip' && !state.ok) return;

    // 3. Home page, then the configured Smoke list or the top menu pages found on it
    const known = new Map(job.pages.map((p) => [p.url ? pathKey(p.url) : p.route, p]));
    const homeVisit = await this.visit(job, context, known.get(pathKey(home)) ?? { route: new URL(home).pathname, url: home, exploreTabs: false }, visit);
    const listed = (job.smokeList.length ? job.smokeList.map((r) => new URL(r, job.baseUrl).toString()) : homeVisit.menuLinks)
      .filter((u) => pathKey(u) !== pathKey(home) && pathKey(u) !== loginPlan.loginPath.toLowerCase())
      .slice(0, job.smokeList.length || SMOKE_MENU_PAGES);
    const total = listed.length + 1;
    for (const r of homeVisit.records) this.record(job, result, r, total);
    if (!job.smokeList.length) result.notes.push(listed.length ? `Smoke pages: home + ${listed.length} top menu page(s)` : 'No menu links found on the home page: only the home page was checked');

    const queue: PlannedPage[] = listed.map((u) => known.get(pathKey(u)) ?? { route: new URL(u).pathname, url: u, exploreTabs: false });
    await this.pool(queue, async (p) => {
      for (const r of (await this.visit(job, context, p, visit)).records) this.record(job, result, r, total);
    });
  }

  /** Every planned page with its tabs; with crawl on, links found on each page join the queue. */
  private async pages(job: RunJob, context: BrowserContext, visit: VisitOptions, result: JobResult) {
    const queue: PlannedPage[] = [...job.pages];
    const seen = new Set(job.pages.map((p) => (p.url ? pathKey(p.url) : `pattern:${p.route}`)));
    if (job.crawl) {
      const start = new URL(visit.login?.loggedInPath ?? '/', job.baseUrl).toString();
      if (!seen.has(pathKey(start))) {
        queue.unshift({ route: new URL(start).pathname, url: start, exploreTabs: true });
        seen.add(pathKey(start));
      }
    }
    this.emit({ kind: 'job-start', env: job.env, type: job.type, pages: queue.length });
    let limitHit = false;

    await this.pool(queue, async (p) => {
      const outcome = await this.visit(job, context, p, visit);
      for (const r of outcome.records) this.record(job, result, r, queue.length);
      if (!job.crawl) return;
      for (const link of outcome.links) {
        const key = pathKey(link);
        if (seen.has(key)) continue;
        if (seen.size >= job.crawlLimit) {
          limitHit = true;
          break;
        }
        seen.add(key);
        const u = new URL(link);
        queue.push({ route: u.pathname, url: `${u.origin}${u.pathname}`, exploreTabs: true });
      }
    });

    // Pages the pool never started (cancel); each visit adds exactly one non-tab record
    for (const p of queue.slice(result.records.filter((r) => r.kind !== 'tab').length)) result.records.push(this.unverified(p, 'cancelled', 'The run was cancelled before this page'));
    if (job.crawl) result.notes.push(`Crawled ${seen.size} page(s)${limitHit ? ` — page limit ${job.crawlLimit} reached` : ''}`);
    if (this.cancelled) result.notes.push('Cancelled: pages not reached are unverified');
  }

  /** Runs `work` over a queue that may grow while it runs, `workers` at a time. */
  private async pool(queue: PlannedPage[], work: (p: PlannedPage) => Promise<void>) {
    const n = Math.max(1, this.plan.workers);
    const running = new Set<Promise<void>>();
    let next = 0;
    while (running.size || (!this.cancelled && next < queue.length)) {
      while (!this.cancelled && running.size < n && next < queue.length) {
        const task: Promise<void> = work(queue[next++]).finally(() => running.delete(task));
        running.add(task);
      }
      await Promise.race(running);
    }
  }
}
