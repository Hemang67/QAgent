// Screenshots every screen at several real window sizes, for layout and responsiveness review.
//   npm run build && node scripts/ui-sizes.mjs [outDir]
// Opens the React fixture, runs a Smoke + Full regression scan (captured mid-scan), then
// visits each screen. Opens windows on your desktop while it runs.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { _electron as electron } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(process.argv[2] ?? path.join(ROOT, 'test-results', 'sizes'));
const electronPath = createRequire(import.meta.url)('electron');
const { ELECTRON_RUN_AS_NODE: _, ...baseEnv } = process.env;
const fixture = path.join(ROOT, 'fixtures', 'react-router-app');
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

// Window content sizes: 1920×1080 at 125 % scaling, a laptop, and the minimum window
const SIZES = [
  { name: 'wide', width: 1536, height: 830 },
  { name: 'laptop', width: 1280, height: 760 },
  { name: 'min', width: 960, height: 620 },
];

fs.mkdirSync(OUT, { recursive: true });
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'qagent-sizes-'));
fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ tourDone: true, lastSeenVersion: VERSION, theme: 'dark' }));

const app = await electron.launch({
  executablePath: electronPath,
  args: ['--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', ROOT],
  env: { ...baseEnv, QAGENT_USER_DATA: userData, QAGENT_OPEN: fixture },
});
const win = await app.firstWindow();
await win.emulateMedia({ colorScheme: null }).catch(() => {});
const resize = (w, h) =>
  app.evaluate(({ BrowserWindow }, [w, h]) => {
    const b = BrowserWindow.getAllWindows()[0];
    if (b.isMaximized()) b.unmaximize();
    b.setContentSize(w, h);
  }, [w, h]);
const shotAll = async (name) => {
  for (const s of SIZES) {
    await resize(s.width, s.height);
    await win.waitForTimeout(350);
    await win.screenshot({ path: path.join(OUT, `${name}-${s.name}.png`) });
  }
  await resize(SIZES[0].width, SIZES[0].height);
};
const nav = (label) => win.locator('.sidebar').getByRole('button', { name: label, exact: true }).click();

await win.getByRole('heading', { name: 'Run tests' }).waitFor({ timeout: 30_000 });
await win.waitForTimeout(2200);
await shotAll('run');

// A real scan, captured while pages are being tested
await win.getByText('Full regression', { exact: true }).click();
await win.getByText('Type username and password').click();
await win.getByPlaceholder('Username or email').fill('demo');
await win.getByPlaceholder('Password', { exact: true }).fill('demo');
await win.getByRole('button', { name: /^▶ Run/ }).click();
await win.locator('.target').first().waitFor({ timeout: 60_000 });
await shotAll('scan');
await win.getByRole('heading', { name: /Scan complete|Scan aborted/ }).waitFor({ timeout: 4 * 60_000 });
await shotAll('scan-done');

await win.getByRole('button', { name: 'View results' }).click();
await win.locator('.tiles').waitFor();
await shotAll('results-sheet');
await win.getByRole('button', { name: '← All runs' }).click();
await win.getByRole('columnheader', { name: 'Run time' }).waitFor();
await shotAll('results');

for (const [label, name] of [['Pages', 'pages'], ['Flows', 'flows'], ['Project settings', 'settings'], ['App settings', 'app-settings'], ['Projects', 'projects']]) {
  await nav(label);
  await win.waitForTimeout(400);
  await shotAll(name);
}
await app.close();
fs.rmSync(userData, { recursive: true, force: true });
console.log(`Screenshots in ${OUT}`);
