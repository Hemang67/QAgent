import fs from 'fs';
import os from 'os';
import path from 'path';
import ExcelJS from 'exceljs';
import { afterAll, describe, expect, it } from 'vitest';
import type { JobResult, PageRecord } from '../src/engine/records';
import { writeWorkbook } from '../src/engine/report/excel';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qagent-xlsx-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const rec = (route: string, result: PageRecord['result']): PageRecord => ({
  route, kind: 'page', url: `https://app.example.com${route}`, result, classification: result === 'failed' ? 'api-5xx' : 'ok',
  problems: result === 'failed' ? [{ type: 'api-5xx', severity: 'error', detail: 'GET /api/x → 500' }] : [], consoleErrors: 0, failedApi: result === 'failed' ? 1 : 0, durationMs: 100,
});

const job = (type: JobResult['type'], records: PageRecord[], status: JobResult['status']): JobResult => ({
  env: 'dev', type, baseUrl: 'https://app.example.com', startedAt: Date.UTC(2026, 9, 30, 10, 5), endedAt: Date.UTC(2026, 9, 30, 10, 7),
  status, records, notes: [], readOnly: true, appAccount: 'qa@example.com',
});

const meta = { projectName: 'Demo', runBy: 'Tester', device: 'PC-1' };

describe('results workbook', () => {
  const file = path.join(dir, 'qagent-results.xlsx');

  it('creates the workbook: Guide, Run History, then the run sheet with failures first', async () => {
    const sheets = await writeWorkbook(file, [job('regression', [rec('/a', 'passed'), rec('/b', 'failed'), rec('/c', 'unverified')], 'failed')], meta, () => {});
    expect(sheets).toHaveLength(1);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Guide', 'Run History', sheets[0]]);
    const ws = wb.getWorksheet(sheets[0])!;
    expect(ws.getCell('A10').value).toBe('/b'); // failures first
    expect(ws.getCell('A5').value).toBe(1); // passed tile
    expect((ws.getCell('I5').value as { formula: string }).formula).toContain('A5/(A5+C5+G5)');
    const history = wb.getWorksheet('Run History')!;
    expect(history.getCell('D5').value).toBe('failed');
    expect(history.getCell('I5').value).toBeCloseTo(1 / 3);
    expect(history.getCell('M5').value).toBe('qa@example.com');
  });

  it('appends later runs newest first, and gives gated types a history row without a sheet', async () => {
    const sheets = await writeWorkbook(file, [job('smoke', [rec('/a', 'failed')], 'failed'), job('regression', [], 'skipped')], meta, () => {});
    expect(sheets).toHaveLength(1);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    expect(wb.worksheets[2].name).toBe(sheets[0]);
    const history = wb.getWorksheet('Run History')!;
    expect(history.getCell('D7').value).toBe('skipped');
    expect(history.getCell('J7').value).toBe('—');
    // Same minute, same type: names stay unique
    expect(new Set(wb.worksheets.map((w) => w.name)).size).toBe(wb.worksheets.length);
  });

  it('refuses a results file that is not .xlsx', async () => {
    await expect(writeWorkbook(path.join(dir, 'r.csv'), [], meta, () => {})).rejects.toThrow(/\.xlsx/);
  });
});
