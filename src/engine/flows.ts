import type { BrowserContext, Page } from 'playwright-core';
import type { CrudDef, FlowDef, FlowStep, Problem, Readiness } from '../shared/types';
import { PageMonitor, type MonitorOptions } from './monitor';
import { waitForReady } from './readiness';
import type { PageRecord } from './records';

const STEP_TIMEOUT = 15_000;

/** {{name}} and {{newName}} in a step become this run's unique test names. */
const fill = (s: string, vars: Record<string, string>) => s.replace(/\{\{(\w+)\}\}/g, (m, k) => vars[k] ?? m);

export const describeStep = (s: FlowStep) => {
  if ('goto' in s) return `go to ${s.goto}`;
  if ('click' in s) return `click ${s.click}`;
  if ('fill' in s) return `fill ${s.fill}`;
  if ('select' in s) return `select "${s.value}" in ${s.select}`;
  if ('check' in s) return `tick ${s.check}`;
  if ('press' in s) return `press ${s.key} in ${s.press}`;
  if ('expectText' in s) return `expect text "${s.expectText}"`;
  return `expect URL ${s.expectUrl}`;
};

const runStep = async (page: Page, s: FlowStep, baseUrl: string, vars: Record<string, string>) => {
  const loc = (sel: string) => page.locator(fill(sel, vars)).first();
  if ('goto' in s) await page.goto(new URL(fill(s.goto, vars), baseUrl).toString(), { waitUntil: 'domcontentloaded', timeout: 30_000 });
  else if ('click' in s) await loc(s.click).click({ timeout: STEP_TIMEOUT });
  else if ('fill' in s) await loc(s.fill).fill(fill(s.value, vars), { timeout: STEP_TIMEOUT });
  else if ('select' in s) await loc(s.select).selectOption({ label: fill(s.value, vars) }, { timeout: STEP_TIMEOUT }).catch(() => loc(s.select).selectOption(fill(s.value, vars), { timeout: STEP_TIMEOUT }));
  else if ('check' in s) await loc(s.check).check({ timeout: STEP_TIMEOUT });
  else if ('press' in s) await loc(s.press).press(s.key, { timeout: STEP_TIMEOUT });
  else if ('expectText' in s) await page.getByText(fill(s.expectText, vars)).first().waitFor({ state: 'visible', timeout: STEP_TIMEOUT });
  else {
    const want = fill(s.expectUrl, vars);
    await page.waitForURL((u) => u.pathname.toLowerCase().includes(want.toLowerCase()), { timeout: STEP_TIMEOUT });
  }
};

export interface StepsOutcome {
  ok: boolean;
  /** Index and text of the step that failed */
  failedAt?: { index: number; step: string; error: string };
  problems: Problem[];
  durationMs: number;
}

/**
 * Runs steps on one page, waiting for the page to settle after each. Console
 * errors and failed API calls along the way are problems, as on any page.
 */
export const runSteps = async (page: Page, monitor: PageMonitor, steps: FlowStep[], baseUrl: string, vars: Record<string, string>, r: Readiness): Promise<StepsOutcome> => {
  const started = Date.now();
  const mark = monitor.mark();
  let failedAt: StepsOutcome['failedAt'];
  for (let i = 0; i < steps.length; i++) {
    try {
      monitor.touch();
      await runStep(page, steps[i], baseUrl, vars);
      await waitForReady(page, monitor, page.locator('body > *'), r, 15_000);
    } catch (e) {
      failedAt = { index: i + 1, step: describeStep(steps[i]), error: (e as Error).message.split('\n')[0] };
      break;
    }
  }
  const ev = monitor.since(mark);
  const problems: Problem[] = [];
  if (failedAt) problems.push({ type: 'step-failed', severity: 'error', detail: `Step ${failedAt.index} (${fill(failedAt.step, vars)}): ${failedAt.error}` });
  for (const c of ev.console) if (c.severity === 'error') problems.push({ type: c.category, severity: 'error', detail: c.text.split('\n')[0].slice(0, 300) });
  for (const n of ev.network) if (n.severity === 'error') problems.push({ type: n.category, severity: 'error', detail: `${n.method} ${n.url} → ${n.status ?? n.failure}` });
  for (const b of ev.blocked) problems.push({ type: 'write-blocked', severity: failedAt ? 'error' : 'warning', detail: `${b.method} ${new URL(b.url).pathname} was blocked (${b.reason})` });
  return { ok: !problems.some((p) => p.severity === 'error'), failedAt, problems, durationMs: Date.now() - started };
};

