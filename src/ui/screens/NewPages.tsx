import { useEffect, useState } from 'react';
import type { QAgentConfig } from '../../shared/config';
import type { EndpointCandidate, ProjectView } from '../../shared/ipc';
import { ENV_LABEL, ENV_NAMES, type EnvName, type RouteInfo } from '../../shared/types';
import { api } from '../api';
import { FileLink, Notice } from '../components';

type Page = RouteInfo & { configured: boolean };
interface Answer {
  smoke: boolean;
  skip: string;
  /** Parameter → test-data key */
  keys: Record<string, string>;
  /** Parameter → record ID on the chosen environment */
  ids: Record<string, string>;
}

/**
 * Pages and risky endpoints added since the base branch, with the same questions as
 * OMS's e2e:add-page. Answers go to .qagent.json (shared) and record IDs to
 * .qagent/test-data.<env>.json (this machine only).
 */
export default function NewPages({ project, onSaved }: { project: ProjectView; onSaved: () => void }) {
  const [base, setBase] = useState(project.config.baseBranch ?? '');
  const [found, setFound] = useState<{ base: string; pages: Page[]; endpoints: EndpointCandidate[] } | null>(null);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [block, setBlock] = useState<string[]>([]);
  const [env, setEnv] = useState<EnvName>(ENV_NAMES.find((e) => project.urls[e]) ?? 'local');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);
  const [reminder, setReminder] = useState<Awaited<ReturnType<typeof api.reminderStatus>> | null>(null);

  useEffect(() => {
    api.reminderStatus(project.root).then(setReminder);
  }, [project.root]);

  const find = async () => {
    setBusy(true);
    setError('');
    setSaved('');
    const r = await api.newPages(project.root, base.trim() || undefined);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setFound(r);
    setBlock(r.endpoints.map((e) => e.endpoint));
    setAnswers(
      Object.fromEntries(
        r.pages.map((p) => {
          const cfg = project.config.pages?.[p.path];
          const keys = Object.fromEntries(p.params.map((x) => [x, cfg?.params?.[x.replace(/^\?/, '')] ?? x.replace(/^\?/, '')]));
          return [p.path, { smoke: !!project.config.lists?.smoke?.includes(p.path), skip: cfg?.skip ?? '', keys, ids: {} }];
        }),
      ),
    );
  };

  const set = (route: string, patch: Partial<Answer>) => setAnswers((a) => ({ ...a, [route]: { ...a[route], ...patch } }));

  const save = async () => {
    if (!found) return;
    const c: QAgentConfig = structuredClone(project.config);
    c.lists = { ...c.lists, smoke: [...(c.lists?.smoke ?? [])] };
    c.pages = { ...c.pages };
    const testData: Record<string, string> = {};
    for (const p of found.pages) {
      const a = answers[p.path];
      if (a.smoke && !c.lists.smoke!.includes(p.path)) c.lists.smoke!.push(p.path);
      if (!a.smoke) c.lists.smoke = c.lists.smoke!.filter((x) => x !== p.path);
      const params = Object.fromEntries(Object.entries(a.keys).map(([param, key]) => [param.replace(/^\?/, ''), key.trim() || param.replace(/^\?/, '')]));
      if (p.params.length || a.skip) c.pages[p.path] = { ...(p.params.length ? { params } : {}), ...(a.skip ? { skip: a.skip } : {}) };
      for (const [param, id] of Object.entries(a.ids)) if (id.trim()) testData[params[param.replace(/^\?/, '')]] = id.trim();
    }
    c.blockedEndpoints = [...new Set([...(c.blockedEndpoints ?? []), ...block])];
    const r = await api.saveConfig(project.root, c);
    if (!r.ok) return setError(r.errors.join('; '));
    if (Object.keys(testData).length) await api.saveTestData(project.root, env, testData);
    setSaved(`Saved to .qagent.json${Object.keys(testData).length ? ` and .qagent/test-data.${env}.json` : ''}. Review with git diff, then commit .qagent.json with your feature.`);
    onSaved();
  };

  const install = async () => setReminder(await api.installReminder(project.root));

  return (
    <div className="card">
      <div className="section-title">
        <h2>New since the base branch</h2>
        <span className="label">add new pages</span>
      </div>
      <p className="muted small">Finds pages and send/book/charge calls added since the base branch (committed, uncommitted and new files) and asks only what QAgent cannot work out.</p>
      <div className="row" style={{ marginBottom: 12 }}>
        <input type="text" value={base} placeholder="origin/development, then origin/main" onChange={(e) => setBase(e.target.value)} style={{ minWidth: 280 }} aria-label="Base branch" />
        <button className="btn primary" onClick={find} disabled={busy}>
          {busy ? 'Looking…' : 'Find new pages'}
        </button>
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      {saved && <Notice kind="ok">{saved}</Notice>}

      {found && (
        <>
          <p className="label">
            Compared with {found.base}: {found.pages.length} new page(s), {found.endpoints.length} new endpoint(s)
          </p>
          {found.pages.map((p) => {
            const a = answers[p.path];
            return (
              <div className="env-login" key={p.path} style={{ gridTemplateColumns: '1fr' }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span>
                    <span className="mono">{p.path}</span> <FileLink file={p.file} onOpen={(f) => api.openFile(project.root, f)} /> {p.configured && <span className="tag">set up</span>}
                  </span>
                  <label className="check small">
                    <input type="checkbox" checked={a.smoke} disabled={p.params.length > 0} onChange={(e) => set(p.path, { smoke: e.target.checked })} />
                    Daily key page: add to Smoke
                  </label>
                </div>
                {p.params.map((param) => (
                  <div className="row small" key={param}>
                    <span className="muted">Needs {param.startsWith('?') ? `?${param.slice(1)}=` : `:${param}`} · test-data key</span>
                    <input type="text" value={a.keys[param]} onChange={(e) => set(p.path, { keys: { ...a.keys, [param]: e.target.value } })} style={{ width: 140 }} aria-label={`Test-data key for ${param}`} />
                    <span className="muted">record ID on {ENV_LABEL[env]} (optional)</span>
                    <input type="text" value={a.ids[param] ?? ''} placeholder="e.g. 4512" onChange={(e) => set(p.path, { ids: { ...a.ids, [param]: e.target.value } })} style={{ width: 110 }} aria-label={`Record ID for ${param}`} />
                  </div>
                ))}
                <label className="field" style={{ maxWidth: 420 }}>
                  Never open it automatically? Give the reason (optional)
                  <input type="text" value={a.skip} placeholder="e.g. starts a long background job" onChange={(e) => set(p.path, { skip: e.target.value })} />
                </label>
              </div>
            );
          })}
          {found.pages.some((p) => p.params.length) && (
            <label className="field" style={{ maxWidth: 220, margin: '8px 0' }}>
              Record IDs are for
              <select value={env} onChange={(e) => setEnv(e.target.value as EnvName)}>
                {ENV_NAMES.filter((e) => project.urls[e]).map((e) => (
                  <option key={e} value={e}>
                    {ENV_LABEL[e]}
                  </option>
                ))}
              </select>
            </label>
          )}
          {found.endpoints.length > 0 && (
            <div className="stack" style={{ margin: '12px 0' }}>
              <span className="label">New calls that may send, book or charge: blocked in every test type, CRUD included</span>
              {found.endpoints.map((e) => (
                <label key={e.endpoint} className="check">
                  <input type="checkbox" checked={block.includes(e.endpoint)} onChange={() => setBlock((b) => (b.includes(e.endpoint) ? b.filter((x) => x !== e.endpoint) : [...b, e.endpoint]))} />
                  <code>{e.endpoint}</code> <span className="muted small">{e.file}</span>
                </label>
              ))}
            </div>
          )}
          {(found.pages.length > 0 || found.endpoints.length > 0) && (
            <button className="btn primary" onClick={save}>
              Save answers
            </button>
          )}
        </>
      )}

      <div className="row small" style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
        <span className="muted">Commit reminder (prints a hint when a commit adds a page or a send/book/charge call; never blocks):</span>
        {reminder?.state === 'installed' && <span className="res passed">on</span>}
        {reminder?.state === 'not-installed' && (
          <button className="btn" onClick={install}>
            Turn on for this clone
          </button>
        )}
        {reminder?.state === 'not-git' && <span className="muted">not a git repository</span>}
        {reminder?.state === 'other-hook' && (
          <span className="muted">
            A pre-commit hook already exists ({reminder.hookFile}). QAgent will not change it; add this line to it: <code>{reminder.line}</code>
          </span>
        )}
      </div>
    </div>
  );
}
