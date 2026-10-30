// Drives the flow recorder like a user (headless) against the React fixture and
// checks the recorded steps, then replays them with the engine's step runner.
//   node scripts/recorder-check.mjs   (part of npm run test:e2e)
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath, pathToFileURL } from 'url';
import { build } from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
// Inside the project, so the bundle can require playwright-core from node_modules
fs.mkdirSync(path.join(ROOT, 'node_modules', '.cache'), { recursive: true });
const out = fs.mkdtempSync(path.join(ROOT, 'node_modules', '.cache', 'qagent-rec-'));
const entry = path.join(out, 'entry.ts');
fs.writeFileSync(
  entry,
  `export { record } from ${JSON.stringify(path.join(ROOT, 'src/main/recorder.ts'))};
   export { ensureLocalApp } from ${JSON.stringify(path.join(ROOT, 'src/planner/local-server.ts'))};
   export { runSteps, runCrud } from ${JSON.stringify(path.join(ROOT, 'src/engine/flows.ts'))};
   export { PageMonitor } from ${JSON.stringify(path.join(ROOT, 'src/engine/monitor.ts'))};
   export { DEFAULT_READINESS } from ${JSON.stringify(path.join(ROOT, 'src/shared/config.ts'))};`,
);
await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(out, 'rec.cjs'), external: ['playwright-core'], logLevel: 'warning', nodePaths: [path.join(ROOT, 'node_modules')] });
const { record, ensureLocalApp, runSteps, runCrud, PageMonitor, DEFAULT_READINESS } = require(path.join(out, 'rec.cjs'));
const { chromium } = require('playwright-core');

const fixture = path.join(ROOT, 'fixtures', 'react-router-app');
const base = 'http://localhost:5179';
const stop = await ensureLocalApp(base, 'npm run dev', fixture, () => {});
let failures = 0;
const check = (ok, what) => {
  console.log(`  ${ok ? '✔' : '✖'} ${what}`);
  if (!ok) failures++;
};

