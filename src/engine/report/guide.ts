import type { Workbook, Worksheet } from 'exceljs';
import { C, font, solid } from './style';

/**
 * The "Guide" sheet: what each sheet shows, result meanings, common reasons,
 * the test types, environments, safety rules and troubleshooting. Rebuilt on
 * every write so it always matches this version of QAgent.
 */
export const GUIDE = 'Guide';

const TEST_TYPES: [string, string, string, string][] = [
  ['Smoke', 'The site starts, login works, and the home and top menu pages load. Runs first; if it fails, the other chosen types are skipped for that environment.', 'No', 'Local, Dev, Test, Live'],
  ['Change-impact', 'Only pages affected by your git changes since a base branch, with all their tabs.', 'No', 'Local, Dev'],
  ['Full regression', 'Every page and tab: console errors, failed API calls, blank views, endless loaders, hung requests.', 'No (GET only)', 'Local, Dev, Test, Live'],
  ['Critical flows', 'The project’s most important journeys, step by step.', 'Only if allowed; never on Live', 'Local, Dev, Test, Live'],
  ['CRUD', 'Creates, edits and deletes a QAgent-… test record on chosen screens, then cleans up.', 'Yes — never on Live', 'Local, Dev, Test'],
  ['Accessibility', 'WCAG 2.1 AA on every page (axe-core); critical and serious issues fail the page.', 'No', 'Local, Dev, Test, Live'],
  ['Performance', 'Time to ready, slowest API call and LCP per page against budgets (warn 5 s, fail 15 s, API 3 s, LCP 4 s).', 'No', 'Local, Dev, Test, Live'],
  ['Broken links', 'Links that return 404, missing images, scripts and styles, mixed http/https.', 'No', 'Local, Dev, Test, Live'],
  ['Responsive', 'Phone (390 px) and tablet (820 px) widths: cut-off content, sideways scrolling, overlaps.', 'No', 'Local, Dev, Test, Live'],
  ['Visual change', 'Screenshot of each page compared with the last approved baseline.', 'No', 'Local, Dev, Test, Live'],
  ['Security scan', 'Passive checks everywhere; active checks full on Local and Dev, restricted on Test and Live.', 'No (stored XSS on Local and Dev only)', 'Local, Dev, Test, Live'],
];

const RESULTS: [string, { fill: string; font: string }, string][] = [
  ['passed', C.passed, 'Content rendered, data loaded, tabs worked, no errors.'],
  ['failed', C.failed, 'A real problem was found — see Reason and Details.'],
  ['skipped', C.skipped, 'The logged-in account may not open the page (sent back to the home page), or the page is set to be skipped. Not a defect.'],
  ['unverified', C.unverified, 'Not really checked: login skipped or failed, or the page needs a record ID that was not set.'],
];

const REASONS: [string, string][] = [
  ['page-http-error', 'The page itself returned an HTTP error (404, 500…).'],
  ['navigation-failed', 'The browser could not open the page at all (server down, DNS, certificate).'],
  ['api-5xx / api-4xx / api-request-failed', 'An API call failed while the page loaded — usually a back-end defect.'],
  ['uncaught-exception / render-error', 'JavaScript crashed, or an error screen was shown — app defect.'],
  ['data-load-failure', 'The page showed "no data" while its API calls failed.'],
  ['hung-request / permanent-loader', 'A request never finished, or a spinner never went away.'],
  ['blank-view', 'Nothing visible rendered.'],
  ['session-rejected / login-required', 'Sent to the login page: login failed, expired or was skipped. Not checked, so unverified.'],
  ['missing-test-data', 'The page needs a record ID. Set it in .qagent/test-data.<env>.json.'],
  ['inaccessible-permission', 'Sent back to the home page: the account may not open it. Reported as skipped.'],
  ['legitimate-empty (info)', 'The page is empty but every API call succeeded — real "no records".'],
  ['empty-after-blocked-request (warning)', 'The page is empty and QAgent blocked a non-GET call. If it only reads data, add it to readOnlyAllow in .qagent.json.'],
];

const SHEETS: [string, string][] = [
  ['Guide', 'This sheet. Rebuilt on every run.'],
  ['Run History', 'One row per run: time, environment, test type, result, counts, pass rate, link to its sheet, who ran it, where, and as which app user.'],
  ['<Env> <Type> <MM-DD HH.MM>', 'One sheet per run, newest first. Title band, summary tiles, then every page and tab with failures first. Tab colour: green passed, red failed, grey unverified.'],
];

const ENVIRONMENTS: [string, string][] = [
  ['Local', 'Your machine. QAgent starts the app with the start command in .qagent.json if it is not already running.'],
  ['Dev / Test', 'Shared servers. Their URLs are in .qagent.json.'],
  ['Live', 'Production. Read-only test types only; you type LIVE to start (LIVE SECURITY for the security scan). CRUD is never offered.'],
];

const SAFETY = [
  'Read-only by default: every request other than GET, HEAD and OPTIONS is blocked in the browser before it reaches the server (GraphQL queries and calls listed in readOnlyAllow are let through).',
  'Endpoints that email, ship, book, charge or call third parties (blockedEndpoints in .qagent.json) are blocked in every test type, CRUD included.',
  'No CRUD on Live. Live runs need LIVE typed to start.',
  'Login every run. Credentials and sessions are never stored; the session folder is deleted when the run ends.',
  'Only the project’s own domain is tested; fonts and CDNs load but are never scanned or crawled.',
  'A page that was not really checked is unverified, never passed.',
];

