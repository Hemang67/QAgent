import type { Budgets, Problem } from '../../shared/types';
import type { PageRecord } from '../records';

/**
 * Budgets: time until the page is ready (warn / fail), the slowest API call and
 * Largest Contentful Paint (warn). Every API call over budget is listed.
 */
export const checkPerf = (perf: NonNullable<PageRecord['perf']>, apiTimings: { method: string; url: string; ms: number }[], b: Budgets): Problem[] => {
  const problems: Problem[] = [];
  const ms = perf.loadToReadyMs;
  if (ms > b.readyFailMs) problems.push({ type: 'perf-ready-over-budget', severity: 'error', detail: `${ms} ms to ready (fail budget ${b.readyFailMs} ms)` });
  else if (ms > b.readyWarnMs) problems.push({ type: 'perf-ready-slow', severity: 'warning', detail: `${ms} ms to ready (warn budget ${b.readyWarnMs} ms)` });
  if (perf.lcpMs !== null && perf.lcpMs > b.lcpWarnMs) problems.push({ type: 'perf-lcp-slow', severity: 'warning', detail: `Largest Contentful Paint ${perf.lcpMs} ms (budget ${b.lcpWarnMs} ms)` });
  for (const t of apiTimings.filter((x) => x.ms > b.apiWarnMs)) {
    problems.push({ type: 'perf-api-slow', severity: 'warning', detail: `${t.method} ${t.url} took ${t.ms} ms (budget ${b.apiWarnMs} ms)` });
  }
  return problems;
};
