/**
 * Writes each run into the project's results workbook (qagent-results.xlsx):
 *
 *  - "Guide" (first sheet), rebuilt on every write
 *  - "Run History": one row per environment × test type, with a link to its sheet
 *  - one designed sheet per run: title band, summary tiles, pass-rate formula,
 *    then an Excel table of every page and tab with failures first
 *
 * The whole file is rewritten each time, so features exceljs does not
 * understand (charts, pivots) would not survive: keep the workbook for results.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import ExcelJS from 'exceljs';
import type { Workbook, Worksheet } from 'exceljs';
import { ENV_LABEL, TEST_TYPE_LABEL, type PageResult } from '../../shared/types';
import { countResults, type JobResult, type PageRecord } from '../records';
import { writeGuide } from './guide';
import { C, argb, colLetter, font, resultStyle, solid, thin } from './style';

const HISTORY = 'Run History';

export interface RunMeta {
  projectName: string;
  runBy: string;
  device: string;
}

const SHORT_TYPE: Record<string, string> = {
  smoke: 'Smoke', impact: 'Impact', regression: 'Regression', flows: 'Flows', crud: 'CRUD', a11y: 'A11y',
  perf: 'Perf', links: 'Links', responsive: 'Responsive', visual: 'Visual', security: 'Security',
};

const text = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'number' ? v : String(v).slice(0, 32000));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Desktop Excel locks the file while it is open: wait up to a minute, then give up. */
const waitUntilWritable = async (file: string, log: (s: string) => void) => {
  if (!fs.existsSync(file)) return;
  for (let i = 0; i < 20; i++) {
    try {
      fs.closeSync(fs.openSync(file, 'r+'));
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code ?? '';
      if (!['EBUSY', 'EPERM', 'EACCES'].includes(code)) throw e;
      if (i === 0) log(`"${path.basename(file)}" is open in desktop Excel — close it to save results (waiting up to 1 minute)…`);
      await sleep(3000);
    }
  }
  throw new Error(`Workbook is locked: "${file}" is open in desktop Excel`);
};