const TROUBLE: [string, string][] = [
  ['Every page unverified', 'Login was skipped or failed. Run again and log in.'],
  ['"Workbook is locked"', 'Close it in desktop Excel. That run’s results were kept in .qagent/results/.'],
  ['Local run never starts', 'Check local.start and local.url in .qagent.json, and that the back end is running.'],
  ['A page needing an ID is unverified', 'Add the ID to .qagent/test-data.<env>.json.'],
  ['Many session-rejected late in a long run', 'The login expired during the run. Log in again and rerun.'],
  ['Pages empty with "empty-after-blocked-request"', 'The page reads data with POST. Add that call to readOnlyAllow, e.g. "POST /api/orders/search".'],
];

const header = (ws: Worksheet, row: number, labels: string[]) => {
  labels.forEach((l, i) => {
    const c = ws.getCell(row, i + 1);
    c.value = l;
    c.fill = solid(C.navy);
    c.font = font({ bold: true, color: C.white });
    c.alignment = { vertical: 'middle' };
  });
  ws.getRow(row).height = 22;
};

const section = (ws: Worksheet, row: number, title: string) => {
  const c = ws.getCell(row, 1);
  c.value = title;
  c.font = font({ bold: true, size: 13, color: C.navy });
  for (let i = 1; i <= 4; i++) ws.getCell(row, i).border = { bottom: { style: 'medium', color: { argb: `FF${C.accent}` } } };
  ws.getRow(row).height = 24;
  return row + 1;
};

const rows = (ws: Worksheet, start: number, data: (string | { v: string; style?: { fill: string; font: string } })[][]) => {
  data.forEach((r, idx) => {
    r.forEach((v, i) => {
      const c = ws.getCell(start + idx, i + 1);
      const val = typeof v === 'string' ? v : v.v;
      c.value = val;
      c.font = font();
      c.alignment = { vertical: 'top', wrapText: true };
      if (idx % 2 === 1) c.fill = solid(C.band);
      if (typeof v !== 'string' && v.style) {
        c.fill = solid(v.style.fill);
        c.font = font({ bold: true, color: v.style.font });
      }
    });
  });
  return start + data.length + 1;
};

export const writeGuide = (wb: Workbook, projectName: string): Worksheet => {
  const old = wb.getWorksheet(GUIDE);
  if (old) wb.removeWorksheet(old.id);
  const ws = wb.addWorksheet(GUIDE, { properties: { tabColor: { argb: `FF${C.accent}` } }, views: [{ showGridLines: false }] });
  [30, 70, 26, 26].forEach((w, i) => (ws.getColumn(i + 1).width = w));

  ws.mergeCells('A1:D1');
  Object.assign(ws.getCell('A1'), {
    value: `QAgent · ${projectName} — Guide`,
    font: font({ bold: true, size: 18, color: C.white }),
    fill: solid(C.navy),
    alignment: { vertical: 'middle', indent: 1 },
  });
  ws.getRow(1).height = 40;
  ws.mergeCells('A2:D2');
  Object.assign(ws.getCell('A2'), {
    value: 'Results of QAgent runs on this project. Run tests from VS Code: QAgent: Run tests. Settings live in .qagent.json at the project root.',
    font: font({ italic: true, color: C.muted }),
  });

  let r = 4;
  r = section(ws, r, 'Sheets');
  header(ws, r, ['Sheet', 'What it shows']);
  r = rows(ws, r + 1, SHEETS.map(([a, b]) => [a, b]));

  r = section(ws, r, 'Results');
  header(ws, r, ['Result', 'Meaning']);
  r = rows(ws, r + 1, RESULTS.map(([k, st, m]) => [{ v: k, style: st }, m]));
  // The blank row after the table holds the pass-rate note
  ws.mergeCells(r - 1, 1, r - 1, 2);
  Object.assign(ws.getCell(r - 1, 1), { value: 'Pass rate = passed ÷ (passed + failed + unverified). Skipped pages do not count.', font: font({ italic: true, color: C.muted }) });
  r++;

  r = section(ws, r, 'Common reasons');
  header(ws, r, ['Reason', 'What it means']);
  r = rows(ws, r + 1, REASONS.map(([a, b]) => [a, b]));

  r = section(ws, r, 'Test types');
  header(ws, r, ['Test type', 'What it checks', 'Writes data', 'Environments']);
  r = rows(ws, r + 1, TEST_TYPES.map((t) => [...t]));

  r = section(ws, r, 'Environments');
  header(ws, r, ['Environment', 'Notes']);
  r = rows(ws, r + 1, ENVIRONMENTS.map(([a, b]) => [a, b]));

  r = section(ws, r, 'Safety rules');
  r = rows(ws, r, SAFETY.map((s, i) => [`${i + 1}.`, s]));

  r = section(ws, r, 'Troubleshooting');
  header(ws, r, ['Symptom', 'Fix']);
  rows(ws, r + 1, TROUBLE.map(([a, b]) => [a, b]));
  return ws;
};
