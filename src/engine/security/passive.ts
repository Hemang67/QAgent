import tls from 'tls';
import type { BrowserContext } from 'playwright-core';
import type { PlannedPage, Readiness } from '../../shared/types';
import { PageMonitor, type MonitorOptions } from '../monitor';
import { waitForReady } from '../readiness';
import { LOGOUT_PATH } from '../visit';
import { isLoopback, type Finding, type SafeClient, type SeverityLevel } from './client';
import { mask } from './project';

export interface SurveyPage {
  route: string;
  url: string;
  finalUrl: string;
  status: number;
  headers: Record<string, string>;
  scripts: string[];
  mixed: string[];
  stackTrace: string | null;
  /** Same-domain links that carry query parameters */
  queryLinks: string[];
  storageTokens: { name: string; value: string }[];
}

export interface Survey {
  pages: SurveyPage[];
  /** The app's GET API calls, with the Authorization header they used (memory only) */
  apis: Map<string, Record<string, string>>;
}

// Framework and build files the browser fetches like API calls (manifests, hot reload): never app data
export const BUILD_ASSET = /\/(_next|__nextjs|_nuxt|@vite|@fs|@id|@react-refresh|node_modules|__webpack[\w-]*|sockjs-node|static\/(js|css|media|development|webpack))\/|\.hot-update\.json|\/(asset-)?manifest\.json$|\.(js|css|map|wasm|woff2?)(\?|$)/i;

const STACK = /Traceback \(most recent call last\)|\bat [\w.$<>]+ \([^)]*:\d+:\d+\)|Exception in thread|Stack trace:|System\.[A-Z]\w+Exception|Fatal error: .* on line \d+/;
const TOKEN_NAME = /token|jwt|auth|session|bearer/i;
const SESSION_COOKIE = /sess|sid$|^sid|token|jwt|auth|login/i;

/** Opens the sampled pages logged in, behind the read-only guard, and notes what they expose. */
export const survey = async (context: BrowserContext, pages: PlannedPage[], mo: MonitorOptions, r: Readiness, loginPath: string): Promise<Survey> => {
  const out: Survey = { pages: [], apis: new Map() };
  const queue = pages.filter((p) => p.url && !p.skip && !LOGOUT_PATH.test(new URL(p.url).pathname));
  const work = async (p: PlannedPage) => {
    const page = await context.newPage();
    try {
      const monitor = new PageMonitor(page, mo);
      await monitor.attach();
      page.on('dialog', (d) => d.dismiss().catch(() => {}));
      page.on('request', (q) => {
        if (q.method() === 'GET' && monitor.isApi(q) && !BUILD_ASSET.test(new URL(q.url()).pathname) && out.apis.size < 200) {
          const auth = q.headers().authorization;
          out.apis.set(q.url(), auth ? { authorization: auth } : {});
        }
      });
      const res = await page.goto(p.url!, { waitUntil: 'domcontentloaded', timeout: r.readyTimeoutMs }).catch(() => null);
      if (!res) return;
      await waitForReady(page, monitor, page.locator('body > *'), r, Math.min(r.readyTimeoutMs, 15_000));
      if (new URL(page.url()).pathname.toLowerCase() === loginPath.toLowerCase()) return;
      const seen = await page.evaluate(() => ({
        scripts: [...document.scripts].map((s) => s.src).filter(Boolean),
        resources: performance.getEntriesByType('resource').map((e) => e.name),
        text: document.body?.innerText ?? '',
        links: [...document.querySelectorAll('a[href]')].map((a) => (a as HTMLAnchorElement).href),
        storage: Object.entries(localStorage),
      }));
      const origin = new URL(p.url!).origin;
      out.pages.push({
        route: p.route,
        url: p.url!,
        finalUrl: page.url(),
        status: res.status(),
        headers: res.headers(),
        scripts: seen.scripts,
        mixed: page.url().startsWith('https:') ? seen.resources.filter((u) => u.startsWith('http:')) : [],
        stackTrace: STACK.exec(seen.text)?.[0] ?? null,
        queryLinks: seen.links.filter((l) => {
          try {
            const u = new URL(l);
            return u.origin === origin && u.search.length > 1 && !LOGOUT_PATH.test(u.pathname);
          } catch {
            return false;
          }
        }),
        storageTokens: seen.storage.filter(([k, v]) => TOKEN_NAME.test(k) && String(v).length >= 8).map(([name, value]) => ({ name, value: String(value) })),
      });
    } finally {
      await page.close().catch(() => {});
    }
  };
  for (let i = 0; i < queue.length; i += 3) await Promise.all(queue.slice(i, i + 3).map(work));
  return out;
};