const sheetName = (job: JobResult, wb: Workbook) => {
  const d = new Date(job.startedAt);
  const p = (x: number) => String(x).padStart(2, '0');
  let name = `${ENV_LABEL[job.env]} ${SHORT_TYPE[job.type]} ${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}`
    .replace(/[[\]:*?/\\]/g, '')
    .slice(0, 28);
  const taken = new Set(wb.worksheets.map((s) => s.name.toLowerCase()));
  const base = name;
  for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${base.slice(0, 26)} ${i}`;
  return name;
};

const sectionTitle = (ws: Worksheet, row: number, title: string, lastCol: number) => {
  const c = ws.getCell(`A${row}`);
  c.value = title;
  c.font = font({ bold: true, size: 13, color: C.navy });
  for (let i = 1; i <= lastCol; i++) ws.getCell(row, i).border = { bottom: { style: 'medium', color: { argb: argb(C.accent) } } };
  ws.getRow(row).height = 22;
};

interface Column {
  key: string;
  label: string;
  wrap?: boolean;
  center?: boolean;
}

/** Title row + Excel table (filter buttons), navy header, coloured Result column. */
const writeSection = (ws: Worksheet, tableName: string, startRow: number, title: string, columns: Column[], rows: Record<string, unknown>[], resultKey: string | null) => {
  sectionTitle(ws, startRow, title, columns.length);
  const headerRow = startRow + 1;
  const body = rows.length ? rows : [Object.fromEntries(columns.map((c, i) => [c.key, i === 0 ? 'No rows' : '']))];
  ws.addTable({
    name: tableName,
    ref: `A${headerRow}`,
    headerRow: true,
    style: { theme: 'TableStyleLight1', showRowStripes: false },
    columns: columns.map((c) => ({ name: c.label, filterButton: true })),
    rows: body.map((r) => columns.map((c) => text(r[c.key]))),
  });

  const hr = ws.getRow(headerRow);
  hr.height = 24;
  columns.forEach((c, i) => {
    const cell = hr.getCell(i + 1);
    cell.fill = solid(C.navy);
    cell.font = font({ bold: true, color: C.white });
    cell.alignment = { vertical: 'middle', horizontal: c.center ? 'center' : 'left' };
  });

  body.forEach((r, idx) => {
    const row = ws.getRow(headerRow + 1 + idx);
    columns.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      cell.font = font();
      cell.alignment = { vertical: 'top', wrapText: !!c.wrap, horizontal: c.center ? 'center' : 'left' };
      cell.border = { bottom: thin };
      if (idx % 2 === 1) cell.fill = solid(C.band);
      if (c.key === resultKey && rows.length) {
        const st = resultStyle(String(r[c.key]));
        cell.fill = solid(st.fill);
        cell.font = font({ bold: true, color: st.font });
        cell.alignment = { vertical: 'top', horizontal: 'center' };
      }
    });
  });
  return headerRow + body.length + 3;
};

const ORDER: Record<PageResult, number> = { failed: 0, unverified: 1, skipped: 2, passed: 3 };

const details = (r: PageRecord) =>
  r.problems
    .filter((p) => p.severity !== 'info' || ['missing-test-data', 'inaccessible-permission', 'session-rejected', 'login-required', 'configured-skip', 'logout-page', 'smoke-gate', 'cancelled', 'not-checked', 'blocked-by-firewall', 'no-pages-opened', 'qagent-error'].includes(p.type))
    .map((p) => `[${p.severity}] ${p.type}: ${p.detail}`)
    .join(' | ')
    .slice(0, 4000);

// Run History columns; who/where come last so older rows keep their place
const HISTORY_COLUMNS: [string, number][] = [
  ['Run time', 22], ['Environment', 14], ['Test type', 20], ['Result', 12], ['Passed', 10], ['Failed', 10],
  ['Skipped', 11], ['Unverified', 13], ['Pass rate', 12], ['Sheet', 10], ['Run by', 20], ['Device', 18], ['App account', 22],
];
const CENTERED = new Set([3, 4, 5, 6, 7, 8, 9]);

const ensureHistory = (wb: Workbook, projectName: string) => {
  const ws =
    wb.getWorksheet(HISTORY) ||
    wb.addWorksheet(HISTORY, { properties: { tabColor: { argb: argb(C.navy) } }, views: [{ state: 'frozen', ySplit: 4, showGridLines: false }] });
  const last = colLetter(HISTORY_COLUMNS.length);
  for (const r of [1, 2]) {
    ws.unMergeCells(`A${r}`);
    ws.mergeCells(`A${r}:${last}${r}`);
  }
  Object.assign(ws.getCell('A1'), {
    value: `QAgent · ${projectName} — Run History`,
    font: font({ bold: true, size: 18, color: C.white }),
    fill: solid(C.navy),
    alignment: { vertical: 'middle', indent: 1 },
  });
  ws.getRow(1).height = 40;
  Object.assign(ws.getCell('A2'), {
    value: 'Every run, newest at the bottom. Click "Open" to jump to that run’s sheet. Run by / Device / App account show who ran it, where, and as which app user.',
    font: font({ italic: true, color: C.muted }),
  });
  HISTORY_COLUMNS.forEach(([label, width], i) => {
    const cell = ws.getCell(4, i + 1);
    cell.value = label;
    cell.fill = solid(C.navy);
    cell.font = font({ bold: true, color: C.white });
    cell.alignment = { vertical: 'middle', horizontal: CENTERED.has(i) ? 'center' : 'left' };
    ws.getColumn(i + 1).width = width;
  });
  ws.getRow(4).height = 24;
  return ws;
};

const writeRunSheet = (wb: Workbook, job: JobResult, meta: RunMeta) => {
  const name = sheetName(job, wb);
  const tableId = `T${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 9, showGridLines: false }] });
  const c = countResults(job.records);
  const overall = resultStyle(job.status);
  ws.properties.tabColor = { argb: argb(overall.font) };
  const when = new Date(job.startedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  const minutes = Math.max(1, Math.round((job.endedAt - job.startedAt) / 60000));

  ws.mergeCells('A1:J1');
  Object.assign(ws.getCell('A1'), {
    value: `QAgent · ${meta.projectName}  ·  ${ENV_LABEL[job.env]}  ·  ${TEST_TYPE_LABEL[job.type]}`,
    font: font({ bold: true, size: 18, color: C.white }),
    fill: solid(C.navy),
    alignment: { vertical: 'middle', indent: 1 },
  });
  ws.getRow(1).height = 42;
  ws.mergeCells('A2:J2');
  Object.assign(ws.getCell('A2'), {
    value:
      `${when}  ·  ${job.baseUrl}  ·  ${job.readOnly ? 'Read-only (GET only)' : 'Writes allowed'}  ·  ${minutes} min  ·  Overall: ${job.status.toUpperCase()}` +
      `  ·  Run by ${meta.runBy || 'unknown'} on ${meta.device || 'unknown'} as ${job.appAccount || 'no login'}`,
    font: font({ italic: true, color: C.muted }),
    fill: solid(C.surface),
    alignment: { vertical: 'middle', indent: 1 },
  });
  ws.getRow(2).height = 22;

  // Summary tiles: label row 4, big number row 5; pass rate is a live formula
  const denom = c.passed + c.failed + c.unverified;
  // The cached result shows in viewers that do not recalculate (previews, mobile)
  const rateCell = { formula: 'IFERROR(A5/(A5+C5+G5),"—")', result: denom ? c.passed / denom : '—' };
  const tiles: [string, string, string, number | typeof rateCell, { fill: string; font: string }][] = [
    ['A', 'B', 'Passed', c.passed, C.passed],
    ['C', 'D', 'Failed', c.failed, C.failed],
    ['E', 'F', 'Skipped', c.skipped, C.skipped],
    ['G', 'H', 'Unverified', c.unverified, C.unverified],
    ['I', 'J', 'Pass rate', rateCell, C.info],
  ];
  for (const [a, b, label, value, st] of tiles) {
    ws.mergeCells(`${a}4:${b}4`);
    ws.mergeCells(`${a}5:${b}5`);
    Object.assign(ws.getCell(`${a}4`), {
      value: label.toUpperCase(),
      font: font({ bold: true, size: 9, color: st.font }),
      fill: solid(st.fill),
      alignment: { horizontal: 'center', vertical: 'middle' },
    });
    Object.assign(ws.getCell(`${a}5`), {
      value,
      numFmt: label === 'Pass rate' ? '0%' : '0',
      font: font({ bold: true, size: 24, color: st.font }),
      fill: solid(st.fill),
      alignment: { horizontal: 'center', vertical: 'middle' },
    });
    for (const r of [4, 5]) {
      ws.getCell(`${a}${r}`).border = { left: { style: 'thick', color: { argb: argb(C.white) } } };
      ws.getCell(`${b}${r}`).border = { right: { style: 'thick', color: { argb: argb(C.white) } } };
    }
  }
  ws.getRow(4).height = 20;
  ws.getRow(5).height = 40;

  const pages = job.records.filter((r) => r.kind === 'page');
  const tabs = job.records.filter((r) => r.kind === 'tab');
  ws.mergeCells('A6:J6');
  Object.assign(ws.getCell('A6'), {
    value: [
      `Pages: ${pages.length}`,
      `Tabs: ${tabs.length} (${tabs.filter((t) => t.result === 'failed').length} failed)`,
      `Console errors: ${job.records.reduce((s, r) => s + r.consoleErrors, 0)}`,
      `Failed API calls: ${job.records.reduce((s, r) => s + r.failedApi, 0)}`,
      ...job.notes,
    ].join('   ·   '),
    font: font(),
    alignment: { vertical: 'middle', wrapText: true, indent: 1 },
  });
  ws.getRow(6).height = 32;

  [26, 26, 16, 12, 24, 70, 13, 12, 12, 40].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  const rows = [...job.records]
    .sort((a, b) => ORDER[a.result] - ORDER[b.result] || a.route.localeCompare(b.route))
    .map((r) => ({
      route: r.route,
      what: r.kind === 'tab' || r.kind === 'flow' || r.kind === 'crud' || r.kind === 'check' ? r.tabPath : r.kind === 'page' ? (r.heading ?? '') : r.kind === 'login' ? 'Login' : 'Site reachable',
      kind: r.kind,
      result: r.result,
      reason: r.classification,
      details: details(r),
      console: r.consoleErrors,
      api: r.failedApi,
      ms: r.perf?.loadToReadyMs ?? r.durationMs,
      file: r.file ?? '',
    }));
  const next = writeSection(
    ws,
    `${tableId}_pages`,
    8,
    'Page & tab results',
    [
      { key: 'route', label: 'Page' },
      { key: 'what', label: 'Heading / tab', wrap: true },
      { key: 'kind', label: 'Kind' },
      { key: 'result', label: 'Result' },
      { key: 'reason', label: 'Reason', wrap: true },
      { key: 'details', label: 'Details', wrap: true },
      { key: 'console', label: 'Console errs', center: true },
      { key: 'api', label: 'Failed API', center: true },
      { key: 'ms', label: 'Time (ms)', center: true },
      { key: 'file', label: 'Source file' },
    ],
    rows,
    'result',
  );
  if (job.findings) {
    const rank: Record<string, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 };
    writeSection(
      ws,
      `${tableId}_sec`,
      next,
      'Security findings',
      [
        { key: 'severity', label: 'Severity' },
        { key: 'check', label: 'Check', wrap: true },
        { key: 'url', label: 'URL or file', wrap: true },
        { key: 'evidence', label: 'Evidence', wrap: true },
        { key: 'fix', label: 'How to fix', wrap: true },
      ],
      [...job.findings].sort((a, b) => rank[a.severity] - rank[b.severity]).map((f) => ({ ...f })),
      null,
    );
  }
  return { ws, name };
};

