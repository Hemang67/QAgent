// Drives the real Electron app: opens a fixture, runs Smoke + Full regression
// through the window, checks results, visits every screen and the first-time
// setup, and saves screenshots to test-results/app/.
//   npm run test:app
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { _electron as electron } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'test-results', 'app');
const electronPath = createRequire(import.meta.url)('electron');
fs.mkdirSync(OUT, { recursive: true });

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'qagent-app-'));
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
// The main checks start as a user who has seen the tour and this version's notes
const seasoned = (dir, extra = {}) => fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ tourDone: true, lastSeenVersion: VERSION, ...extra }));
seasoned(userData);
const failures = [];
const check = (ok, what) => {
  console.log(`  ${ok ? '✔' : '✖'} ${what}`);
  if (!ok) failures.push(what);
};

// Hosts such as VS Code set this; Electron would then start as plain Node
const { ELECTRON_RUN_AS_NODE: _, ...baseEnv } = process.env;

const launch = async (project, extraEnv = {}) => {
  // QAGENT_APP_EXE tests a packaged build (release/win-unpacked/QAgent.exe) instead of the sources
  const packaged = process.env.QAGENT_APP_EXE;
  const app = await electron.launch({
    executablePath: packaged || electronPath,
    // Keep painting when another window covers the test window, or screenshots wait forever
    args: ['--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', ...(packaged ? [] : [ROOT])],
    env: { ...baseEnv, QAGENT_USER_DATA: userData, QAGENT_OPEN: project, ...extraEnv },
  });
  current = app;
  // Read the app's output so its pipes never fill up, and show errors
  app.process().stdout?.on('data', () => {});
  app.process().stderr?.on('data', (d) => /error/i.test(String(d)) && !/DevTools|GPU|gpu_/.test(String(d)) && process.stdout.write(`  [app] ${d}`));
  const win = await app.firstWindow();
  await win.setViewportSize({ width: 1280, height: 840 }).catch(() => {});
  // Playwright forces a light colour scheme by default; let the app's theme setting decide
  await win.emulateMedia({ colorScheme: null }).catch(() => {});
  return { app, win };
};
let current = null;
const shot = async (win, name) => {
  // The test window shares the desktop: if something outside the app minimised it, restore it,
  // since a minimised window paints nothing to screenshot
  const restored = await current?.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (!w?.isMinimized()) return false;
    w.restore();
    return true;
  });
  if (restored) {
    console.log(`  (window was minimised from outside before "${name}"; restored)`);
    await win.waitForTimeout(500);
  }
  return win.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false, timeout: 15_000 }).catch(async (e) => {
    const state = await current?.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      return `visible=${w?.isVisible()} minimized=${w?.isMinimized()} focused=${w?.isFocused()}`;
    });
    throw new Error(`Screenshot ${name} failed (${state}): ${e.message.split('\n')[0]}`);
  });
};

