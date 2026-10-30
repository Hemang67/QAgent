import type { Page, Request } from 'playwright-core';
import type { Severity } from '../shared/types';
import { decide } from './guard';

export interface ConsoleEvent {
  at: number;
  kind: 'console' | 'pageerror';
  text: string;
  location?: string;
  category: string;
  severity: Severity;
}

export interface NetworkEvent {
  at: number;
  method: string;
  url: string;
  status: number | null;
  failure: string | null;
  durationMs: number | null;
  category: string;
  severity: Severity;
  reason?: string;
}

export interface MonitorOptions {
  /** Origins that count as the app's own: the site and its API */
  ownOrigins: string[];
  readOnly: boolean;
  blockedEndpoints: string[];
  readOnlyAllow: string[];
}

// Console noise that is not an application defect. Each pattern states why.
const KNOWN_CONSOLE: { pattern: RegExp; category: string; severity: Severity }[] = [
  { pattern: /^Warning: /, category: 'react-dev-warning', severity: 'warning' }, // React dev-mode warnings
  { pattern: /Download the React DevTools/i, category: 'devtools-hint', severity: 'info' },
  { pattern: /\[vite\]|\[HMR\]|\[Fast Refresh\]/i, category: 'dev-server', severity: 'info' }, // dev server chatter
  { pattern: /Future Flag Warning/i, category: 'library-notice', severity: 'info' }, // React Router upgrade notices, on every page
  { pattern: /Failed to load resource/i, category: 'network-duplicate', severity: 'info' }, // already reported by the network monitor
  { pattern: /blocked by QAgent|net::ERR_BLOCKED_BY_CLIENT|net::ERR_FAILED/i, category: 'qagent-blocked-request', severity: 'info' },
  { pattern: /WebSocket connection|signalr|HubConnection|EventSource/i, category: 'realtime', severity: 'warning' },
];

export class PageMonitor {
  readonly consoleEvents: ConsoleEvent[] = [];
  readonly networkEvents: NetworkEvent[] = [];
  readonly blockedRequests: { method: string; url: string; reason: string }[] = [];
  readonly apiTimings: { method: string; url: string; ms: number; status: number | null }[] = [];
  private inflight = new Map<Request, number>();
  private lastActivity = Date.now();
  private apiRequestCount = 0;

  constructor(
    private page: Page,
    private opts: MonitorOptions,
  ) {}

  /** The app's own XHR/fetch calls; fonts, CDNs and analytics load but are not judged. */
  isApi(req: Request) {
    if (!['xhr', 'fetch'].includes(req.resourceType())) return false;
    try {
      return this.opts.ownOrigins.includes(new URL(req.url()).origin);
    } catch {
      return false;
    }
  }

  private isOwn(url: string) {
    try {
      return this.opts.ownOrigins.includes(new URL(url).origin);
    } catch {
      return false;
    }
  }

