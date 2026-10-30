import { useEffect, useState } from 'react';
import type { QAgentConfig } from '../../shared/config';
import type { ProjectView } from '../../shared/ipc';
import { api } from '../api';
import { Notice, PageHead } from '../components';

const lines = (v: string[] | undefined) => (v ?? []).join('\n');
const fromLines = (s: string) => s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
const numOrUndef = (s: string) => (s.trim() === '' ? undefined : Number(s));

/** .qagent.json as a form, or as raw JSON; both validated against the schema before saving. */
export default function Settings({ project, onSaved, onSetup }: { project: ProjectView; onSaved: () => void; onSetup: () => void }) {
  const [tab, setTab] = useState<'form' | 'json'>('form');
  const [cfg, setCfg] = useState<QAgentConfig>(project.config);
  const [json, setJson] = useState(JSON.stringify(project.config, null, 2));
  const [errors, setErrors] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setCfg(project.config);
    setJson(JSON.stringify(project.config, null, 2));
  }, [project.config]);

  // Live validation of the raw JSON
  useEffect(() => {
    if (tab !== 'json') return;
    const t = setTimeout(async () => {
      try {
        setErrors((await api.validateConfig(JSON.parse(json))).errors);
      } catch (e) {
        setErrors([`Not valid JSON: ${(e as Error).message}`]);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [json, tab]);

  const switchTab = (to: 'form' | 'json') => {
    if (to === tab) return;
    if (to === 'json') setJson(JSON.stringify(cfg, null, 2));
    else {
      try {
        setCfg(JSON.parse(json));
      } catch {
        setErrors(['Fix the JSON before switching to the form']);
        return;
      }
    }
    setErrors([]);
    setTab(to);
  };

  const patch = (fn: (c: QAgentConfig) => QAgentConfig) => {
    setSaved(false);
    setCfg((c) => fn(structuredClone(c)));
  };

  const save = async () => {
    let config = cfg;
    if (tab === 'json') {
      try {
        config = JSON.parse(json);
      } catch (e) {
        setErrors([`Not valid JSON: ${(e as Error).message}`]);
        return;
      }
    }
    const r = await api.saveConfig(project.root, config);
    setErrors(r.errors);
    if (r.ok) {
      setSaved(true);
      onSaved();
    }
  };

  const env = (name: 'dev' | 'test' | 'live') => cfg.environments?.[name];
  // URLs read from .env files are used when the setting is empty; show them as the placeholder
  const detected = (name: 'local' | 'dev' | 'test' | 'live') => (project.urls[name]?.url ? `${project.urls[name]!.url} (from .env files)` : '');
  const setEnv = (name: 'dev' | 'test' | 'live', key: 'url' | 'apiUrl', v: string) =>
    patch((c) => {
      const e = { ...(c.environments?.[name] ?? { url: '' }), [key]: v.trim() };
      if (!e.apiUrl) delete e.apiUrl;
      c.environments = { ...c.environments, [name]: e };
      if (!e.url) delete c.environments[name];
      return c;
    });

  return (
    <div className="page">
      <PageHead title="Project settings" subtitle={<><code>.qagent.json</code> in {project.root}</>}>
        <button className="btn" onClick={onSetup}>
          Set up again
        </button>
        <button className="btn primary" onClick={save}>
          Save
        </button>
      </PageHead>
      {saved && !errors.length && <Notice kind="ok">Saved.</Notice>}
      {errors.length > 0 && (
        <Notice kind="error">
          {errors.map((e) => (
            <div key={e}>{e}</div>
          ))}
        </Notice>
      )}
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'form'} className={`tab ${tab === 'form' ? 'on' : ''}`} onClick={() => switchTab('form')}>
          Settings
        </button>
        <button role="tab" aria-selected={tab === 'json'} className={`tab ${tab === 'json' ? 'on' : ''}`} onClick={() => switchTab('json')}>
          Raw JSON
        </button>
      </div>

      {tab === 'json' ? (
        <textarea value={json} onChange={(e) => (setSaved(false), setJson(e.target.value))} spellCheck={false} style={{ width: '100%', minHeight: 520 }} aria-label=".qagent.json" />
      ) : (
        <>
          <div className="card">
            <h2>Environments</h2>
            <div className="stack">
              <div className="grid-2" style={{ gridTemplateColumns: '80px 1fr 1fr' }}>
                <strong>Local</strong>
                <label className="field">
                  Site URL
                  <input type="url" value={cfg.local?.url ?? ''} placeholder={detected('local')} onChange={(e) => patch((c) => ({ ...c, local: { ...c.local, url: e.target.value.trim() || undefined } }))} />
                </label>
                <label className="field">
                  Start command
                  <input type="text" value={cfg.local?.start ?? ''} onChange={(e) => patch((c) => ({ ...c, local: { ...c.local, start: e.target.value || undefined } }))} />
                </label>
              </div>
              {(['dev', 'test', 'live'] as const).map((name) => (
                <div className="grid-2" key={name} style={{ gridTemplateColumns: '80px 1fr 1fr' }}>
                  <strong style={{ textTransform: 'capitalize' }}>{name}</strong>
                  <label className="field">
                    Site URL
                    <input type="url" value={env(name)?.url ?? ''} placeholder={detected(name)} onChange={(e) => setEnv(name, 'url', e.target.value)} />
                  </label>
                  <label className="field">
                    API URL
                    <input type="url" value={env(name)?.apiUrl ?? ''} disabled={!env(name)?.url} onChange={(e) => setEnv(name, 'apiUrl', e.target.value)} />
                  </label>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <h2>Login</h2>
            <div className="grid-2">
              {(
                [
                  ['path', 'Login page', '/login'],
                  ['loggedInPath', 'Page that means "logged in"', '/dashboard'],
                  ['logoutPath', 'Logout URL (optional)', '/logout'],
                  ['accountSelector', 'Element with the user name (optional)', '.navbar .user-name'],
                ] as const
              ).map(([key, label, ph]) => (
                <label className="field" key={key}>
                  {label}
                  <input type="text" placeholder={ph} value={cfg.login?.[key] ?? ''} onChange={(e) => patch((c) => ({ ...c, login: { ...c.login, [key]: e.target.value || undefined } }))} />
                </label>
              ))}
            </div>
          </div>

          <div className="card">
            <h2>Pages and safety</h2>
            <div className="grid-2">
              <label className="field">
                Smoke pages, one per line (empty = top menu pages)
                <textarea rows={6} value={lines(cfg.lists?.smoke)} onChange={(e) => patch((c) => ({ ...c, lists: { ...c.lists, smoke: fromLines(e.target.value) } }))} />
              </label>
              <label className="field">
                Blocked endpoints, one per line (never called, in any test type)
                <textarea rows={6} value={lines(cfg.blockedEndpoints)} onChange={(e) => patch((c) => ({ ...c, blockedEndpoints: fromLines(e.target.value) }))} />
              </label>
              <label className="field">
                Read-only calls that use POST, one per line, e.g. <code>POST /api/orders/search</code>
                <textarea rows={4} value={lines(cfg.readOnlyAllow)} onChange={(e) => patch((c) => ({ ...c, readOnlyAllow: fromLines(e.target.value) }))} />
              </label>
              <div className="stack">
                <label className="field">
                  Results workbook
                  <input type="text" value={cfg.results?.file ?? ''} placeholder="qagent-results.xlsx" onChange={(e) => patch((c) => ({ ...c, results: { file: e.target.value || undefined } }))} />
                </label>
                <label className="field">
                  Page discovery
                  <select value={cfg.discovery ?? 'auto'} onChange={(e) => patch((c) => ({ ...c, discovery: e.target.value as 'auto' | 'crawl' }))}>
                    <option value="auto">From the code (crawl when none found)</option>
                    <option value="crawl">Always crawl the running site</option>
                  </select>
                </label>
              </div>
            </div>
          </div>

          <div className="card">
            <h2>Speed and limits</h2>
            <div className="grid-2" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
              {(
                [
                  ['workers', 'Pages at the same time', 3, (c: QAgentConfig) => c.workers, (c: QAgentConfig, v?: number) => ({ ...c, workers: v })],
                  ['crawlLimit', 'Crawl page limit', 300, (c: QAgentConfig) => c.crawlLimit, (c: QAgentConfig, v?: number) => ({ ...c, crawlLimit: v })],
                  ['timeout', 'Page timeout (ms)', 30000, (c: QAgentConfig) => c.readiness?.readyTimeoutMs, (c: QAgentConfig, v?: number) => ({ ...c, readiness: { ...c.readiness, readyTimeoutMs: v } })],
                  ['readyWarnMs', 'Slow page warning (ms)', 5000, (c: QAgentConfig) => c.budgets?.readyWarnMs, (c: QAgentConfig, v?: number) => ({ ...c, budgets: { ...c.budgets, readyWarnMs: v } })],
                  ['readyFailMs', 'Slow page failure (ms)', 15000, (c: QAgentConfig) => c.budgets?.readyFailMs, (c: QAgentConfig, v?: number) => ({ ...c, budgets: { ...c.budgets, readyFailMs: v } })],
                  ['apiWarnMs', 'Slow API warning (ms)', 3000, (c: QAgentConfig) => c.budgets?.apiWarnMs, (c: QAgentConfig, v?: number) => ({ ...c, budgets: { ...c.budgets, apiWarnMs: v } })],
                ] as const
              ).map(([key, label, ph, get, set]) => (
                <label className="field" key={key}>
                  {label}
                  <input type="number" placeholder={String(ph)} value={get(cfg) ?? ''} onChange={(e) => patch((c) => set(c, numOrUndef(e.target.value)))} />
                </label>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
