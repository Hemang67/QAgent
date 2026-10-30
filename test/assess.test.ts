import { describe, expect, it } from 'vitest';
import { assessView, type AssessInput } from '../src/engine/assess';
import { jobStatus, passRate, type PageRecord } from '../src/engine/records';

const base = (o: Partial<AssessInput> = {}): AssessInput => ({
  ready: { ready: true, waitedMs: 900, visibleLoaders: 0, inflight: [] },
  content: { textLength: 120, heading: 'Orders', primaryElements: { table: 1 }, hasPrimary: true, errorScreen: null, tables: [{ rows: 3, headerCells: 3 }], emptyMessages: [] },
  console: [],
  network: [],
  apiRequests: 2,
  blocked: [],
  documentStatus: 200,
  ...o,
});

const net = (status: number | null, severity: 'error' | 'warning' | 'info', category: string) => ({
  at: 0, method: 'GET', url: 'https://app.example.com/api/x', status, failure: status ? null : 'net::ERR', durationMs: 10, category, severity,
});

describe('page assessment', () => {
  it('passes a rendered page with data and no errors', () => {
    expect(assessView(base())).toMatchObject({ result: 'passed', classification: 'ok' });
  });

  it('fails on an HTTP error for the page itself', () => {
    expect(assessView(base({ documentStatus: 404 })).classification).toBe('page-http-error');
  });

  it('reports an empty page with failed API calls as a data-load failure', () => {
    const a = assessView(base({ content: { ...base().content, tables: [{ rows: 0, headerCells: 3 }] }, network: [net(500, 'error', 'api-5xx')] }));
    expect(a).toMatchObject({ result: 'failed', classification: 'data-load-failure' });
  });

  it('treats an empty page whose API calls all succeeded as legitimately empty', () => {
    const a = assessView(base({ content: { ...base().content, tables: [], emptyMessages: ['No records found'] } }));
    expect(a.result).toBe('passed');
    expect(a.problems.map((p) => p.type)).toContain('legitimate-empty');
  });

  it('warns, not fails, when the page is empty after QAgent blocked a POST', () => {
    const a = assessView(base({ content: { ...base().content, tables: [], emptyMessages: ['No data'] }, blocked: [{ method: 'POST', url: 'https://app.example.com/api/search', reason: 'read-only' }] }));
    expect(a.result).toBe('passed');
    expect(a.problems.map((p) => p.type)).toEqual(expect.arrayContaining(['empty-after-blocked-request', 'write-blocked']));
  });

  it('fails a hung request and a permanent loader', () => {
    const hung = assessView(base({ ready: { ready: false, waitedMs: 30000, visibleLoaders: 0, inflight: [{ method: 'GET', url: '/api/hang', pendingMs: 30000 }] } }));
    expect(hung.classification).toBe('hung-request');
    const loader = assessView(base({ ready: { ready: false, waitedMs: 30000, visibleLoaders: 1, inflight: [] } }));
    expect(loader.classification).toBe('permanent-loader');
  });

  it('fails a blank view', () => {
    const a = assessView(base({ content: { ...base().content, textLength: 0, hasPrimary: false, primaryElements: {}, tables: [] } }));
    expect(a.classification).toBe('blank-view');
  });

  it('picks the most important reason when several errors occur', () => {
    const a = assessView(base({ content: { ...base().content, errorScreen: 'Unexpected Application Error!' }, network: [net(500, 'error', 'api-5xx')] }));
    expect(a.classification).toBe('render-error');
  });

  it('ignores info-level console and network events', () => {
    const a = assessView(base({ console: [{ at: 0, kind: 'console', text: 'Future Flag Warning', category: 'library-notice', severity: 'info' }], network: [net(null, 'info', 'aborted')] }));
    expect(a.classification).toBe('ok');
  });
});

const rec = (result: PageRecord['result']): PageRecord => ({ route: '/x', kind: 'page', url: null, result, classification: '', problems: [], consoleErrors: 0, failedApi: 0, durationMs: 0 });

describe('run status and pass rate', () => {
  it('pass rate leaves out skipped pages but counts unverified ones', () => {
    expect(passRate([rec('passed'), rec('passed'), rec('unverified'), rec('skipped')])).toBeCloseTo(2 / 3);
    expect(passRate([rec('skipped')])).toBeNull();
  });

  it('a run with any failure is failed; one with nothing checked is unverified', () => {
    expect(jobStatus([rec('passed'), rec('failed')])).toBe('failed');
    expect(jobStatus([rec('unverified'), rec('skipped')])).toBe('unverified');
    expect(jobStatus([rec('passed'), rec('unverified')])).toBe('passed');
  });
});