const addHistoryRow = (history: Worksheet, job: JobResult, meta: RunMeta, sheet: string | null) => {
  const c = countResults(job.records);
  const denom = c.passed + c.failed + c.unverified;
  const hr = Math.max(history.lastRow ? history.lastRow.number : 0, 4) + 1;
  const values = [
    new Date(job.startedAt).toLocaleString('en-GB'),
    ENV_LABEL[job.env],
    TEST_TYPE_LABEL[job.type],
    job.status,
    c.passed,
    c.failed,
    c.skipped,
    c.unverified,
    denom ? c.passed / denom : '—',
    sheet ? { text: 'Open', hyperlink: `#'${sheet.replace(/'/g, "''")}'!A1` } : '—',
    meta.runBy,
    meta.device,
    job.appAccount || '—',
  ];
  const st = resultStyle(job.status);
  values.forEach((val, i) => {
    const cell = history.getCell(hr, i + 1);
    cell.value = val as any;
    cell.font = font();
    cell.border = { bottom: thin };
    cell.alignment = { vertical: 'middle', horizontal: CENTERED.has(i) ? 'center' : 'left' };
    if ((hr - 5) % 2 === 1) cell.fill = solid(C.band);
  });
  history.getCell(hr, 9).numFmt = '0%';
  history.getCell(hr, 4).fill = solid(st.fill);
  history.getCell(hr, 4).font = font({ bold: true, color: st.font });
  if (sheet) history.getCell(hr, 10).font = font({ color: C.accent, underline: true });
  history.autoFilter = { from: 'A4', to: `${colLetter(HISTORY_COLUMNS.length)}${hr}` };
};