// 1. A configured project: run tests from the window
const fixture = path.join(ROOT, 'fixtures', 'react-router-app');
fs.rmSync(path.join(fixture, 'qagent-results.xlsx'), { force: true });
console.log('Configured project: run from the window');
{
  const { app, win } = await launch(fixture);
  await win.getByRole('heading', { name: 'Run tests' }).waitFor({ timeout: 30_000 });
  check(true, 'opens on the Run screen');
  await win.getByText('Full regression', { exact: true }).click();
  await win.getByText('Type username and password').click();
  await win.getByPlaceholder('Username or email').fill('demo');
  await win.getByPlaceholder('Password').fill('demo');
  check(
    !(await win.locator('label.chip', { hasText: 'Security scan' }).locator('input').isDisabled()) &&
      !(await win.locator('label.chip', { hasText: 'Accessibility' }).locator('input').isDisabled()),
    'Accessibility and Security scan are available',
  );
  await win.waitForTimeout(2000); // let the start-up sequence finish
  await shot(win, '1-run');
  await win.getByRole('button', { name: /Run 2 test types/ }).click();
  await win.getByRole('heading', { name: 'Scan in progress' }).waitFor({ timeout: 30_000 });
  // Mid-scan: blips on the radar and pages in progress
  await win.waitForTimeout(7000);
  await shot(win, '2-running');
  // The window is on screen: if someone clicks another screen, the run continues; come back to it
  const runScreen = async () => {
    const deadline = Date.now() + 3 * 60_000;
    while (Date.now() < deadline) {
      if (await win.getByRole('heading', { name: /Scan complete|Scan aborted/ }).isVisible()) return;
      if (!(await win.getByRole('heading', { name: /Scan in progress|Aborting scan/ }).isVisible())) await win.getByRole('button', { name: 'Run tests' }).click();
      await win.waitForTimeout(1000);
    }
    throw new Error('timeout');
  };
  await runScreen()
    .catch(async (e) => {
      const state = await win.evaluate(() => `${document.querySelector('h1')?.textContent} | ${document.querySelector('pre.log')?.textContent}`).catch((x) => `window not answering: ${x.message}`);
      throw new Error(`Run did not finish. Window state: ${state}\n${e.message}`);
    });
  await shot(win, '3-run-finished');
  check(await win.getByText(/Results were added to/).isVisible(), 'run finished and wrote the workbook');
  check((await win.locator('.res.failed').count()) >= 4, 'failed pages are listed (fixture has 4 broken pages)');

  await win.getByRole('button', { name: 'View results' }).click();
  await win.locator('.tiles').waitFor({ timeout: 15_000 });
  await shot(win, '4-results-sheet');
  check((await win.locator('table.data tbody tr').count()) >= 4, 'results sheet shows rows from the workbook');
  await win.getByRole('button', { name: '← All runs' }).click();
  await win.getByRole('columnheader', { name: 'Run time' }).waitFor();
  check((await win.locator('table.data tbody tr').count()) === 2, 'Run History shows both runs');
  await shot(win, '5-results-history');

  await win.getByRole('button', { name: 'Pages' }).click();
  await win.getByRole('heading', { name: 'Pages' }).waitFor();
  check(await win.getByText('/orders/:orderId').isVisible(), 'Pages lists routes with their IDs');
  await win.getByRole('button', { name: 'Find new pages' }).click();
  // The fixture folder is not its own git repository: the panel must say so, not fail silently
  await win.getByText(/not a git repository|Base branch not found/i).first().waitFor({ timeout: 15_000 }).then(
    () => check(true, 'New since the base branch explains why it cannot compare'),
    () => check(false, 'New since the base branch explains why it cannot compare'),
  );
  await shot(win, '6-pages');

  await win.getByRole('button', { name: 'Flows' }).click();
  await win.getByRole('heading', { name: 'Flows', exact: true }).waitFor();
  check(await win.getByText('Open closed orders').isVisible(), 'Flows lists the recorded critical flows');
  check(await win.getByText('/colors').isVisible(), 'Flows lists the CRUD screen');
  await win.getByRole('button', { name: /Open closed orders/ }).click();
  await shot(win, '6b-flows');

  await win.getByRole('button', { name: 'Project settings' }).click();
  await win.getByRole('heading', { name: 'Project settings' }).waitFor();
  await shot(win, '7-settings');
  await win.getByRole('tab', { name: 'Raw JSON' }).click();
  await win.getByLabel('.qagent.json').fill('{ "workers": "three" }');
  await win.getByText(/\/workers must be integer/).waitFor({ timeout: 5000 }).then(
    () => check(true, 'raw JSON is validated against the schema'),
    () => check(false, 'raw JSON is validated against the schema'),
  );
  await shot(win, '8-settings-json');

  await win.getByRole('button', { name: 'App settings' }).click();
  await win.getByRole('heading', { name: 'App settings' }).waitFor();
  await shot(win, '9-app-settings');
  await win.getByText('Dark', { exact: true }).click();
  await win.getByRole('button', { name: 'Run tests' }).click();
  await win.waitForTimeout(400);
  check((await win.evaluate(() => getComputedStyle(document.body).backgroundColor)) === 'rgb(5, 8, 15)', 'dark theme applies');
  await shot(win, '10-run-dark');
  await win.getByRole('button', { name: 'App settings' }).click();
  await win.getByText('Follow the system').click();

  await win.getByRole('button', { name: 'Projects' }).click();
  await win.getByRole('heading', { name: 'Projects' }).waitFor();
  check(await win.getByText('fixture-react-router').first().isVisible(), 'recent projects remembers the fixture');
  await shot(win, '11-projects');
  await app.close();
}

