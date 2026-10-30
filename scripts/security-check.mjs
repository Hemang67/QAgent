// Runs the security scan on the React fixture, whose flaws are planted, in full
// mode (Local) and restricted mode (Test), and proves restricted mode wrote nothing.
//   node scripts/security-check.mjs   (part of npm run test:e2e)
import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ExcelJS from 'exceljs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = path.join(ROOT, 'fixtures', 'react-router-app');
const results = path.join(fixture, 'qagent-results.xlsx');
const base = 'http://localhost:5179';
let failures = 0;
const check = (ok, what) => {
  console.log(`  ${ok ? '✔' : '✖'} ${what}`);
  if (!ok) failures++;
};

const up = () => fetch(base).then(() => true, () => false);
let server = null;
if (!(await up())) {
  server = spawn('npm run dev', { cwd: fixture, shell: true, stdio: 'ignore', windowsHide: true, detached: process.platform !== 'win32' });
  for (let i = 0; i < 60 && !(await up()); i++) await new Promise((r) => setTimeout(r, 1000));
}
const reset = () => fetch(`${base}/api/test/reset`, { method: 'POST', headers: { Authorization: 'Bearer fixture-token' } });
const state = () => fetch(`${base}/api/test/state`).then((r) => r.json());

const scan = async (env) => {
  fs.rmSync(results, { force: true });
  await reset();
  const p = spawnSync(process.execPath, [path.join(ROOT, 'dist', 'cli.js'), 'run', fixture, '--env', env, '--types', 'security', '--login', 'credentials', '--low-login', 'credentials'], {
    env: { ...process.env, QAGENT_USERNAME: 'demo', QAGENT_PASSWORD: 'demo', QAGENT_LOW_USERNAME: 'viewer', QAGENT_LOW_PASSWORD: 'viewer' },
    encoding: 'utf8',
    timeout: 10 * 60_000,
  });
  if (!fs.existsSync(results)) throw new Error(`No workbook:\n${p.stdout}\n${p.stderr}`);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(results);
  const ws = wb.worksheets[2];
  const rows = {};
  const findings = [];
  let all = '';
  let last = 9;
  let inFindings = false;
  ws.eachRow((r, i) => {
    all += JSON.stringify(r.values);
    if (i <= 9) return;
    if (i > last + 1) inFindings = true;
    last = i;
    if (!inFindings) rows[String(r.getCell(1).value)] = String(r.getCell(4).value);
    else if (['Critical', 'High', 'Medium', 'Low'].includes(String(r.getCell(1).value))) findings.push({ severity: r.getCell(1).value, check: r.getCell(2).value, url: String(r.getCell(3).value), evidence: String(r.getCell(4).value) });
  });
  return { rows, findings, all };
};

try {
  console.log('Full scan (Local): every planted flaw is found');
  const full = await scan('local');
  const want = {
    'Secrets in code': 'failed',
    'Security headers': 'passed', // on this machine: noted as Low, not a failure
    'HTTPS / TLS': 'passed',
    'Tokens in browser storage': 'failed',
    'Exposed files and URLs': 'failed',
    'Logged-out access': 'failed',
    'Role checks (IDOR)': 'failed',
    'Open redirect': 'failed',
    'Reflected XSS': 'failed',
    'SQL injection signals': 'failed',
    'Stored XSS': 'failed',
    'Login rate limit': 'failed',
  };
  for (const [name, result] of Object.entries(want)) check(full.rows[name] === result, `${name}: ${full.rows[name]} (expected ${result})`);
  check(['passed', 'failed', 'unverified'].includes(full.rows['Vulnerable libraries']), `Vulnerable libraries ran: ${full.rows['Vulnerable libraries']}`);
  check(full.findings.some((f) => f.check === 'Logged-out access' && f.url.includes('/api/open-orders')), 'the API that answers without a login is named');
  check(full.findings.some((f) => f.check === 'Logged-out access') && !full.findings.some((f) => f.check === 'Logged-out access' && f.url.includes('/api/colors')), 'protected APIs are not reported');
  check(!/fixture-fake-value-1234|fixture-fake-env-value|fixture-token/.test(full.all), 'secret and token values are masked in the workbook');
  const afterFull = await state();
  check(afterFull.guestbook >= 1, `Stored XSS really saved a test entry (${afterFull.guestbook})`);
  check(afterFull.loginAttempts >= 10, `Rate-limit check tried wrong passwords (${afterFull.loginAttempts} login calls)`);

  console.log('Restricted scan (Test): reads only');
  const restricted = await scan('test');
  check(restricted.rows['Stored XSS'] === 'skipped', `Stored XSS not run: ${restricted.rows['Stored XSS']}`);
  check(restricted.rows['Login rate limit'] === 'skipped', `Login rate limit not run: ${restricted.rows['Login rate limit']}`);
  check(restricted.rows['Reflected XSS'] === 'failed', 'Reflected XSS still found through URL parameters');
  check(restricted.rows['SQL injection signals'] === 'failed', 'SQL signals still found through GET parameters');
  const afterRestricted = await state();
  check(afterRestricted.guestbook === 0, `no entry was saved (${afterRestricted.guestbook})`);
  check(afterRestricted.loginAttempts === 2, `only the two real logins reached the server (${afterRestricted.loginAttempts})`);
} finally {
  if (server) {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    else process.kill(-server.pid, 'SIGTERM');
  }
}
console.log(failures ? `\n${failures} security check(s) failed` : '\nSecurity scan as expected');
process.exitCode = failures ? 1 : 0;