const HEADERS: { name: string; check: (h: Record<string, string>) => boolean; severity: SeverityLevel; fix: string; httpsOnly?: boolean }[] = [
  { name: 'Content-Security-Policy', check: (h) => !!h['content-security-policy'], severity: 'Medium', fix: 'Send a Content-Security-Policy header that limits where scripts load from' },
  { name: 'Strict-Transport-Security', check: (h) => !!h['strict-transport-security'], severity: 'Medium', fix: 'Send Strict-Transport-Security with a long max-age', httpsOnly: true },
  { name: 'X-Frame-Options', check: (h) => !!h['x-frame-options'] || /frame-ancestors/i.test(h['content-security-policy'] ?? ''), severity: 'Low', fix: 'Send X-Frame-Options: DENY, or frame-ancestors in the CSP' },
  { name: 'X-Content-Type-Options', check: (h) => /nosniff/i.test(h['x-content-type-options'] ?? ''), severity: 'Low', fix: 'Send X-Content-Type-Options: nosniff' },
  { name: 'Referrer-Policy', check: (h) => !!h['referrer-policy'], severity: 'Low', fix: 'Send Referrer-Policy: strict-origin-when-cross-origin' },
];

export const checkHeaders = (s: Survey, baseUrl: string): Finding[] => {
  const found: Finding[] = [];
  const https = baseUrl.startsWith('https:');
  for (const h of HEADERS) {
    if (h.httpsOnly && !https) continue;
    const missing = s.pages.filter((p) => !h.check(p.headers));
    if (!missing.length) continue;
    // Dev servers on this machine rarely send these: note it, do not fail on it
    found.push({ severity: isLoopback(baseUrl) ? 'Low' : h.severity, check: 'Security headers', url: missing[0].url, evidence: `${h.name} is missing on ${missing.length} of ${s.pages.length} page(s)`, fix: h.fix });
  }
  return found;
};

export const checkCookies = async (context: BrowserContext, baseUrl: string): Promise<Finding[]> => {
  const https = baseUrl.startsWith('https:');
  const host = new URL(baseUrl).hostname;
  const found: Finding[] = [];
  for (const c of await context.cookies()) {
    if (!SESSION_COOKIE.test(c.name) || !host.endsWith(c.domain.replace(/^\./, ''))) continue;
    const gaps = [!c.httpOnly && 'HttpOnly', https && !c.secure && 'Secure', c.sameSite === 'None' && !c.secure && 'SameSite'].filter(Boolean);
    if (gaps.length) found.push({ severity: c.httpOnly ? 'Low' : 'Medium', check: 'Cookies', url: baseUrl, evidence: `Cookie "${c.name}" lacks ${gaps.join(', ')}`, fix: 'Set HttpOnly, Secure and SameSite on session cookies' });
  }
  return found;
};

