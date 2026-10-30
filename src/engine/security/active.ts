import type { Browser, BrowserContext, Page } from 'playwright-core';
import type { EnvName, LoginPlan, Readiness } from '../../shared/types';
import { fillLoginForm } from '../login';
import { PageMonitor, type MonitorOptions } from '../monitor';
import { waitForReady } from '../readiness';
import { isFullScan, type Finding, type SafeClient } from './client';
import { NotChecked } from './project';
import type { Survey } from './passive';

const looksLikeData = (body: string) => {
  try {
    const d = JSON.parse(body);
    return Array.isArray(d) ? d.length > 0 : !!d && typeof d === 'object' && Object.keys(d).length > 0;
  } catch {
    return false;
  }
};

// Fixed list; each answer must look like the real thing, since single-page apps answer 200 to any path
const EXPOSED: { path: string; looksReal: (b: string) => boolean; what: string; severity: Finding['severity'] }[] = [
  ...['/.env', '/.env.local', '/.env.production'].map((path) => ({ path, looksReal: (b: string) => /^\s*[A-Z][A-Z0-9_]+\s*=/m.test(b) && !/<html/i.test(b), what: 'Environment file with settings', severity: 'Critical' as const })),
  { path: '/.git/HEAD', looksReal: (b) => /^ref: refs\//.test(b), what: 'Git repository', severity: 'Critical' },
  { path: '/.git/config', looksReal: (b) => /\[core\]/.test(b), what: 'Git repository', severity: 'Critical' },
  ...['/backup.sql', '/dump.sql', '/db.sql'].map((path) => ({ path, looksReal: (b: string) => /CREATE TABLE|INSERT INTO/i.test(b), what: 'Database dump', severity: 'Critical' as const })),
  { path: '/phpinfo.php', looksReal: (b) => /phpinfo\(\)|PHP Version/.test(b), what: 'PHP configuration page', severity: 'High' },
  { path: '/server-status', looksReal: (b) => /Apache Server Status/i.test(b), what: 'Server status page', severity: 'Medium' },
  { path: '/actuator/env', looksReal: (b) => /"propertySources"/.test(b), what: 'Spring actuator', severity: 'High' },
  { path: '/elmah.axd', looksReal: (b) => /Error Log for/i.test(b), what: '.NET error log', severity: 'High' },
];
const SWAGGER = ['/swagger.json', '/swagger/v1/swagger.json', '/v2/api-docs', '/v3/api-docs', '/openapi.json'];

export const checkExposed = async (client: SafeClient, baseUrl: string, env: EnvName): Promise<Finding[]> => {
  const found: Finding[] = [];
  for (const e of EXPOSED) {
    const r = await client.get(new URL(e.path, baseUrl).toString());
    if (r && r.res.status() === 200 && e.looksReal(r.body)) found.push({ severity: e.severity, check: 'Exposed files and URLs', url: new URL(e.path, baseUrl).toString(), evidence: `${e.what} is publicly reachable`, fix: 'Block this path on the server and remove the file from the web root' });
  }
  // API documentation is fine during development, not in production
  if (env === 'live') {
    for (const p of SWAGGER) {
      const r = await client.get(new URL(p, baseUrl).toString());
      if (r && r.res.status() === 200 && /"(swagger|openapi)"\s*:/.test(r.body)) found.push({ severity: 'Medium', check: 'Exposed files and URLs', url: new URL(p, baseUrl).toString(), evidence: 'API documentation is public on Live', fix: 'Turn it off in production or put it behind a login' });
    }
  }
  return found;
};

/** The app's data APIs called with no session at all, and pages opened logged out. */
export const checkLoggedOut = async (anonClient: SafeClient, anon: BrowserContext, s: Survey, mo: MonitorOptions, r: Readiness, loginPath: string): Promise<Finding[]> => {
  const found: Finding[] = [];
  for (const url of [...s.apis.keys()].slice(0, 50)) {
    const res = await anonClient.get(url);
    if (res && res.res.status() === 200 && looksLikeData(res.body)) found.push({ severity: 'High', check: 'Logged-out access', url, evidence: `The API returned ${res.body.length} bytes of data with no login`, fix: 'Require a valid session on this endpoint, or confirm that the data is meant to be public' });
  }
  for (const p of s.pages.slice(0, 15)) {
    const page = await anon.newPage();
    try {
      const monitor = new PageMonitor(page, mo);
      await monitor.attach();
      await page.goto(p.url, { waitUntil: 'domcontentloaded', timeout: r.readyTimeoutMs }).catch(() => {});
      await waitForReady(page, monitor, page.locator('body > *'), r, 10_000);
      const path = new URL(page.url()).pathname.toLowerCase();
      const rows = await page.locator('table tbody tr').count().catch(() => 0);
      if (path !== loginPath.toLowerCase() && path === new URL(p.finalUrl).pathname.toLowerCase() && rows > 0) {
        found.push({ severity: 'Medium', check: 'Logged-out access', url: p.url, evidence: `The page shows ${rows} table row(s) with no login`, fix: 'Send users without a session to the login page' });
      }
    } finally {
      await page.close().catch(() => {});
    }
  }
  return found;
};

/** Pages of specific records (by ID), opened as the low-permission user. View only. */
export const checkRoles = async (low: BrowserContext, s: Survey, recordPages: string[], mo: MonitorOptions, r: Readiness, loginPath: string): Promise<Finding[]> => {
  const found: Finding[] = [];
  const targets = s.pages.filter((p) => recordPages.includes(p.route)).slice(0, 20);
  if (!targets.length) throw new NotChecked('No record pages to compare: set record IDs in .qagent/test-data.<env>.json');
  for (const p of targets) {
    const page = await low.newPage();
    try {
      const monitor = new PageMonitor(page, mo);
      await monitor.attach();
      let denied = false;
      page.on('response', (res) => {
        if ([401, 403].includes(res.status())) denied = true;
      });
      const res = await page.goto(p.url, { waitUntil: 'domcontentloaded', timeout: r.readyTimeoutMs }).catch(() => null);
      await waitForReady(page, monitor, page.locator('body > *'), r, 10_000);
      const samePage = new URL(page.url()).pathname.toLowerCase() === new URL(p.finalUrl).pathname.toLowerCase();
      if (res && res.status() < 400 && !denied && samePage && new URL(page.url()).pathname.toLowerCase() !== loginPath.toLowerCase()) {
        found.push({ severity: 'High', check: 'Role checks (IDOR)', url: p.url, evidence: 'The low-permission user could open this record. Confirm that this user should see it', fix: 'Check on the server that the user may access this specific record' });
      }
    } finally {
      await page.close().catch(() => {});
    }
  }
  return found;
};

const REDIRECT_PARAMS = ['redirect', 'redirect_uri', 'redirectUrl', 'returnUrl', 'return', 'next', 'url', 'continue', 'goto', 'dest'];
const OUTSIDE = 'https://qagent-redirect-check.invalid/';

const withParam = (url: string, name: string, value: string) => {
  const u = new URL(url);
  u.searchParams.set(name, value);
  return u.toString();
};

/** Redirect parameters pointed at a reserved, non-existent domain. The target is read, never followed. */
export const checkRedirects = async (client: SafeClient, s: Survey, baseUrl: string, loginPath: string): Promise<Finding[]> => {
  const found: Finding[] = [];
  const seen = new Set<string>();
  const candidates: [string, string][] = [];
  for (const l of s.pages.flatMap((p) => p.queryLinks)) for (const k of new URL(l).searchParams.keys()) if (REDIRECT_PARAMS.some((r) => r.toLowerCase() === k.toLowerCase())) candidates.push([l, k]);
  for (const k of REDIRECT_PARAMS) candidates.push([new URL(loginPath, baseUrl).toString(), k]);
  for (const [url, k] of candidates) {
    const target = withParam(url, k, OUTSIDE);
    if (seen.has(target)) continue;
    seen.add(target);
    const r = await client.get(target);
    if (r && r.res.status() >= 300 && r.res.status() < 400 && (r.res.headers().location ?? '').includes('qagent-redirect-check.invalid')) {
      found.push({ severity: 'High', check: 'Open redirect', url: target, evidence: `Redirects to ${r.res.headers().location}`, fix: 'Only redirect to paths on your own site' });
    }
  }
  return found;
};

// Harmless: it only sets a flag in the tester's own browser tab
export const XSS_MARKER = 'qagent"\'<img src=x onerror="window.__qagentXss=1">';

const paramTargets = (s: Survey) => {
  const out = new Map<string, string>();
  for (const l of s.pages.flatMap((p) => p.queryLinks)) for (const k of new URL(l).searchParams.keys()) out.set(`${new URL(l).pathname}?${k}`, withParam(l, k, ''));
  return [...out.values()];
};

/** Marker text in URL parameters and search fields; a finding only if it reaches the page unescaped or runs. */
export const checkReflectedXss = async (client: SafeClient, context: BrowserContext, s: Survey, mo: MonitorOptions, r: Readiness): Promise<Finding[]> => {
  const found: Finding[] = [];
  const fix = 'Escape user input when rendering it, and avoid raw HTML sinks';
  const urls: string[] = [];
  for (const raw of paramTargets(s).slice(0, 30)) {
    const u = new URL(raw);
    for (const k of u.searchParams.keys()) {
      const target = withParam(raw, k, XSS_MARKER);
      urls.push(target);
      const res = await client.get(target);
      if (res && /html/i.test(res.res.headers()['content-type'] ?? '') && res.body.includes(XSS_MARKER)) {
        found.push({ severity: 'High', check: 'Reflected XSS', url: `${u.pathname}?${k}=…`, evidence: `Parameter "${k}" comes back unescaped in the page`, fix });
      }
    }
  }
  // Client-rendered pages: the browser shows whether the marker runs
  const visit = async (act: (page: Page) => Promise<void>, where: string) => {
    const page = await context.newPage();
    try {
      const monitor = new PageMonitor(page, mo);
      await monitor.attach();
      page.on('dialog', (d) => d.dismiss().catch(() => {}));
      await act(page);
      await waitForReady(page, monitor, page.locator('body > *'), r, 8_000);
      if (await page.evaluate(() => !!(window as any).__qagentXss).catch(() => false)) found.push({ severity: 'High', check: 'Reflected XSS', url: where, evidence: 'The marker ran as script in the browser', fix });
    } finally {
      await page.close().catch(() => {});
    }
  };
  for (const u of urls.slice(0, 8)) await visit(async (page) => void (await page.goto(u, { waitUntil: 'domcontentloaded', timeout: r.readyTimeoutMs }).catch(() => {})), new URL(u).pathname);
  for (const p of s.pages.slice(0, 10)) {
    await visit(async (page) => {
      await page.goto(p.url, { waitUntil: 'domcontentloaded', timeout: r.readyTimeoutMs }).catch(() => {});
      await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
      const field = page.locator('input[type="search"], input[name*="search" i], input[placeholder*="search" i]').first();
      if ((await field.count()) && (await field.isVisible().catch(() => false))) {
        await field.fill(XSS_MARKER, { timeout: 3_000 }).catch(() => {});
        await field.press('Enter', { timeout: 3_000 }).catch(() => {});
      }
    }, p.url);
  }
  return found;
};

const SQL_ERROR = /SQL syntax|mysql_fetch|ORA-\d{5}|PostgreSQL.*ERROR|pg_query\(\)|SQLSTATE\[|Unclosed quotation mark|quoted string not properly terminated|SQLite\/JDBC|sqlite3\.OperationalError|ODBC SQL Server Driver/i;

/** A single quote added to GET parameters; a database error in the answer is the signal. Nothing more forceful. */
export const checkSql = async (client: SafeClient, s: Survey): Promise<Finding[]> => {
  const found: Finding[] = [];
  const targets = new Map<string, Record<string, string>>();
  for (const l of s.pages.flatMap((p) => p.queryLinks)) targets.set(l, {});
  for (const [u, h] of s.apis) if (new URL(u).search) targets.set(u, h);
  for (const [url, headers] of [...targets].slice(0, 30)) {
    const u = new URL(url);
    for (const [k, v] of u.searchParams) {
      const res = await client.get(withParam(url, k, `${v}'`), headers);
      const m = res && SQL_ERROR.exec(res.body);
      if (m) {
        const base = await client.get(url, headers);
        if (base && SQL_ERROR.test(base.body)) continue;
        found.push({ severity: 'High', check: 'SQL injection signals', url: `${u.pathname}?${k}=…`, evidence: `A quote in "${k}" caused a database error: ${res!.body.slice(Math.max(0, m.index - 30), m.index + 90).replace(/\s+/g, ' ')}`, fix: 'Use parameterised queries, and do not show database errors' });
      }
    }
  }
  return found;
};

const RISKY_FORM = /delete|remove|send|email|sms|notify|book|ship|tender|void|cancel|charge|pay|refund|invoice|checkout|purchase|order|transfer|password|logout|sign/i;

/**
 * Local and Dev only: saves a marker through simple forms, reloads, and sees if
 * it runs. Forms with passwords, uploads or risky actions are left alone, and
 * blocked endpoints stay blocked. Entries saved are reported for clean-up.
 */
export const checkStoredXss = async (context: BrowserContext, s: Survey, mo: MonitorOptions, r: Readiness, env: EnvName): Promise<{ findings: Finding[]; saved: string[] }> => {
  if (!isFullScan(env)) throw new Error('Stored XSS runs on Local and Dev only');
  const findings: Finding[] = [];
  const saved: string[] = [];
  const writes = { ...mo, readOnly: false };
  let tried = 0;
  for (const p of s.pages) {
    if (tried >= 5) break;
    const page = await context.newPage();
    try {
      const monitor = new PageMonitor(page, writes);
      await monitor.attach();
      page.on('dialog', (d) => d.dismiss().catch(() => {}));
      await page.goto(p.url, { waitUntil: 'domcontentloaded', timeout: r.readyTimeoutMs }).catch(() => {});
      await waitForReady(page, monitor, page.locator('body > *'), r, 10_000);
      const form = page.locator('form').first();
      if (!(await form.count())) continue;
      const risky = await form.evaluate((f, src) => {
        const re = new RegExp(src, 'i');
        const text = [(f as HTMLFormElement).getAttribute('action') ?? '', ...[...f.querySelectorAll('button,input[type=submit]')].map((b) => b.textContent || (b as HTMLInputElement).value)].join(' ');
        return !f.querySelector('button,input[type=submit]') || !!f.querySelector('input[type=password],input[type=file]') || re.test(text);
      }, RISKY_FORM.source);
      if (risky) continue;
      const fields = form.locator('input[type=text],input:not([type]),textarea');
      if (!(await fields.count())) continue;
      tried++;
      for (let i = 0; i < (await fields.count()); i++) await fields.nth(i).fill(XSS_MARKER, { timeout: 3_000 }).catch(() => {});
      for (const e of await form.locator('input[type=email]').all()) await e.fill('qagent@example.invalid').catch(() => {});
      await form.locator('button[type=submit],input[type=submit],button:not([type])').first().click({ timeout: 5_000 }).catch(() => {});
      await waitForReady(page, monitor, page.locator('body > *'), r, 8_000);
      if (monitor.since({ console: 0, network: 0, api: 0, blocked: 0 }).network.some((n) => n.category === 'blocked-by-qagent')) continue;
      saved.push(p.url);
      await page.reload({ waitUntil: 'domcontentloaded', timeout: r.readyTimeoutMs }).catch(() => {});
      await waitForReady(page, monitor, page.locator('body > *'), r, 8_000);
      if (await page.evaluate(() => !!(window as any).__qagentXss).catch(() => false)) findings.push({ severity: 'High', check: 'Stored XSS', url: p.url, evidence: 'A saved marker ran as script when the page was reopened: it would run for other users too', fix: 'Escape stored content when rendering it, and avoid raw HTML sinks' });
    } finally {
      await page.close().catch(() => {});
    }
  }
  return { findings, saved };
};

const ATTEMPTS = 10;
const LIMITED = /too many|locked|try again (?:later|in)|temporarily|captcha|rate limit/i;

/** Local and Dev only: wrong passwords for a made-up account, in a logged-out window. No real account can be locked. */
export const checkRateLimit = async (browser: Browser, plan: LoginPlan, baseUrl: string, env: EnvName): Promise<Finding[]> => {
  if (!isFullScan(env)) throw new Error('The login rate-limit check runs on Local and Dev only');
  const url = new URL(plan.loginPath, baseUrl).toString();
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  try {
    const page = await context.newPage();
    let limited = false;
    page.on('response', (res) => {
      if ([429, 423].includes(res.status())) limited = true;
    });
    for (let i = 0; i < ATTEMPTS && !limited; i++) {
      await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
      await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
      try {
        await fillLoginForm(page, 'qagent-rate-check@example.invalid', `wrong-password-${i}`);
      } catch {
        throw new NotChecked('No login form with a username and password field was found');
      }
      await page.waitForTimeout(400);
      if (LIMITED.test((await page.locator('body').innerText().catch(() => '')) ?? '')) limited = true;
    }
    return limited ? [] : [{ severity: 'Medium', check: 'Login rate limit', url, evidence: `${ATTEMPTS} wrong passwords in a row were all accepted for checking, with no limit`, fix: 'Limit login attempts per account and per address' }];
  } finally {
    await context.close().catch(() => {});
  }
};
