import { useMemo, useState } from 'react';
import type { QAgentConfig } from '../../shared/config';
import type { ProjectView } from '../../shared/ipc';
import { ENV_LABEL, ENV_NAMES, type EnvName } from '../../shared/types';
import { api } from '../api';
import { Notice, PageHead } from '../components';

type Urls = Record<EnvName, { url: string; apiUrl: string }>;

/**
 * First-time setup: confirm what was detected and fill the gaps. Writes
 * .qagent.json; everything is editable later in Project settings.
 */
export default function Setup({ project, onSaved }: { project: ProjectView; onSaved: () => void }) {
  const c = project.config;
  const [urls, setUrls] = useState<Urls>(() =>
    Object.fromEntries(ENV_NAMES.map((e) => [e, { url: project.urls[e]?.url ?? '', apiUrl: project.urls[e]?.apiUrl ?? '' }])) as Urls,
  );
  const [start, setStart] = useState(project.localStart ?? '');
  const loginRoute = project.routes.find((r) => /log-?in|sign-?in/i.test(r.path))?.path;
  const [loginPath, setLoginPath] = useState(c.login?.path ?? loginRoute ?? '/login');
  const plainRoutes = useMemo(() => project.routes.filter((r) => !r.params.length && r.path !== loginPath && !/log-?out|sign-?out/i.test(r.path)), [project.routes, loginPath]);
  const [loggedIn, setLoggedIn] = useState(c.login?.loggedInPath ?? plainRoutes.find((r) => /dashboard|home/i.test(r.path))?.path ?? '');
  const [logout, setLogout] = useState(c.login?.logoutPath ?? '');
  const [smoke, setSmoke] = useState<string[]>(c.lists?.smoke ?? []);
  const [blocked, setBlocked] = useState<string[]>(project.endpointCandidates.map((e) => e.endpoint));
  const [gitignore, setGitignore] = useState(!project.gitignoreReady);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const setUrl = (env: EnvName, key: 'url' | 'apiUrl', v: string) => setUrls((u) => ({ ...u, [env]: { ...u[env], [key]: v.trim() } }));
  const toggle = (list: string[], set: (l: string[]) => void, v: string) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const save = async () => {
    setSaving(true);
    const environments: QAgentConfig['environments'] = {};
    for (const env of ['dev', 'test', 'live'] as const) {
      if (urls[env].url) environments[env] = { url: urls[env].url, ...(urls[env].apiUrl ? { apiUrl: urls[env].apiUrl } : {}) };
    }
    const config: QAgentConfig = {
      ...c,
      framework: (c.framework ?? project.framework) as QAgentConfig['framework'],
      local: { ...c.local, ...(start ? { start } : {}), ...(urls.local.url ? { url: urls.local.url } : {}), ...(urls.local.apiUrl ? { apiUrl: urls.local.apiUrl } : {}) },
      environments,
      login: { ...c.login, path: loginPath || '/login', ...(loggedIn ? { loggedInPath: loggedIn } : {}), ...(logout ? { logoutPath: logout } : {}) },
      lists: { ...c.lists, smoke },
      blockedEndpoints: [...new Set([...(c.blockedEndpoints ?? []), ...blocked])],
      results: { file: c.results?.file ?? 'qagent-results.xlsx' },
    };
    if (!logout) delete config.login!.logoutPath;
    const r = await api.saveConfig(project.root, config, gitignore);
    setSaving(false);
    if (r.ok) onSaved();
    else setErrors(r.errors);
  };

  return (
    <div className="page">
      <PageHead
        title={project.hasConfig ? 'Set up project again' : 'Set up project'}
        subtitle={
          <>
            {project.framework} · {project.routes.length ? `${project.routes.length} pages found in the code` : 'no routes in the code: pages will be found by crawling'} · settings are saved to <code>.qagent.json</code>
          </>
        }
      />
      {errors.length > 0 && (
        <Notice kind="error">
          {errors.map((e) => (
            <div key={e}>{e}</div>
          ))}
        </Notice>
      )}

      <div className="card">
        <h2>Environments</h2>
        <p className="muted small">Found in the project's .env files. Environments without a URL are hidden on the Run screen.</p>
        <div className="stack">
          {ENV_NAMES.map((env) => (
            <div className="grid-2" key={env} style={{ gridTemplateColumns: '80px 1fr 1fr', alignItems: 'end' }}>
              <strong style={{ paddingBottom: 8 }}>{ENV_LABEL[env]}</strong>
              <label className="field">
                Site URL
                <input type="url" value={urls[env].url} placeholder={env === 'local' ? 'http://localhost:3000' : `https://${env}.example.com`} onChange={(e) => setUrl(env, 'url', e.target.value)} />
              </label>
              <label className="field">
                API URL (if on another domain)
                <input type="url" value={urls[env].apiUrl} placeholder="optional" onChange={(e) => setUrl(env, 'apiUrl', e.target.value)} />
              </label>
            </div>
          ))}
          <label className="field">
            Local start command (run when nothing answers on the local URL)
            <input type="text" value={start} placeholder="npm start" onChange={(e) => setStart(e.target.value)} />
          </label>
        </div>
      </div>

      <div className="card">
        <h2>Login</h2>
        <div className="grid-2" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
          <label className="field">
            Login page
            <input type="text" value={loginPath} onChange={(e) => setLoginPath(e.target.value)} />
          </label>
          <label className="field">
            Page that means "logged in"
            <input type="text" list="routes" value={loggedIn} placeholder="/dashboard" onChange={(e) => setLoggedIn(e.target.value)} />
          </label>
          <label className="field">
            Logout URL (optional)
            <input type="text" value={logout} placeholder="/logout" onChange={(e) => setLogout(e.target.value)} />
          </label>
        </div>
        <datalist id="routes">
          {plainRoutes.map((r) => (
            <option key={r.path} value={r.path} />
          ))}
        </datalist>
        <p className="muted small" style={{ marginTop: 8 }}>
          With a logout URL, QAgent ends the session on the server after each run. Without it, the session is only deleted on this computer.
        </p>
      </div>

      <div className="card">
        <div className="section-title">
          <h2>Smoke pages</h2>
          <span className="muted small">{smoke.length ? `${smoke.length} chosen` : 'None chosen: the top menu pages are used'}</span>
        </div>
        <p className="muted small">Pick about 10 pages most users open every day. Leave all unticked to use the menu on the home page.</p>
        <div className="toggle-group" style={{ maxHeight: 220, overflow: 'auto' }}>
          {plainRoutes.map((r) => (
            <label key={r.path} className={`chip ${smoke.includes(r.path) ? 'on' : ''}`}>
              <input type="checkbox" checked={smoke.includes(r.path)} onChange={() => toggle(smoke, setSmoke, r.path)} />
              {r.path}
            </label>
          ))}
          {!plainRoutes.length && <span className="muted">No pages found in the code.</span>}
        </div>
      </div>

      <div className="card">
        <h2>Endpoints to block</h2>
        <p className="muted small">
          Calls that email, ship, book, charge or reach third parties are blocked in every test type, CRUD included. These were found in the code; untick any that only change data inside the app.
        </p>
        {project.endpointCandidates.length ? (
          <div className="stack">
            {project.endpointCandidates.map((e) => (
              <label key={e.endpoint} className="check">
                <input type="checkbox" checked={blocked.includes(e.endpoint)} onChange={() => toggle(blocked, setBlocked, e.endpoint)} />
                <code>{e.endpoint}</code> <span className="muted small">{e.file}</span>
              </label>
            ))}
          </div>
        ) : (
          <p className="muted">None found. You can add some later in Project settings.</p>
        )}
      </div>

      <div className="card">
        <label className="check">
          <input type="checkbox" checked={gitignore} disabled={project.gitignoreReady} onChange={(e) => setGitignore(e.target.checked)} />
          {project.gitignoreReady ? (
            <span>
              <code>qagent-results.xlsx</code> and <code>.qagent/</code> are already in .gitignore
            </span>
          ) : (
            <span>
              Add <code>qagent-results.xlsx</code> and <code>.qagent/</code> to .gitignore (results and per-machine record IDs)
            </span>
          )}
        </label>
      </div>

      <div className="row">
        <button className="btn primary lg" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save and continue'}
        </button>
        <span className="muted small">Commit .qagent.json so your team shares it. It never holds passwords.</span>
      </div>
    </div>
  );
}
