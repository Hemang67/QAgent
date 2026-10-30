import fs from 'fs';
import ExcelJS from 'exceljs';
import type { FindingRow, HistoryRow, SheetRow, SheetView } from '../shared/ipc';
import type { PageResult } from '../shared/types';

// The workbook is the record of every run; the Results screen reads it back.

const cellText = (v: ExcelJS.CellValue): string => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if ('text' in v) return String(v.text);
    if ('result' in v) return String(v.result ?? '');
    if ('richText' in v) return v.richText.map((r) => r.text).join('');
    if (v instanceof Date) return v.toISOString();
  }
  return String(v);
};
const num = (v: ExcelJS.CellValue) => Number(cellText(v)) || 0;

const load = async (file: string) => {
  if (!fs.existsSync(file)) return null;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  return wb;
};

/** Run History rows, newest first. */
export const readHistory = async (file: string): Promise<HistoryRow[]> => {
  const wb = await load(file);
  const ws = wb?.getWorksheet('Run History');
  if (!ws) return [];
  const rows: HistoryRow[] = [];
  ws.eachRow((r, i) => {
    if (i <= 4) return;
    const link = r.getCell(10).value;
    const sheet = link && typeof link === 'object' && 'hyperlink' in link ? (/#'(.+)'!A1/.exec(String(link.hyperlink))?.[1].replace(/''/g, "'") ?? null) : null;
    const rate = r.getCell(9).value;
    rows.push({
      runTime: cellText(r.getCell(1).value),
      env: cellText(r.getCell(2).value),
      type: cellText(r.getCell(3).value),
      result: cellText(r.getCell(4).value),
      passed: num(r.getCell(5).value),
      failed: num(r.getCell(6).value),
      skipped: num(r.getCell(7).value),
      unverified: num(r.getCell(8).value),
      passRate: typeof rate === 'number' ? rate : null,
      sheet,
      runBy: cellText(r.getCell(11).value),
      device: cellText(r.getCell(12).value),
      appAccount: cellText(r.getCell(13).value),
    });
  });
  return rows.reverse();
};

/** One run sheet: title, subtitle, notes line and the page table (rows start under the header on row 9). */
export const readSheet = async (file: string, name: string): Promise<SheetView | null> => {
  const wb = await load(file);
  const ws = wb?.getWorksheet(name);
  if (!ws) return null;
  const rows: SheetRow[] = [];
  const findings: FindingRow[] = [];
  let last = 9;
  let section = 0;
  ws.eachRow((r, i) => {
    if (i <= 9) return;
    // A gap ends the page table; then come the findings' title and header rows
    if (i > last + 1) section = 1;
    last = i;
    if (section) {
      const severity = cellText(r.getCell(1).value);
      if (['Critical', 'High', 'Medium', 'Low'].includes(severity)) findings.push({ severity, check: cellText(r.getCell(2).value), url: cellText(r.getCell(3).value), evidence: cellText(r.getCell(4).value), fix: cellText(r.getCell(5).value) });
      return;
    }
    const page = cellText(r.getCell(1).value);
    if (!page || page === 'No rows') return;
    rows.push({
      page,
      what: cellText(r.getCell(2).value),
      kind: cellText(r.getCell(3).value),
      result: cellText(r.getCell(4).value) as PageResult,
      reason: cellText(r.getCell(5).value),
      details: cellText(r.getCell(6).value),
      consoleErrors: num(r.getCell(7).value),
      failedApi: num(r.getCell(8).value),
      ms: num(r.getCell(9).value),
      file: cellText(r.getCell(10).value),
    });
  });
  return {
    name,
    title: cellText(ws.getCell('A1').value),
    subtitle: cellText(ws.getCell('A2').value),
    summary: cellText(ws.getCell('A6').value),
    rows,
    findings,
  };
};