// 2. The security scan from the window: findings on the Results screen
console.log('Security scan from the window');
{
  const { app, win } = await launch(fixture);
  await win.getByRole('heading', { name: 'Run tests' }).waitFor({ timeout: 30_000 });
  await win.waitForTimeout(2000);
  await win.getByText('Smoke', { exact: true }).click();
  await win.getByText('Security scan', { exact: true }).click();
  await win.getByText('Type username and password').click();
  await win.getByPlaceholder('Username or email').fill('demo');
  await win.getByPlaceholder('Password', { exact: true }).fill('demo');
  await win.getByPlaceholder('Low-permission username').fill('viewer');
  await win.getByPlaceholder('Low-permission password').fill('viewer');
  await shot(win, '13-security-run');
  await win.getByRole('button', { name: /Run Security scan/ }).click();
  await win.getByRole('heading', { name: /Scan complete|Scan aborted/ }).waitFor({ timeout: 6 * 60_000 });
  await win.getByRole('button', { name: 'View results' }).click();
  await win.getByRole('heading', { name: /Security findings/ }).waitFor({ timeout: 15_000 });
  check((await win.locator('.res', { hasText: 'High' }).count()) > 0, 'findings show on the Results screen with severity');
  await shot(win, '14-security-findings');
  await app.close();
}

// 3. First launch: the tour. The user moves with Previous / Next / Skip; nothing advances by itself
console.log('First launch: guided tour');
{
  const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'qagent-tour-'));
  const { app, win } = await launch('', { QAGENT_USER_DATA: fresh, QAGENT_OPEN: '' });
  const card = win.locator('.tour-card');
  const title = (t) => card.getByRole('heading', { name: t, exact: true }).waitFor({ timeout: 15_000 });
  const press = (name) => card.getByRole('button', { name }).click();
  await title('Welcome to QAgent');
  check(true, 'the tour opens on a fresh install');
  check(await card.getByRole('button', { name: 'Skip tour' }).isVisible(), 'Skip tour is offered');
  await win.waitForTimeout(2000); // let the start-up sequence finish
  await shot(win, '15-tour-welcome');
  await press(/Start the tour/);
  await title('A project is a folder');
  check((await win.locator('[data-tour="project"]').innerText()).length > 0, 'the tour opened the demo project');
  await press(/Previous/);
  await title('Welcome to QAgent');
  check(true, 'Previous goes back a step');
  await press(/Start the tour/);
  await title('A project is a folder');
  await press(/^Next/);
  await title('Where to test');
  await press(/^Next/);
  await title('Choose what to test');
  check(await card.locator('.tour-details li').count() > 0, 'each step explains the feature in detail');
  // The user clicks the real control: the tour waits for Next
  await win.locator('[data-tour="type-regression"]').click();
  await win.waitForTimeout(1500);
  check(await card.getByRole('heading', { name: 'Choose what to test', exact: true }).isVisible(), 'the tour does not move on by itself');
  await shot(win, '16-tour-step');
  await press(/^Next/);
  await title('Logging in');
  // Next performs the step's action when the user has not
  await press(/Choose Skip login/);
  await title('Run the tests');
  check(await win.locator('[data-tour="login"] input[type=radio]:checked').evaluate((r) => r.parentElement.textContent.includes('Skip')), 'Next chose Skip login on the real screen');
  await press(/Start the run/);
  await title('Watching the scan');
  // Right after starting, the scan is running: Next is replaced by a waiting note
  check(await card.getByText('The scan is still running').isVisible() && !(await card.getByRole('button', { name: /^Next/ }).count()), 'Next waits while the scan runs');
  await card.getByRole('button', { name: /^Next/ }).waitFor({ timeout: 3 * 60_000 });
  check(true, 'a real run on the demo shop finished inside the tour');
  await press(/^Next/);
  await title('It found real problems');
  await press(/Open the results/);
  await title('Every result, explained');
  await card.getByRole('button', { name: /^Next/ }).waitFor({ timeout: 15_000 });
  check((await win.locator('.res.failed').count()) > 0, 'the demo shop shows its planted failure');
  await shot(win, '17-tour-results');
  for (const t of ['Pages', 'Flows', 'Your turn']) {
    await press(/^Next/);
    await title(t);
  }
  await shot(win, '17b-tour-last');
  await press(/Finish/);
  await card.waitFor({ state: 'detached' });
  check(JSON.parse(fs.readFileSync(path.join(fresh, 'settings.json'), 'utf8')).tourDone === true, 'finishing the tour is remembered');
  await app.close();

  // The next start does not show it again
  const again = await launch('', { QAGENT_USER_DATA: fresh, QAGENT_OPEN: '' });
  await again.win.getByRole('heading', { name: 'Projects' }).waitFor({ timeout: 15_000 });
  await again.win.waitForTimeout(1500);
  check(!(await again.win.locator('.tour-card').count()), 'the tour does not come back on the next start');
  await again.app.close();
  fs.rmSync(fresh, { recursive: true, force: true });
}