const record = (route: string, kind: PageRecord['kind'], tabPath: string, o: StepsOutcome | null, unverifiedWhy?: string): PageRecord => ({
  route,
  kind,
  tabPath,
  url: null,
  result: !o ? 'unverified' : o.ok ? 'passed' : 'failed',
  classification: !o ? 'not-run' : o.ok ? (o.problems.length ? 'passed-with-warnings' : 'ok') : (o.problems.find((p) => p.severity === 'error')?.type ?? 'failed'),
  problems: o ? o.problems : [{ type: 'not-run', severity: 'info', detail: unverifiedWhy ?? 'Not run' }],
  consoleErrors: o ? o.problems.filter((p) => p.type.startsWith('console') || p.type === 'uncaught-exception').length : 0,
  failedApi: o ? o.problems.filter((p) => p.type.startsWith('api')).length : 0,
  durationMs: o?.durationMs ?? 0,
});

const openPage = async (context: BrowserContext, mo: MonitorOptions) => {
  const page = await context.newPage();
  const monitor = new PageMonitor(page, mo);
  await monitor.attach();
  // Recorded journeys answered confirm() dialogs with OK (the recorder accepts them too); writes stay blocked unless allowed
  page.on('dialog', (d) => d.accept().catch(() => {}));
  return { page, monitor };
};

/** One critical flow: a single row, failed at the first step that fails. */
export const runFlow = async (context: BrowserContext, flow: FlowDef, baseUrl: string, mo: MonitorOptions, r: Readiness): Promise<PageRecord> => {
  const { page, monitor } = await openPage(context, mo);
  try {
    const o = await runSteps(page, monitor, flow.steps, baseUrl, {}, r);
    return record(flow.name, 'flow', `${flow.steps.length} steps`, o);
  } finally {
    await page.close().catch(() => {});
  }
};

/**
 * Create → read → update → delete of a QAgent-… record. Each phase is a row;
 * if create fails the rest are unverified; if delete fails the leftover record
 * is named so it can be removed by hand.
 */
export const runCrud = async (context: BrowserContext, def: CrudDef, baseUrl: string, mo: MonitorOptions, r: Readiness): Promise<PageRecord[]> => {
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(2, 12);
  const vars = { name: `QAgent-${stamp}`, newName: `QAgent-${stamp}-edited` };
  const rows: PageRecord[] = [];
  const { page, monitor } = await openPage(context, mo);
  const go: FlowStep = { goto: def.route };
  try {
    const create = await runSteps(page, monitor, [go, ...def.create], baseUrl, vars, r);
    rows.push(record(def.name, 'crud', `create ${vars.name}`, create));
    if (!create.ok) {
      for (const phase of ['read', ...(def.edit ? ['update'] : []), 'delete']) rows.push(record(def.name, 'crud', phase, null, 'Create failed'));
      return rows;
    }
    const read = await runSteps(page, monitor, [go, { expectText: '{{name}}' }], baseUrl, vars, r);
    rows.push(record(def.name, 'crud', 'read', read));
    let current = vars.name;
    if (def.edit) {
      const edit = await runSteps(page, monitor, [go, ...def.edit, go, { expectText: '{{newName}}' }], baseUrl, vars, r);
      rows.push(record(def.name, 'crud', 'update', edit));
      if (edit.ok) current = vars.newName;
    }
    const del = await runSteps(page, monitor, [go, ...def.delete], baseUrl, vars, r);
    // Gone from the list afterwards?
    let gone = del.ok;
    if (del.ok) {
      await page.goto(new URL(def.route, baseUrl).toString(), { waitUntil: 'domcontentloaded' }).catch(() => {});
      await waitForReady(page, monitor, page.locator('body > *'), r, 15_000);
      gone = !(await page.getByText(current, { exact: false }).first().isVisible().catch(() => false));
      if (!gone) del.problems.push({ type: 'still-listed', severity: 'error', detail: `${current} is still shown after delete` });
      del.ok = gone && del.ok;
    }
    const row = record(def.name, 'crud', 'delete', del);
    if (!gone) row.problems.push({ type: 'leftover', severity: 'error', detail: `Test record "${current}" may remain on ${def.route}: delete it by hand` });
    rows.push(row);
    return rows;
  } finally {
    await page.close().catch(() => {});
  }
};
