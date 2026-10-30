import { useEffect, useState } from 'react';
import type { BrowserStatus, ProjectView, RunLogin } from '../../shared/ipc';
import { ENV_LABEL, ENV_NAMES, IMPLEMENTED_TYPES, TEST_TYPE_LABEL, TYPE_ENVS, type EnvName, type LoginMode, type TestType } from '../../shared/types';
import { api } from '../api';
import { FileLink, Notice, PageHead, Result } from '../components';
import type { RunState } from '../runState';
import { Lanes, Radar, RadarLegend, Targets, Terminal, clock, useNow } from '../scan';

const TYPES = Object.keys(TEST_TYPE_LABEL) as TestType[];
const LOGIN_LABEL: Record<LoginMode, string> = { browser: 'Log in myself in a browser window', credentials: 'Type username and password', skip: 'Skip login' };

interface Props {
  project: ProjectView;
  run: RunState;
  dispatch: (a: any) => void;
  onResults: (sheet: string | null) => void;
  onSetup: () => void;
}

export default function Run({ project, run, dispatch, onResults, onSetup }: Props) {
  const available = ENV_NAMES.filter((e) => project.urls[e]);
  const [envs, setEnvs] = useState<EnvName[]>(available.slice(0, 1));
  const [types, setTypes] = useState<TestType[]>(['smoke']);
  const [logins, setLogins] = useState<Partial<Record<EnvName, RunLogin>>>({});
  const [live, setLive] = useState('');
  const [crudYes, setCrudYes] = useState('');
  const [liveSecurity, setLiveSecurity] = useState('');
  const [low, setLow] = useState<Partial<Record<EnvName, { username: string; password: string }>>>({});
  const [baseBranch, setBaseBranch] = useState(project.config.baseBranch ?? '');
  const [error, setError] = useState('');
  const [browser, setBrowser] = useState<BrowserStatus | null>(null);

  useEffect(() => {
    api.browserStatus().then(setBrowser);
  }, []);

  const toggleEnv = (e: EnvName) => setEnvs((l) => (l.includes(e) ? l.filter((x) => x !== e) : [...l, e]));
  const toggleType = (t: TestType) => setTypes((l) => (l.includes(t) ? l.filter((x) => x !== t) : [...l, t]));
  const login = (env: EnvName): RunLogin => logins[env] ?? { mode: 'browser' };
  const setLogin = (env: EnvName, patch: Partial<RunLogin>) => setLogins((l) => ({ ...l, [env]: { ...login(env), ...patch } }));

  const noBrowser = browser !== null && !browser.channel && !browser.chromiumInstalled;
  const liveChosen = envs.includes('live');
  const missingCreds = envs.some((e) => login(e).mode === 'credentials' && (!login(e).username || !login(e).password));
  const flowCount = project.config.lists?.criticalFlows?.length ?? 0;
  const crudCount = project.config.lists?.crud?.length ?? 0;
  // Why a test type cannot be chosen right now, if it cannot
  const unavailable = (t: TestType): string | null => {
    if (!IMPLEMENTED_TYPES.includes(t)) return 'Coming in a later version';
    const env = envs.find((e) => !TYPE_ENVS[t].includes(e));
    if (env) return `${TEST_TYPE_LABEL[t]} does not run on ${ENV_LABEL[env]}`;
    if (t === 'flows' && !flowCount) return 'Record critical flows on the Flows screen first';
    if (t === 'crud' && !crudCount) return 'Record CRUD screens on the Flows screen first';
    return null;
  };
  const chosen = types.filter((t) => !unavailable(t));
  const crudChosen = chosen.includes('crud');
  const securityChosen = chosen.includes('security');
  const canStart = envs.length > 0 && chosen.length > 0 && (!liveChosen || live === 'LIVE') && (!liveChosen || !securityChosen || liveSecurity === 'LIVE SECURITY') && (!crudChosen || crudYes === 'YES') && !missingCreds && !noBrowser;

  const start = async () => {
    setError('');
    const req = { root: project.root, envs, types: chosen, logins: Object.fromEntries(envs.map((e) => [e, login(e)])), confirmLive: live, confirmCrud: crudYes, baseBranch: baseBranch.trim(), confirmLiveSecurity: liveSecurity, lowLogins: Object.fromEntries(Object.entries(low).filter(([, v]) => v?.username && v.password).map(([k, v]) => [k, { mode: 'credentials' as const, ...v }])) };
    dispatch({ kind: 'begin', root: project.root });
    const r = await api.startRun(req);
    // Passwords leave the window's memory once the engine has them
    setLogins((l) => Object.fromEntries(Object.entries(l).map(([k, v]) => [k, { ...v, password: '' }])));
    setLive('');
    setCrudYes('');
    setLiveSecurity('');
    setLow({});
    if (!r.ok) {
      setError(r.error ?? 'The run did not start');
      dispatch({ kind: 'reset' });
    }
  };

  const cancel = () => {
    dispatch({ kind: 'cancelling' });
    api.cancelRun();
  };

  const ownRun = run.root === project.root;
  if (run.status !== 'idle' && ownRun) return <Progress project={project} run={run} onCancel={cancel} onNew={() => dispatch({ kind: 'reset' })} onResults={onResults} />;

  return (
    <div className="page">
      <PageHead title="Run tests" subtitle={`${project.name} · ${project.routes.length ? `${project.routes.length} pages` : 'pages found by crawling'}`} />
      {run.status === 'running' && !ownRun && <Notice kind="warn">Another project is running tests. Wait for it to finish.</Notice>}
      {noBrowser && (
        <Notice kind="warn">
          No Chrome or Edge found. Download Chromium (about 150 MB) in App settings before running tests.
        </Notice>
      )}
      {!available.length && (
        <Notice kind="warn">
          No environment has a URL yet.{' '}
          <button className="btn link" onClick={onSetup}>
            Add one in Project settings
          </button>
        </Notice>
      )}
      {error && <Notice kind="error">{error}</Notice>}

      <div className="card" data-tour="envs">
        <h2>Environments</h2>
        <div className="toggle-group">
          {available.map((e) => (
            <label key={e} className={`chip ${envs.includes(e) ? 'on' : ''}`}>
              <input type="checkbox" checked={envs.includes(e)} onChange={() => toggleEnv(e)} />
              <strong>{ENV_LABEL[e]}</strong> <span className="muted small">{project.urls[e]!.url}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="card" data-tour="types">
        <div className="section-title">
          <h2>Test types</h2>
          <span className="muted small">Smoke runs first; if it fails on an environment, the other types are skipped there.</span>
        </div>
        <div className="toggle-group">
          {TYPES.map((t) => {
            const why = unavailable(t);
            const ready = IMPLEMENTED_TYPES.includes(t);
            return (
              <label key={t} data-tour={`type-${t}`} className={`chip ${types.includes(t) && !why ? 'on' : ''} ${why ? 'off' : ''}`} title={why ?? ''}>
                <input type="checkbox" disabled={!!why} checked={types.includes(t)} onChange={() => toggleType(t)} />
                {TEST_TYPE_LABEL[t]}
                {!ready && <span className="tag">soon</span>}
              </label>
            );
          })}
        </div>
      </div>

      {chosen.includes('impact') && (
        <div className="card">
          <h2>Change-impact</h2>
          <label className="field" style={{ maxWidth: 420 }}>
            Compare with branch
            <input type="text" value={baseBranch} placeholder="origin/development, then origin/main" onChange={(e) => setBaseBranch(e.target.value)} />
          </label>
          <p className="muted small" style={{ marginTop: 8 }}>Tests only the pages your committed, uncommitted and new files can affect.</p>
        </div>
      )}

      {envs.length > 0 && (
        <div className="card" data-tour="login">
          <h2>Login</h2>
          <p className="muted small">Asked on every run. Passwords stay in memory and are never saved.</p>
          {envs.map((env) => (
            <div className="env-login" key={env}>
              <strong>{ENV_LABEL[env]}</strong>
              <div className="stack">
                <div className="row">
                  {(Object.keys(LOGIN_LABEL) as LoginMode[]).map((m) => (
                    <label key={m} className="check">
                      <input type="radio" name={`login-${env}`} checked={login(env).mode === m} onChange={() => setLogin(env, { mode: m })} />
                      {LOGIN_LABEL[m]}
                    </label>
                  ))}
                </div>
                {login(env).mode === 'credentials' && (
                  <div className="row">
                    <input type="text" placeholder="Username or email" autoComplete="off" value={login(env).username ?? ''} onChange={(e) => setLogin(env, { username: e.target.value })} />
                    <input type="password" placeholder="Password" autoComplete="off" value={login(env).password ?? ''} onChange={(e) => setLogin(env, { password: e.target.value })} />
                  </div>
                )}
                {login(env).mode === 'skip' && <span className="muted small">Pages behind the login are reported unverified.</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {securityChosen && (
        <div className="card">
          <h2>Security scan</h2>
          <p className="muted small">Only scan sites you own or have permission to test. On Local and Dev the scan also saves test entries through simple forms and tries wrong passwords on a made-up account. On Test and Live it only reads, spaced out, and stops if a firewall reacts.</p>
          {envs.map((env) => (
            <div className="env-login" key={env}>
              <strong>{ENV_LABEL[env]}</strong>
              <div className="row">
                <span className="muted small">Second, low-permission login for role checks (optional):</span>
                <input type="text" placeholder="Low-permission username" autoComplete="off" value={low[env]?.username ?? ''} onChange={(e) => setLow((l) => ({ ...l, [env]: { username: e.target.value, password: l[env]?.password ?? '' } }))} />
                <input type="password" placeholder="Low-permission password" autoComplete="off" value={low[env]?.password ?? ''} onChange={(e) => setLow((l) => ({ ...l, [env]: { username: l[env]?.username ?? '', password: e.target.value } }))} />
              </div>
            </div>
          ))}
        </div>
      )}

      {securityChosen && liveChosen && (
        <Notice kind="warn">
          <div className="row">
            <span>
              This runs read-only security checks against the <strong>Live</strong> site. Type <strong>LIVE SECURITY</strong> to confirm:
            </span>
            <input type="text" value={liveSecurity} onChange={(e) => setLiveSecurity(e.target.value)} style={{ width: 150 }} aria-label="Type LIVE SECURITY to confirm" />
          </div>
        </Notice>
      )}

      {crudChosen && (
        <Notice kind="warn">
          <div className="row">
            <span>
              CRUD <strong>creates, edits and deletes</strong> QAgent-… test records on {crudCount} screen(s). Type <strong>YES</strong> to confirm:
            </span>
            <input type="text" value={crudYes} onChange={(e) => setCrudYes(e.target.value)} style={{ width: 100 }} aria-label="Type YES to confirm CRUD" />
          </div>
        </Notice>
      )}

      {liveChosen && (
        <Notice kind="warn">
          <div className="row">
            <span>
              You are about to test the <strong>Live</strong> site. Only read-only checks run. Type <strong>LIVE</strong> to confirm:
            </span>
            <input type="text" value={live} onChange={(e) => setLive(e.target.value)} style={{ width: 100 }} aria-label="Type LIVE to confirm" />
          </div>
        </Notice>
      )}

      <div className="row">
        <button data-tour="run" className="btn primary lg launch" disabled={!canStart || run.status === 'running'} onClick={start}>
          ▶ Run {chosen.length > 1 ? `${chosen.length} test types` : TEST_TYPE_LABEL[chosen[0]] ?? ''}
        </button>
        <span className="muted small">Results are added to {project.resultsFile.split(/[\\/]/).pop()} in the project folder.</span>
      </div>
    </div>
  );
}

function Progress({ project, run, onCancel, onNew, onResults }: { project: ProjectView; run: RunState; onCancel: () => void; onNew: () => void; onResults: (sheet: string | null) => void }) {
  const running = run.status === 'running';
  const now = useNow(running, 250);
  const openFile = (file: string) => api.openFile(project.root, file);
  const all = run.jobs.flatMap((j) => j.pages.map((p) => ({ ...p, env: j.env, type: j.type })));
  const count = (r: string) => all.filter((p) => p.result === r).length;
  const total = run.jobs.reduce((s, j) => s + Math.max(j.total, j.pages.length), 0);
  const elapsed = (run.endedAt ?? now) - (run.startedAt ?? now);
  const verdict = run.cancelled ? 'unverified' : run.jobs.some((j) => j.status === 'failed') || run.errors.length ? 'failed' : run.jobs.every((j) => j.status === 'skipped') ? 'skipped' : 'passed';
  // Newest first while scanning; failures first once finished
  const feed = running ? [...all].reverse() : [...all].sort((a, b) => Number(b.result === 'failed') - Number(a.result === 'failed'));

  return (
    <div className="page">
      <div className="scan-head">
        <div className={`scan-title ${running ? '' : 'done'}`}>
          <h1>{running ? (run.cancelling ? 'Aborting scan' : 'Scan in progress') : run.cancelled ? 'Scan aborted' : 'Scan complete'}</h1>
          {!running && <span className={`verdict ${verdict}`}>{verdict === 'passed' ? 'All clear' : verdict === 'failed' ? 'Defects found' : verdict}</span>}
        </div>
        <div className="row">
          <span className="clock" aria-label="Elapsed time">
            T+{clock(elapsed)}
          </span>
          {running ? (
            <button className="btn danger" onClick={onCancel} disabled={run.cancelling}>
              {run.cancelling ? 'Aborting…' : '■ Abort'}
            </button>
          ) : (
            <>
              {run.workbook && (
                <button className="btn" onClick={() => api.openResults(project.root)}>
                  Open in Excel
                </button>
              )}
              {run.workbook && (
                <button className="btn" data-tour="view-results" onClick={() => onResults(run.workbook!.sheets[0] ?? null)}>
                  View results
                </button>
              )}
              <button className="btn primary" onClick={onNew}>
                New run
              </button>
            </>
          )}
        </div>
      </div>

      {run.fallback && (
        <Notice kind="warn">
          The workbook could not be written ({run.fallback.error}). Results were kept in <code>{run.fallback.dir}</code>.
        </Notice>
      )}
      {!running && run.workbook && (
        <Notice kind={run.ok ? 'ok' : 'warn'}>
          {run.ok ? 'No failures.' : 'Some pages failed or could not be checked.'} Results were added to <code>{run.workbook.file}</code>
          {run.workbook.sheets.length ? ` (${run.workbook.sheets.join(', ')}).` : '.'}
        </Notice>
      )}

      <div className="scan-grid">
        <div className="card radar-card" data-tour="radar">
          <span className="label">Target map · {project.name}</span>
          <Radar run={run} now={now} />
          <RadarLegend />
        </div>
        <div>
          <div className="telemetry">
            <div className="tile rate"><div className="label">Scanned</div><div className="value">{all.length}<span className="small muted">/{Math.max(total, all.length)}</span></div></div>
            <div className="tile passed"><div className="label">Passed</div><div className="value">{count('passed')}</div></div>
            <div className="tile failed"><div className="label">Failed</div><div className="value">{count('failed')}</div></div>
            <div className="tile unverified"><div className="label">Skipped · unverified</div><div className="value">{count('skipped') + count('unverified')}</div></div>
          </div>
          <div className="card">
            <div className="section-title">
              <h2>Testing now</h2>
              <span className="label">{run.active.length} active</span>
            </div>
            <Targets run={run} now={now} />
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Test lanes</h2>
        <Lanes jobs={run.jobs} />
        {!run.jobs.length && <div className="idle-target">{running ? 'Preparing the run…' : 'Nothing ran.'}</div>}
      </div>

      <div className="card">
        <h2>Telemetry</h2>
        <Terminal lines={run.log} errors={run.errors} />
        {run.localLog && (
          <details style={{ marginTop: 10 }}>
            <summary className="label" style={{ cursor: 'pointer' }}>
              Local app output
            </summary>
            <pre className="log" style={{ marginTop: 8 }}>{run.localLog}</pre>
          </details>
        )}
      </div>

      {feed.length > 0 && (
        <div className="card flush">
          <div style={{ maxHeight: 420, overflow: 'auto' }}>
            <table className="data">
              <thead>
                <tr>
                  <th>Page</th>
                  <th>Lane</th>
                  <th>Result</th>
                  <th>Reason</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {feed.map((p) => (
                  <tr key={`${p.env}:${p.type}:${p.step}:${p.route}:${p.part ?? ""}:${p.at}`}>
                    <td>
                      {p.step === 'page' ? <span className="mono">{p.route}</span> : p.step === 'flow' || p.step === 'crud' || p.step === 'check' ? <><strong>{p.route}</strong> <span className="muted small">{p.part}</span></> : <strong>{p.step === 'site' ? 'Site answers' : 'Login'}</strong>}
                    </td>
                    <td className="label">
                      {ENV_LABEL[p.env]} · {TEST_TYPE_LABEL[p.type]}
                    </td>
                    <td>
                      <Result value={p.result} />
                    </td>
                    <td className="muted">{p.reason}</td>
                    <td>
                      <FileLink file={p.file} onOpen={openFile} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