// 4. After an update: what's new
console.log("After an update: what's new and in-app updates");
{
  const updated = fs.mkdtempSync(path.join(os.tmpdir(), 'qagent-upd-'));
  seasoned(updated, { lastSeenVersion: '0.0.9' });
  const { app, win } = await launch('', { QAGENT_USER_DATA: updated, QAGENT_OPEN: '', QAGENT_FAKE_UPDATE: '9.9.9' });
  const modal = win.locator('.modal');
  await modal.getByRole('heading', { name: "What's new" }).waitFor({ timeout: 15_000 });
  check(await modal.getByText(VERSION).first().isVisible(), `what's new shows the notes of ${VERSION}`);
  await win.waitForTimeout(2200); // the start-up sequence covers it at first
  await shot(win, '18-whats-new');
  await modal.getByRole('button', { name: 'Got it' }).click();
  await modal.waitFor({ state: 'detached' });
  check(JSON.parse(fs.readFileSync(path.join(updated, 'settings.json'), 'utf8')).lastSeenVersion === VERSION, 'this version is remembered as seen');

  // A newer release: download inside the app, then restart to install
  const bar = win.locator('.update-bar');
  await bar.getByText('QAgent 9.9.9').waitFor({ timeout: 15_000 });
  await shot(win, '19-update-available');
  await bar.getByRole('button', { name: 'Download' }).click();
  await bar.getByText(/Downloading QAgent 9.9.9/).waitFor({ timeout: 5000 });
  await bar.getByRole('button', { name: 'Restart now' }).waitFor({ timeout: 10_000 });
  check(true, 'an available update downloads in the app with progress');
  await bar.getByRole('button', { name: 'Restart now' }).click();
  await bar.getByText(/Installing QAgent 9.9.9/).waitFor({ timeout: 5000 });
  check(true, 'restart to install is offered and started');
  await app.close();
  fs.rmSync(updated, { recursive: true, force: true });
}

// 5. A project with no .qagent.json: first-time setup
console.log('New project: first-time setup');
{
  const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'qagent-new-'));
  const src = path.join(ROOT, 'fixtures', 'nextjs-app');
  for (const item of ['package.json', 'app', 'pages', 'middleware.js']) fs.cpSync(path.join(src, item), path.join(fresh, item), { recursive: true });
  fs.writeFileSync(path.join(fresh, '.env.development'), 'NEXT_PUBLIC_SITE_URL=https://dev.shop.example\nNEXT_PUBLIC_API_URL=https://dev-api.shop.example');
  fs.mkdirSync(path.join(fresh, 'lib'));
  fs.writeFileSync(path.join(fresh, 'app', 'checkout.js'), "export const pay = () => fetch('/api/payments/charge', { method: 'POST' });\nexport const list = () => fetch('/api/payments/history');");
  const { app, win } = await launch(fresh);
  await win.getByRole('heading', { name: 'Set up project' }).waitFor({ timeout: 30_000 });
  check(true, 'opens on Setup when there is no .qagent.json');
  check((await win.locator('input[type="url"]').nth(2).inputValue()) === 'https://dev.shop.example', 'Dev URL detected from .env.development');
  check(await win.getByText('/api/payments/charge').isVisible(), 'side-effect endpoint offered for blocking');
  check(!(await win.getByText('/api/payments/history').count()), 'read-only endpoint not offered');
  await shot(win, '12-setup');
  await win.getByRole('button', { name: 'Save and continue' }).click();
  await win.getByRole('heading', { name: 'Run tests' }).waitFor({ timeout: 15_000 });
  const saved = JSON.parse(fs.readFileSync(path.join(fresh, '.qagent.json'), 'utf8'));
  check(saved.environments?.dev?.url === 'https://dev.shop.example' && saved.blockedEndpoints?.includes('/api/payments/charge'), '.qagent.json written with URLs and blocked endpoints');
  check(fs.readFileSync(path.join(fresh, '.gitignore'), 'utf8').includes('qagent-results.xlsx'), '.gitignore updated');
  await app.close();
  fs.rmSync(fresh, { recursive: true, force: true });
}

fs.rmSync(userData, { recursive: true, force: true });
console.log(failures.length ? `\n${failures.length} check(s) failed` : `\nAll app checks passed. Screenshots: ${OUT}`);
process.exitCode = failures.length ? 1 : 0;
