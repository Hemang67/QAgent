import type { EnvName, PageResult, Problem, TestType } from '../shared/types';
import type { Finding } from './security/client';

/** One row of results: a page, one of its tabs, or a run step such as login. */
export interface PageRecord {
  route: string;
  /** "page", "login", "site", or the tab path ("Orders > Open") */
  kind: 'site' | 'login' | 'page' | 'tab' | 'flow' | 'crud' | 'check';
  tabPath?: string;
  url: string | null;
  finalUrl?: string | null;
  file?: string;
  heading?: string | null;
  result: PageResult;
  classification: string;
  problems: Problem[];
  consoleErrors: number;
  failedApi: number;
  durationMs: number;
  perf?: { loadToReadyMs: number; lcpMs: number | null; apiCalls: number; slowestApi: { method: string; url: string; ms: number } | null };
}

export interface JobResult {
  env: EnvName;
  type: TestType;
  baseUrl: string;
  startedAt: number;
  endedAt: number;
  /** skipped = not run because Smoke failed on this environment */
  status: PageResult;
  records: PageRecord[];
  /** One-line notes for the sheet subtitle (crawl limit hit, smoke gate, cancel) */
  notes: string[];
  readOnly: boolean;
  appAccount: string;
  /** Security scan: findings with severity, URL, evidence and fix */
  findings?: Finding[];
}

export const countResults = (records: PageRecord[]) => {
  const c: Record<PageResult, number> = { passed: 0, failed: 0, skipped: 0, unverified: 0 };
  for (const r of records) c[r.result]++;
  return c;
};

/** Failed if anything failed; unverified if nothing was really checked; otherwise passed. */
export const jobStatus = (records: PageRecord[]): PageResult => {
  const c = countResults(records);
  if (c.failed) return 'failed';
  if (!c.passed) return records.length && c.skipped === records.length ? 'skipped' : 'unverified';
  return 'passed';
};

/** Passed ÷ (passed + failed + unverified); skipped pages (no permission by design) do not count. */
export const passRate = (records: PageRecord[]) => {
  const c = countResults(records);
  const d = c.passed + c.failed + c.unverified;
  return d ? c.passed / d : null;
};
