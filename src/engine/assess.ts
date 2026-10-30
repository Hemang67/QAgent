import type { PageResult, Problem, Severity } from '../shared/types';
import type { ConsoleEvent, NetworkEvent } from './monitor';
import type { ContentResult, ReadyResult } from './readiness';

export interface AssessInput {
  ready: ReadyResult;
  content: ContentResult;
  console: ConsoleEvent[];
  network: NetworkEvent[];
  apiRequests: number;
  blocked: { method: string; url: string; reason: string }[];
  /** HTTP status of the page document itself, when it was a full navigation */
  documentStatus: number | null;
}

export interface Assessment {
  result: PageResult;
  classification: string;
  problems: Problem[];
}

// When several errors occur, the reason shown is the first in this list
const PRIORITY = [
  'page-http-error',
  'render-error',
  'uncaught-exception',
  'api-401-unauthenticated',
  'data-load-failure',
  'api-5xx',
  'api-request-failed',
  'api-403-forbidden',
  'hung-request',
  'permanent-loader',
  'blank-view',
];

const pathOf = (url: string) => {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
};

export const assessView = (i: AssessInput): Assessment => {
  const problems: Problem[] = [];
  // React logs a render crash several times (dev double render, error boundary): report each problem once
  const add = (type: string, severity: Severity, detail: string) => {
    if (!problems.some((p) => p.type === type && p.detail === detail)) problems.push({ type, severity, detail });
  };

  if (i.documentStatus !== null && i.documentStatus >= 400) add('page-http-error', 'error', `The page itself returned HTTP ${i.documentStatus}`);
  if (i.content.errorScreen) add('render-error', 'error', i.content.errorScreen);

  for (const c of i.console) {
    if (c.severity === 'info') continue;
    add(c.category, c.severity, c.text.split('\n')[0].slice(0, 300));
  }
  for (const n of i.network) {
    if (n.severity === 'info') continue;
    add(n.category, n.severity, `${n.method} ${n.url} → ${n.status ?? n.failure}`);
  }

  if (!i.ready.ready) {
    if (i.ready.inflight.length) add('hung-request', 'error', i.ready.inflight.map((r) => `${r.method} ${r.url} (${r.pendingMs}ms)`).join('; '));
    if (i.ready.visibleLoaders > 0) add('permanent-loader', 'error', `${i.ready.visibleLoaders} loader(s) still visible after ${i.ready.waitedMs}ms`);
    if (!i.ready.inflight.length && i.ready.visibleLoaders === 0) add('not-settled', 'warning', `Network kept busy for ${i.ready.waitedMs}ms (polling?)`);
  }

  if (i.content.textLength === 0 && !i.content.hasPrimary) add('blank-view', 'error', 'No visible text or content elements');

  const apiErrors = i.network.filter((n) => n.severity === 'error');
  const emptyTables = i.content.tables.filter((t) => t.rows === 0);
  const looksEmpty = i.content.emptyMessages.length > 0 || (i.content.tables.length > 0 && emptyTables.length === i.content.tables.length);
  if (looksEmpty) {
    const what = i.content.emptyMessages[0] || `${emptyTables.length} table(s) with no rows`;
    if (apiErrors.length) add('data-load-failure', 'error', `Empty state shown while API calls failed: ${what}`);
    else if (i.blocked.length)
      add('empty-after-blocked-request', 'warning', `${what}; QAgent blocked ${i.blocked.map((b) => `${b.method} ${pathOf(b.url)}`).join(', ')} — the page may load data through a non-GET call (add it to readOnlyAllow)`);
    else if (i.apiRequests === 0) add('empty-without-data-request', 'warning', `${what}; no API request was made`);
    else add('legitimate-empty', 'info', `${what}; all ${i.apiRequests} API request(s) succeeded`);
  }

  for (const b of i.blocked) add('write-blocked', 'warning', `Page sent ${b.method} ${pathOf(b.url)} without user action (blocked: ${b.reason})`);

  const errors = problems.filter((p) => p.severity === 'error');
  const classification = errors.length
    ? (PRIORITY.find((p) => errors.some((e) => e.type === p)) ?? errors[0].type)
    : problems.some((p) => p.severity === 'warning')
      ? 'passed-with-warnings'
      : 'ok';
  return { result: errors.length ? 'failed' : 'passed', classification, problems };
};
