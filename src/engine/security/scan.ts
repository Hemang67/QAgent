import type { Browser, BrowserContext } from 'playwright-core';
import type { LoginPlan, RunJob, RunPlan } from '../../shared/types';
import type { MonitorOptions } from '../monitor';
import type { PageRecord } from '../records';
import { checkExposed, checkLoggedOut, checkRateLimit, checkRedirects, checkReflectedXss, checkRoles, checkSql, checkStoredXss } from './active';
import { isFullScan, rateFor, SafeClient, ScanBlocked, type Finding } from './client';
import { checkCookies, checkHeaders, checkLeaks, checkStorageTokens, checkTls, survey } from './passive';
import { checkLibraries, checkSecrets, NotChecked } from './project';

const MAX_PAGES = 40;
const RANK = { Critical: 0, High: 1, Medium: 2, Low: 3 };

export interface ScanInput {
  job: RunJob;
  plan: RunPlan;
  browser: Browser;
  context: BrowserContext;
  /** Logged in as the low-permission user, when one was given */
  lowContext: BrowserContext | null;
  loginPlan: LoginPlan;
  loggedIn: boolean;
  monitor: MonitorOptions;
  isCancelled: () => boolean;
  onStart: (check: string) => void;
  onRow: (row: PageRecord) => void;
}

const row = (check: string, o: Partial<PageRecord>): PageRecord => ({ route: check, kind: 'check', url: null, result: 'passed', classification: 'ok', problems: [], consoleErrors: 0, failedApi: 0, durationMs: 0, ...o });

const unverified = (check: string, type: string, detail: string) => row(check, { result: 'unverified', classification: type, problems: [{ type, severity: 'info', detail }] });

const summarise = (check: string, found: Finding[], ms: number): PageRecord => {
  const worst = [...found].sort((a, b) => RANK[a.severity] - RANK[b.severity])[0];
  const failed = found.some((f) => f.severity !== 'Low');
  return row(check, {
    tabPath: found.length ? `${found.length} finding(s)` : 'Nothing found',
    result: failed ? 'failed' : 'passed',
    classification: worst ? worst.severity.toLowerCase() : 'ok',
    problems: found.map((f) => ({ type: f.severity.toLowerCase(), severity: f.severity === 'Low' ? 'warning' : 'error', detail: `${f.url}: ${f.evidence}` })),
    durationMs: ms,
  });
};

/** Runs every check the environment allows; returns the findings for the sheet. */
export const runSecurityScan = async (i: ScanInput): Promise<Finding[]> => {
  const { job, plan, loginPlan, monitor: mo } = i;
  const r = plan.readiness;
  const full = isFullScan(job.env);
  const findings: Finding[] = [];
  const rps = rateFor(job.env);
  const client = new SafeClient(i.context.request, mo.ownOrigins, plan.blockedEndpoints, rps);
  const anon = await i.browser.newContext({ ignoreHTTPSErrors: true, serviceWorkers: 'block' });
  const anonClient = new SafeClient(anon.request, mo.ownOrigins, plan.blockedEndpoints, rps, client);

  const check = async (name: string, fn: () => Promise<Finding[]>) => {
    if (i.isCancelled()) return i.onRow(unverified(name, 'cancelled', 'The run was cancelled before this check'));
    if (client.blockedBy) return i.onRow(unverified(name, 'blocked-by-firewall', `Not run: ${client.blockedBy}`));
    i.onStart(name);
    const started = Date.now();
    try {
      const found = await fn();
      findings.push(...found);
      i.onRow(summarise(name, found, Date.now() - started));
    } catch (e) {
      if (e instanceof ScanBlocked) {
        const f: Finding = { severity: 'Low', check: name, url: job.baseUrl, evidence: `The scan stopped: ${e.message}`, fix: 'Tell the server owner before the next scan' };
        findings.push(f);
        i.onRow(unverified(name, 'blocked-by-firewall', e.message));
      } else if (e instanceof NotChecked) i.onRow(unverified(name, 'not-checked', e.message));
      else i.onRow(unverified(name, 'qagent-error', (e as Error).message.split('\n')[0]));
    }
  };
  const refused = (name: string, why: string) => i.onRow(row(name, { result: 'skipped', classification: 'not-on-this-environment', problems: [{ type: 'configured-skip', severity: 'info', detail: why }] }));

  try {
    // Project files: nothing is sent to the site
    await check('Vulnerable libraries', () => checkLibraries(plan.projectRoot));
    await check('Secrets in code', () => checkSecrets(plan.projectRoot));

    // Passive: what the site sends during ordinary read-only page visits
    const home = new URL(loginPlan.loggedInPath ?? '/', job.baseUrl).toString();
    const pages = job.pages.filter((p) => p.url).slice(0, MAX_PAGES);
    const sample = pages.length ? pages : [{ route: new URL(home).pathname, url: home, exploreTabs: false }];
    i.onStart('Page survey');
    const s = await survey(i.context, sample, mo, r, loginPlan.loginPath);
    i.onRow(row('Page survey', { tabPath: `${s.pages.length} page(s), ${s.apis.size} API call(s)`, result: s.pages.length ? 'passed' : 'unverified', classification: s.pages.length ? 'ok' : 'no-pages-opened', problems: s.pages.length ? [] : [{ type: 'no-pages-opened', severity: 'info', detail: 'No page could be opened: passive checks saw nothing' }] }));
    if (!s.pages.length) return findings;

    await check('Security headers', async () => checkHeaders(s, job.baseUrl));
    await check('Cookies', () => checkCookies(i.context, job.baseUrl));
    await check('HTTPS / TLS', () => checkTls(s, job.baseUrl));
    await check('Information leaks', () => checkLeaks(s, client));
    await check('Tokens in browser storage', async () => checkStorageTokens(s));

    // Active, GET only and spaced out; these stop at the first sign of a firewall
    await check('Exposed files and URLs', () => checkExposed(client, job.baseUrl, job.env));
    await check('Logged-out access', async () => {
      if (!i.loggedIn) throw new NotChecked('Needs a login to compare with: log in for this run');
      return checkLoggedOut(anonClient, anon, s, mo, r, loginPlan.loginPath);
    });
    await check('Role checks (IDOR)', async () => {
      if (!i.lowContext) throw new NotChecked('Needs a second, low-permission login');
      return checkRoles(i.lowContext, s, job.pages.filter((p) => p.url && /[:?]/.test(p.route + (new URL(p.url).search ? '?' : ''))).map((p) => p.route), mo, r, loginPlan.loginPath);
    });
    await check('Open redirect', () => checkRedirects(client, s, job.baseUrl, loginPlan.loginPath));
    await check('Reflected XSS', () => checkReflectedXss(client, i.context, s, mo, r));
    await check('SQL injection signals', () => checkSql(client, s));

    // These can save data or lock accounts: Local and Dev only
    if (full) {
      await check('Stored XSS', async () => {
        const { findings: f, saved } = await checkStoredXss(i.context, s, mo, r, job.env);
        if (saved.length) f.push({ severity: 'Low', check: 'Stored XSS', url: saved[0], evidence: `Test entries containing "qagent" were saved through ${saved.length} form(s): ${saved.join(', ')}`, fix: 'Delete these test entries' });
        return f;
      });
      await check('Login rate limit', () => checkRateLimit(i.browser, loginPlan, job.baseUrl, job.env));
    } else {
      refused('Stored XSS', 'Saves data, so it runs on Local and Dev only');
      refused('Login rate limit', 'Could lock accounts, so it runs on Local and Dev only');
    }
    return findings;
  } finally {
    await anon.close().catch(() => {});
  }
};