  async attach() {
    const page = this.page;

    // Every request passes the guard before it leaves the browser
    await page.route('**/*', async (route) => {
      const req = route.request();
      const d = decide(req.method(), req.url(), req.postData(), {
        readOnly: this.opts.readOnly,
        blocked: this.opts.blockedEndpoints,
        allow: this.opts.readOnlyAllow,
      });
      if (!d.allow) {
        this.blockedRequests.push({ method: req.method(), url: req.url(), reason: d.reason });
        return route.abort('blockedbyclient');
      }
      return route.fallback();
    });

    page.on('request', (req) => {
      if (!this.isApi(req)) return;
      this.inflight.set(req, Date.now());
      this.apiRequestCount++;
      this.lastActivity = Date.now();
    });

    page.on('requestfinished', async (req) => {
      const started = this.inflight.get(req);
      if (!this.inflight.delete(req) && !this.isOwn(req.url())) return;
      this.lastActivity = Date.now();
      const res = await req.response().catch(() => null);
      const status = res?.status() ?? null;
      if (started !== undefined) this.apiTimings.push({ method: req.method(), url: req.url(), ms: Date.now() - started, status });
      if (status !== null && status >= 400) this.networkEvents.push(this.classifyHttp(req, status, started));
    });

    page.on('requestfailed', (req) => {
      const started = this.inflight.get(req);
      const wasApi = this.inflight.delete(req);
      const url = req.url();
      if (!wasApi && !this.isOwn(url)) return; // other domains are never judged
      this.lastActivity = Date.now();
      const failure = req.failure()?.errorText ?? 'unknown';
      let category = wasApi ? 'api-request-failed' : 'resource-request-failed';
      let severity: Severity = wasApi ? 'error' : 'warning';
      let reason: string | undefined;
      const blocked = this.blockedRequests.find((b) => b.url === url && b.method === req.method());
      if (blocked) {
        category = 'blocked-by-qagent';
        severity = 'info';
        reason = blocked.reason;
      } else if (/ERR_ABORTED/.test(failure)) {
        category = 'aborted';
        severity = 'info';
        reason = 'Request cancelled by the browser or the app (navigation or a superseded request)';
      }
      this.networkEvents.push({
        at: Date.now(),
        method: req.method(),
        url,
        status: null,
        failure,
        durationMs: started ? Date.now() - started : null,
        category,
        severity,
        reason,
      });
    });

    page.on('console', (msg) => {
      if (msg.type() !== 'error' && msg.type() !== 'warning') return;
      const text = msg.text();
      const loc = msg.location();
      const known = KNOWN_CONSOLE.find((k) => k.pattern.test(text));
      const isError = msg.type() === 'error';
      this.consoleEvents.push({
        at: Date.now(),
        kind: 'console',
        text: text.slice(0, 2000),
        location: loc?.url ? `${loc.url}:${loc.lineNumber}` : undefined,
        category: known?.category ?? (isError ? 'console-error' : 'console-warning'),
        severity: known?.severity ?? (isError ? 'error' : 'warning'),
      });
    });

    page.on('pageerror', (err) => {
      const text = `${err.name}: ${err.message}`;
      // An unhandled "Network Error" right after QAgent blocked or the browser
      // cancelled a request is the app not catching that rejection: worth
      // fixing, but not a broken page
      const recentCancel = this.networkEvents.some((n) => ['aborted', 'blocked-by-qagent'].includes(n.category) && Date.now() - n.at < 5000);
      const afterCancel = /Network Error|CanceledError|AbortError|Failed to fetch/i.test(text) && recentCancel;
      this.consoleEvents.push({
        at: Date.now(),
        kind: 'pageerror',
        text: `${text}\n${(err.stack || '').split('\n').slice(1, 6).join('\n')}`.slice(0, 2000),
        category: afterCancel ? 'unhandled-rejection-after-cancel' : 'uncaught-exception',
        severity: afterCancel ? 'warning' : 'error',
      });
    });
  }

  private classifyHttp(req: Request, status: number, started?: number): NetworkEvent {
    const base = {
      at: Date.now(),
      method: req.method(),
      url: req.url(),
      status,
      failure: null,
      durationMs: started ? Date.now() - started : null,
    };
    if (started === undefined) return { ...base, category: `resource-http-${status}`, severity: 'warning' };
    if (status === 401) return { ...base, category: 'api-401-unauthenticated', severity: 'error', reason: 'Session not accepted by the API' };
    if (status === 403) return { ...base, category: 'api-403-forbidden', severity: 'error', reason: 'The account lacks permission for this data' };
    if (status >= 500) return { ...base, category: 'api-5xx', severity: 'error' };
    return { ...base, category: `api-${status}`, severity: 'error' };
  }

  get inflightCount() {
    return this.inflight.size;
  }

  get inflightUrls() {
    return [...this.inflight.entries()].map(([r, t]) => ({ method: r.method(), url: r.url(), pendingMs: Date.now() - t }));
  }

  /** Call right before navigating so "network quiet" is measured from the navigation. */
  touch() {
    this.lastActivity = Date.now();
  }

  get msSinceLastActivity() {
    return Date.now() - this.lastActivity;
  }

  /** Snapshot so callers can isolate the events one action (a tab click) produced. */
  mark() {
    return {
      console: this.consoleEvents.length,
      network: this.networkEvents.length,
      api: this.apiRequestCount,
      blocked: this.blockedRequests.length,
    };
  }

  since(mark: ReturnType<PageMonitor['mark']>) {
    return {
      console: this.consoleEvents.slice(mark.console),
      network: this.networkEvents.slice(mark.network),
      apiRequests: this.apiRequestCount - mark.api,
      blocked: this.blockedRequests.slice(mark.blocked),
    };
  }
}
