// Runs QAgent against every fixture app and compares the workbook with expected.json.
//   npm run test:e2e              all fixtures
//   npm run test:e2e -- nextjs    fixtures whose folder name contains "nextjs"
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ExcelJS from 'exceljs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'dist', 'cli.js');
const filter = process.argv[2] ?? '';

const fixtures = fs
  .readdirSync(path.join(ROOT, 'fixtures'))
  .map((d) => path.join(ROOT, 'fixtures', d))
  .filter((d) => fs.existsSync(path.join(d, 'expected.json')) && path.basename(d).includes(filter));

/** Row key: the route for pages, "kind:route" for site and login, "tab:route > tab" for tabs. */
// CRUD rows are keyed by phase only: each run uses a new QAgent-… name
const rowKey = (route, what, kind) =>
  kind === 'page' ? route : kind === 'tab' ? `tab:${route} > ${what}` : kind === 'crud' ? `crud:${route} > ${what.split(' ')[0]}` : `${kind}:${route}`;

const readRun = async (file, typeCount) => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const history = wb.getWorksheet('Run History');
  const rows = [];
  history.eachRow((r, i) => i > 4 && rows.push(r));
  const out = {};
  for (const r of rows.slice(-typeCount)) {
    const type = String(r.getCell(3).value);
    const status = String(r.getCell(4).value);
    const link = r.getCell(10).value;
    const sheetName = link && typeof link === 'object' ? /#'(.+)'!A1/.exec(link.hyperlink)[1].replace(/''/g, "'") : null;
    const pages = {};
    if (sheetName) {
      let last = 9;
      wb.getWorksheet(sheetName).eachRow((row, i) => {
        if (i <= 9 || i > last + 1) return; // title, tiles, section title, table header; a gap ends the page table
        last = i;
        const [route, what, kind, result] = [1, 2, 3, 4].map((c) => String(row.getCell(c).value ?? ''));
        if (route && route !== 'No rows') pages[rowKey(route, what, kind)] = result;
      });
    }
    out[type] = { status, pages };
  }
  return out;
};

let failures = 0;
for (const dir of fixtures) {
  const name = path.basename(dir);
  const spec = JSON.parse(fs.readFileSync(path.join(dir, 'expected.json'), 'utf8'));
  // Non-npm fixtures name their own setup (e.g. pip install --target .deps) and the folder it creates
  if (spec.setup && !fs.existsSync(path.join(dir, spec.setupCreates))) {
    console.log(`${name}: ${spec.setup}`);
    spawnSync(spec.setup, { cwd: dir, stdio: 'inherit', shell: true });
  }
  if (!spec.setup && !fs.existsSync(path.join(dir, 'node_modules'))) {
    console.log(`${name}: npm install…`);
    spawnSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: dir, stdio: 'inherit', shell: true });
  }
  const results = path.join(dir, 'qagent-results.xlsx');
  fs.rmSync(results, { force: true });

  for (const run of spec.runs) {
    const types = run.args[run.args.indexOf('--types') + 1].split(',');
    // Folders to remove first, e.g. visual baselines so the first run saves new ones
    for (const p of run.clean ?? []) fs.rmSync(path.join(dir, p), { recursive: true, force: true });
    process.stdout.write(`\n${name} — ${run.name}… `);
    const started = Date.now();
    const p = spawnSync(process.execPath, [CLI, 'run', dir, '--env', 'local', ...run.args], {
      env: { ...process.env, ...run.env },
      encoding: 'utf8',
      timeout: 10 * 60_000,
    });
    console.log(`${Math.round((Date.now() - started) / 1000)} s`);
    if (!fs.existsSync(results)) {
      failures++;
      console.log(`  ✖ no workbook written\n${p.stdout}\n${p.stderr}`);
      continue;
    }
    const actual = await readRun(results, types.length);
    for (const [type, want] of Object.entries(run.expect)) {
      const got = actual[type];
      if (!got) {
        failures++;
        console.log(`  ✖ ${type}: no Run History row`);
        continue;
      }
      if (typeof want === 'string') {
        const ok = got.status === want;
        if (!ok) failures++;
        console.log(`  ${ok ? '✔' : '✖'} ${type}: ${got.status}${ok ? '' : ` (expected ${want})`}`);
        continue;
      }
      // _partial: only the listed rows are compared (page checks list just the pages that matter)
      const { _partial, ...rows } = want;
      const keys = (_partial ? Object.keys(rows) : [...new Set([...Object.keys(rows), ...Object.keys(got.pages)])]).sort();
      const wrong = keys.filter((k) => rows[k] !== got.pages[k]);
      failures += wrong.length;
      console.log(`  ${wrong.length ? '✖' : '✔'} ${type}: ${keys.length - wrong.length}/${keys.length} rows as expected`);
      for (const k of wrong) console.log(`      ${k}: got ${got.pages[k] ?? '(missing)'}, expected ${rows[k] ?? '(not expected)'}`);
    }
  }
}

console.log(failures ? `\n${failures} mismatch(es)` : '\nAll fixtures as expected');
process.exitCode = failures ? 1 : 0;