try {
  console.log('Recorder: a critical flow');
  const bar = (page) => page.locator('#qagent-recorder-bar');
  const result = await record(base, '/login', 'flow', {
    headless: true,
    drive: async (page) => {
      // Log in before recording: these actions must not become steps
      await page.locator('input[name="username"]').fill('demo');
      await page.locator('input[name="password"]').fill('demo');
      await page.getByRole('button', { name: 'Sign in' }).click();
      await page.waitForURL('**/dashboard');
      await bar(page).getByRole('button', { name: '● Record' }).click();
      await bar(page).getByText('1 steps').waitFor();
      await page.getByRole('link', { name: 'Orders' }).click();
      await page.getByRole('tab', { name: 'Closed' }).click();
      await bar(page).getByRole('button', { name: 'Add check' }).click();
      await page.getByText('Globex').click();
      await bar(page).getByText('4 steps').waitFor();
      await bar(page).getByRole('button', { name: 'Finish' }).click();
    },
  });
  check(result.ok, `recording finished${result.error ? `: ${result.error}` : ''}`);
  const steps = result.steps ?? [];
  console.log(`    ${JSON.stringify(steps)}`);
  check(JSON.stringify(steps[0]) === JSON.stringify({ goto: '/dashboard' }), 'starts where recording started (login not recorded)');
  check(steps.some((s) => s.click === 'role=link[name="Orders"]'), 'link click recorded by role and name');
  check(steps.some((s) => s.click === 'role=tab[name="Closed"]'), 'tab click recorded by role and name');
  check(steps.some((s) => s.expectText === 'Globex'), '"Add check" recorded the clicked text');

  console.log('Replay: the recorded steps run with the engine');
  const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch({ channel: 'msedge' }));
  const context = await browser.newContext();
  await context.addInitScript(() => localStorage.setItem('token', 'fixture-token'));
  const page = await context.newPage();
  const monitor = new PageMonitor(page, { ownOrigins: [base], readOnly: true, blockedEndpoints: [], readOnlyAllow: [] });
  await monitor.attach();
  const replay = await runSteps(page, monitor, steps, base, {}, DEFAULT_READINESS);
  check(steps.length > 0 && replay.ok, `replay passed${replay.failedAt ? ` (failed at ${replay.failedAt.step}: ${replay.failedAt.error})` : ''}`);
  await browser.close();

  console.log('Recorder: a CRUD screen (typing QAGENT for the name)');
  // Start from the fixture's two colours, whatever earlier runs left
  await fetch(`${base}/api/test/reset`, { method: 'POST', headers: { Authorization: 'Bearer fixture-token' } });
  const crud = await record(base, '/login', 'crud', {
    headless: true,
    drive: async (page) => {
      await page.locator('input[name="username"]').fill('demo');
      await page.locator('input[name="password"]').fill('demo');
      await page.getByRole('button', { name: 'Sign in' }).click();
      await page.waitForURL('**/dashboard');
      await page.goto(base + '/colors');
      await page.getByRole('button', { name: 'Add colour' }).waitFor();
      await bar(page).getByRole('button', { name: '● Record' }).click();
      await bar(page).getByText('CREATE · 0 steps').waitFor();
      await page.getByRole('button', { name: 'Add colour' }).click();
      await page.locator('input[name="colorName"]').fill('QAGENT');
      await page.getByRole('button', { name: 'Save' }).click();
      await page.getByRole('cell', { name: 'QAGENT', exact: true }).waitFor();
      await bar(page).getByRole('button', { name: 'Create done → Edit' }).click();
      await page.getByRole('button', { name: 'Edit QAGENT' }).click();
      await page.locator('input[name="colorName"]').fill('QAGENT-EDITED');
      await page.getByRole('button', { name: 'Save' }).click();
      await page.getByRole('cell', { name: 'QAGENT-EDITED', exact: true }).waitFor();
      await bar(page).getByRole('button', { name: 'Edit done → Delete' }).click();
      await page.getByRole('button', { name: 'Delete QAGENT-EDITED' }).click();
      await page.getByRole('cell', { name: 'QAGENT-EDITED', exact: true }).waitFor({ state: 'detached' });
      await bar(page).getByRole('button', { name: 'Finish' }).click();
    },
  });
  check(crud.ok, `recording finished${crud.error ? `: ${crud.error}` : ''}`);
  const ph = crud.phases ?? { create: [], edit: [], delete: [] };
  console.log(`    ${JSON.stringify({ route: crud.startPath, ...ph })}`);
  check(crud.startPath === '/colors', 'the list page is the CRUD route');
  check(ph.create.some((s) => s.value === '{{name}}'), 'typed QAGENT became {{name}}');
  check(ph.edit.some((s) => s.value === '{{newName}}') && ph.edit.some((s) => s.click?.includes('{{name}}')), 'edit uses {{name}} and {{newName}}');
  check(ph.delete.some((s) => s.click?.includes('{{newName}}')), 'delete targets the edited record');

  console.log('Replay: the recorded CRUD screen runs with a fresh QAgent-… name');
  const b2 = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch({ channel: 'msedge' }));
  const c2 = await b2.newContext();
  await c2.addInitScript(() => localStorage.setItem('token', 'fixture-token'));
  const writes = { ownOrigins: [base], readOnly: false, blockedEndpoints: [], readOnlyAllow: [] };
  const rows = await runCrud(c2, { name: 'Colours', route: crud.startPath, ...ph }, base, writes, DEFAULT_READINESS);
  for (const r of rows) console.log(`    ${r.tabPath}: ${r.result}${r.result !== 'passed' ? ` ${r.problems.map((p) => p.detail).join('; ')}` : ''}`);
  check(rows.length === 4 && rows.every((r) => r.result === 'passed'), 'create, read, update and delete all passed');
  await b2.close();
} finally {
  stop();
  fs.rmSync(out, { recursive: true, force: true });
}
console.log(failures ? `\n${failures} recorder check(s) failed` : '\nRecorder as expected');
process.exitCode = failures ? 1 : 0;