export const checkTls = async (s: Survey, baseUrl: string): Promise<Finding[]> => {
  const found: Finding[] = [];
  for (const p of s.pages.filter((x) => x.mixed.length).slice(0, 5)) found.push({ severity: 'Medium', check: 'HTTPS / TLS', url: p.url, evidence: `Loaded over http: ${p.mixed[0]}`, fix: 'Load every resource over https' });
  const u = new URL(baseUrl);
  if (u.protocol === 'http:') {
    if (!isLoopback(baseUrl)) found.push({ severity: 'High', check: 'HTTPS / TLS', url: baseUrl, evidence: 'The site is served over plain http', fix: 'Serve the site over https and redirect http to it' });
    return found;
  }
  const port = Number(u.port) || 443;
  const connect = (opts: tls.ConnectionOptions) =>
    new Promise<tls.TLSSocket | null>((resolve) => {
      const sock = tls.connect({ host: u.hostname, port, servername: u.hostname, rejectUnauthorized: false, timeout: 10_000, ...opts }, () => resolve(sock));
      sock.on('error', () => resolve(null));
      sock.on('timeout', () => (sock.destroy(), resolve(null)));
    });
  const main = await connect({});
  if (!main) return found;
  const cert = main.getPeerCertificate();
  if (!main.authorized && main.authorizationError) found.push({ severity: isLoopback(baseUrl) ? 'Low' : 'High', check: 'HTTPS / TLS', url: baseUrl, evidence: `Certificate problem: ${main.authorizationError}`, fix: 'Install a valid certificate for this host' });
  const days = cert.valid_to ? Math.floor((new Date(cert.valid_to).getTime() - Date.now()) / 86_400_000) : null;
  if (days !== null && days < 30) found.push({ severity: days < 0 ? 'High' : 'Medium', check: 'HTTPS / TLS', url: baseUrl, evidence: days < 0 ? `Certificate expired ${-days} day(s) ago` : `Certificate expires in ${days} day(s)`, fix: 'Renew the certificate and automate renewal' });
  main.destroy();
  const old = await connect({ minVersion: 'TLSv1', maxVersion: 'TLSv1.1', ciphers: 'DEFAULT@SECLEVEL=0' });
  if (old) {
    found.push({ severity: 'Medium', check: 'HTTPS / TLS', url: baseUrl, evidence: `The server still accepts ${old.getProtocol()}`, fix: 'Allow TLS 1.2 and newer only' });
    old.destroy();
  }
  return found;
};

export const checkLeaks = async (s: Survey, client: SafeClient): Promise<Finding[]> => {
  const found: Finding[] = [];
  for (const p of s.pages.filter((x) => x.stackTrace).slice(0, 5)) found.push({ severity: 'Medium', check: 'Information leaks', url: p.url, evidence: `Stack trace shown to users: ${p.stackTrace!.slice(0, 120)}`, fix: 'Show a generic error page; log details on the server' });
  const banners = new Set<string>();
  for (const p of s.pages) for (const h of ['server', 'x-powered-by', 'x-aspnet-version']) if (/\d/.test(p.headers[h] ?? '')) banners.add(`${h}: ${p.headers[h]}`);
  for (const b of banners) found.push({ severity: 'Low', check: 'Information leaks', url: s.pages[0].url, evidence: `Version banner: ${b}`, fix: 'Remove version numbers from response headers' });
  // Public source maps give away the original code
  const scripts = [...new Set(s.pages.flatMap((p) => p.scripts))].filter((u) => /\.m?js(\?|$)/.test(u)).slice(0, 5);
  for (const script of scripts) {
    const map = await client.get(script.replace(/(\?.*)?$/, '.map'));
    if (map && map.res.status() === 200 && /"sources"\s*:/.test(map.body)) {
      found.push({ severity: 'Low', check: 'Information leaks', url: `${script}.map`, evidence: 'A public source map exposes the original source code', fix: 'Do not publish source maps, or restrict them' });
      break;
    }
  }
  return found;
};

export const checkStorageTokens = (s: Survey): Finding[] => {
  const seen = new Map<string, Finding>();
  for (const p of s.pages) {
    for (const t of p.storageTokens) {
      if (!seen.has(t.name)) seen.set(t.name, { severity: 'Medium', check: 'Tokens in browser storage', url: p.url, evidence: `localStorage "${t.name}" holds ${mask(t.value)}`, fix: 'Keep session tokens in HttpOnly cookies, out of reach of scripts' });
    }
  }
  return [...seen.values()];
};