/** Adds the runs' sheets and Run History rows to `wb`; returns the new sheet names. */
export const addRuns = (wb: Workbook, jobs: JobResult[], meta: RunMeta) => {
  // A brand-new workbook carries an empty "Sheet1"
  for (const ws of [...wb.worksheets]) if (/^Sheet\d*$/.test(ws.name) && ws.actualRowCount === 0) wb.removeWorksheet(ws.id);
  const history = ensureHistory(wb, meta.projectName);
  const added: Worksheet[] = [];
  for (const job of jobs) {
    // Types skipped by the smoke gate get a history row but no sheet
    if (job.status === 'skipped' && !job.records.length) {
      addHistoryRow(history, job, meta, null);
      continue;
    }
    const { ws, name } = writeRunSheet(wb, job, meta);
    addHistoryRow(history, job, meta, name);
    added.push(ws);
  }
  const guide = writeGuide(wb, meta.projectName);
  const older = wb.worksheets.filter((w) => w !== guide && w !== history && !added.includes(w));
  // Guide, Run History, newest runs, older runs
  // orderNo is real in exceljs but missing from its types
  [guide, history, ...added.reverse(), ...older].forEach((w, i) => ((w as any).orderNo = i));
  return added.map((w) => w.name);
};

/**
 * Updates the workbook safely: waits for desktop Excel's lock, keeps a safety
 * copy in the temp folder until the write succeeds, builds the new file in
 * temp, then copies it over in one write (synced folders see one ordinary edit).
 */
export const writeWorkbook = async (file: string, jobs: JobResult[], meta: RunMeta, log: (s: string) => void) => {
  if (!/\.xlsx$/i.test(file)) throw new Error(`The results file must be an .xlsx file: ${file}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await waitUntilWritable(file, log);
  const exists = fs.existsSync(file);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safetyCopy = exists ? path.join(os.tmpdir(), `${path.basename(file, '.xlsx')}-before-${stamp}.xlsx`) : null;
  if (safetyCopy) fs.copyFileSync(file, safetyCopy);
  const wb = new ExcelJS.Workbook();
  if (exists) await wb.xlsx.readFile(file);
  wb.creator = 'QAgent';
  const sheets = addRuns(wb, jobs, meta);
  const tmp = path.join(os.tmpdir(), `qagent-${process.pid}-${Date.now()}.xlsx`);
  try {
    await wb.xlsx.writeFile(tmp);
    await waitUntilWritable(file, log);
    // Copy into the existing file rather than rename over it: the file keeps its identity for sync clients
    fs.copyFileSync(tmp, file);
    if (safetyCopy) fs.unlinkSync(safetyCopy);
    return sheets;
  } catch (e) {
    if (safetyCopy) (e as Error).message += ` — the workbook as it was before this write is at ${safetyCopy}`;
    throw e;
  } finally {
    fs.rmSync(tmp, { force: true });
  }
};

/** When the workbook cannot be written, results are kept as JSON for a later retry. */
export const writeFallback = (dir: string, jobs: JobResult[], meta: RunMeta) => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify({ meta, jobs }, null, 2), 'utf8');
  return dir;
};
