import { useEffect, useMemo, useState } from 'react';
import type { HistoryRow, ProjectView, SheetView } from '../../shared/ipc';
import type { PageResult } from '../../shared/types';
import { api } from '../api';
import { FileLink, Notice, PageHead, Result, Tiles } from '../components';

const FILTERS: (PageResult | 'all')[] = ['all', 'failed', 'unverified', 'skipped', 'passed'];

/** The workbook's "[severity] type: detail | …" text, one problem per line, the first three shown. */
function Details({ text }: { text: string }) {
  const [all, setAll] = useState(false);
  if (!text) return null;
  const items = [...new Set(text.split(' | ').map((s) => s.trim()).filter(Boolean))];
  const shown = all ? items : items.slice(0, 3);
  return (
    <div className="details">
      {shown.map((s, i) => (
        <div key={i} style={{ marginTop: 2 }}>
          {s.length > 300 && !all ? `${s.slice(0, 300)}…` : s}
        </div>
      ))}
      {(items.length > 3 || items.some((s) => s.length > 300)) && (
        <button className="btn link small" onClick={() => setAll(!all)}>
          {all ? 'Show less' : `Show all${items.length > 3 ? ` (${items.length})` : ''}`}
        </button>
      )}
    </div>
  );
}

export default function Results({ project, sheet, onSheet }: { project: ProjectView; sheet: string | null; onSheet: (s: string | null) => void }) {
  const [history, setHistory] = useState<HistoryRow[] | null>(null);
  const [view, setView] = useState<SheetView | null>(null);
  const [filter, setFilter] = useState<PageResult | 'all'>('all');
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState(0);
  const [approved, setApproved] = useState<number | null>(null);

  useEffect(() => {
    api.pendingBaselines(project.root).then(setPending);
  }, [project.root, sheet]);

  const approve = async () => {
    setApproved(await api.approveBaselines(project.root));
    setPending(0);
  };

  // New screenshots wait for approval after a Visual change run
  const approveBar = pending > 0 && (
    <Notice kind="info">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span>
          {pending} page(s) look different from their approved screenshot. Diffs are in <code>.qagent/baselines</code>. If the change is intended, approve it.
        </span>
        <button className="btn" onClick={approve}>
          Approve visual changes
        </button>
      </div>
    </Notice>
  );
  const approvedNote = approved !== null && <Notice kind="ok">{approved} screenshot(s) approved as the new baseline.</Notice>;

  useEffect(() => {
    api.readHistory(project.root).then(setHistory);
  }, [project.root]);

  useEffect(() => {
    setView(null);
    setFilter('all');
    if (sheet) api.readSheet(project.root, sheet).then(setView);
  }, [project.root, sheet]);

  const counts = useMemo(() => {
    const c = { passed: 0, failed: 0, skipped: 0, unverified: 0 };
    for (const r of view?.rows ?? []) c[r.result] = (c[r.result] ?? 0) + 1;
    return c;
  }, [view]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (view?.rows ?? []).filter((r) => (filter === 'all' || r.result === filter) && (!q || `${r.page} ${r.what} ${r.reason} ${r.details}`.toLowerCase().includes(q)));
  }, [view, filter, query]);

  const openFile = (file: string) => api.openFile(project.root, file);

  if (sheet && view) {
    return (
      <div className="page">
        <PageHead title={view.name} subtitle={view.subtitle}>
          <button className="btn" onClick={() => onSheet(null)}>
            ← All runs
          </button>
          <button className="btn" onClick={() => api.openResults(project.root)}>
            Open in Excel
          </button>
        </PageHead>
        {approveBar}
        {approvedNote}
        <Tiles {...counts} />
        {view.summary && <p className="muted small">{view.summary}</p>}
        <div className="row" style={{ margin: '12px 0' }}>
          <div className="toggle-group">
            {FILTERS.map((f) => (
              <label key={f} className={`chip ${filter === f ? 'on' : ''}`}>
                <input type="radio" checked={filter === f} onChange={() => setFilter(f)} />
                {f} {f !== 'all' && <span className="muted small">{counts[f]}</span>}
              </label>
            ))}
          </div>
          <input type="text" placeholder="Search pages, reasons, details" value={query} onChange={(e) => setQuery(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
        </div>
        {view.findings.length > 0 && (
          <div className="card flush">
            <div style={{ padding: '16px 20px 6px' }}>
              <h2>Security findings · {view.findings.length}</h2>
            </div>
            <table className="data">
              <thead>
                <tr>
                  <th>Severity</th>
                  <th>Check</th>
                  <th>URL or file</th>
                  <th>Evidence and fix</th>
                </tr>
              </thead>
              <tbody>
                {view.findings.map((f, i) => (
                  <tr key={i}>
                    <td>
                      <span className={`res ${f.severity === 'Low' ? 'skipped' : 'failed'}`}>{f.severity}</span>
                    </td>
                    <td>{f.check}</td>
                    <td className="details">{f.url}</td>
                    <td>
                      <div>{f.evidence}</div>
                      <div className="details">{f.fix}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="card flush" data-tour="results">
          <table className="data">
            <thead>
              <tr>
                <th>Page</th>
                <th>Heading / tab</th>
                <th>Result</th>
                <th>Reason and details</th>
                <th className="num">Time (ms)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>
                    <div className="mono">{r.page}</div>
                    <FileLink file={r.file} onOpen={openFile} />
                  </td>
                  <td>
                    {r.what} {r.kind !== 'page' && <span className="tag">{r.kind}</span>}
                  </td>
                  <td>
                    <Result value={r.result} />
                  </td>
                  <td>
                    <div>{r.reason}</div>
                    <Details text={r.details} />
                  </td>
                  <td className="num">{r.ms || ''}</td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={5} className="empty">
                    Nothing matches.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHead title="Results" subtitle={project.resultsFile}>
        {history && history.length > 0 && (
          <button className="btn" onClick={() => api.openResults(project.root)}>
            Open in Excel
          </button>
        )}
      </PageHead>
      {approveBar}
      {approvedNote}
      {sheet && !view && <p className="muted">Loading…</p>}
      {history && history.length === 0 && <div className="empty">No runs yet. Results appear here after the first run.</div>}
      {history && history.length > 0 && (
        <div className="card flush">
          <table className="data">
            <thead>
              <tr>
                <th>Run time</th>
                <th>Environment</th>
                <th>Test type</th>
                <th>Result</th>
                <th className="num">Passed</th>
                <th className="num">Failed</th>
                <th className="num">Skipped</th>
                <th className="num">Unverified</th>
                <th className="num">Pass rate</th>
                <th>Run by</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h, i) => (
                <tr key={i} className={h.sheet ? 'clickable' : ''} onClick={() => h.sheet && onSheet(h.sheet)} title={h.sheet ? 'Show this run' : 'Skipped: no sheet'}>
                  <td>{h.runTime}</td>
                  <td>{h.env}</td>
                  <td>{h.type}</td>
                  <td>
                    <Result value={h.result} />
                  </td>
                  <td className="num">{h.passed}</td>
                  <td className="num">{h.failed}</td>
                  <td className="num">{h.skipped}</td>
                  <td className="num">{h.unverified}</td>
                  <td className="num">{h.passRate === null ? '—' : `${Math.round(h.passRate * 100)}%`}</td>
                  <td className="muted">
                    {h.runBy}
                    {h.appAccount && h.appAccount !== '—' ? ` as ${h.appAccount}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
