import { useState } from 'react';
import type { QAgentConfig } from '../../shared/config';
import type { ProjectView, RecordResult } from '../../shared/ipc';
import { ENV_LABEL, ENV_NAMES, type CrudDef, type EnvName, type FlowDef, type FlowStep } from '../../shared/types';
import { api } from '../api';
import { Notice, PageHead } from '../components';

const describe = (s: FlowStep) => {
  if ('goto' in s) return ['go to', s.goto];
  if ('click' in s) return ['click', s.click];
  if ('fill' in s) return ['fill', `${s.fill} = "${s.value}"`];
  if ('select' in s) return ['select', `${s.select} = "${s.value}"`];
  if ('check' in s) return ['tick', s.check];
  if ('press' in s) return ['press', `${s.key} in ${s.press}`];
  if ('expectText' in s) return ['expect', `text "${s.expectText}"`];
  return ['expect', `URL ${s.expectUrl}`];
};

const Steps = ({ steps }: { steps: FlowStep[] }) => (
  <ol className="mono small" style={{ margin: '6px 0 0', paddingLeft: 22, color: 'var(--muted)' }}>
    {steps.map((s, i) => {
      const [verb, what] = describe(s);
      return (
        <li key={i}>
          <span style={{ color: 'var(--accent)' }}>{verb}</span> {what}
        </li>
      );
    })}
  </ol>
);

/** Critical flows and CRUD screens: recorded in a browser, saved in .qagent.json. */
export default function Flows({ project, onSaved }: { project: ProjectView; onSaved: () => void }) {
  const flows = project.config.lists?.criticalFlows ?? [];
  const cruds = project.config.lists?.crud ?? [];
  const envs = ENV_NAMES.filter((e) => project.urls[e]);
  const [kind, setKind] = useState<'flow' | 'crud'>('flow');
  const [name, setName] = useState('');
  const [env, setEnv] = useState<EnvName>(envs.find((e) => e !== 'live') ?? envs[0]);
  const [start, setStart] = useState(project.config.login?.loggedInPath ?? '/');
  const [recording, setRecording] = useState(false);
  const [draft, setDraft] = useState<RecordResult | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  const save = async (lists: Partial<NonNullable<QAgentConfig['lists']>>) => {
    const config = { ...project.config, lists: { ...project.config.lists, ...lists } };
    const r = await api.saveConfig(project.root, config);
    if (!r.ok) setError(r.errors.join('; '));
    else onSaved();
    return r.ok;
  };

  const startRecording = async () => {
    setError('');
    setDraft(null);
    setRecording(true);
    const r = await api.recordFlow(project.root, env, kind, start);
    setRecording(false);
    if (r.ok) setDraft(r);
    else setError(r.error ?? 'Recording failed');
  };

  const keep = async () => {
    if (!draft) return;
    const label = name.trim() || (kind === 'flow' ? `Flow ${flows.length + 1}` : `Screen ${cruds.length + 1}`);
    const ok =
      kind === 'flow'
        ? await save({ criticalFlows: [...flows, { name: label, steps: draft.steps! }] })
        : await save({ crud: [...cruds, { name: label, route: draft.startPath ?? start, create: draft.phases!.create, ...(draft.phases!.edit.length ? { edit: draft.phases!.edit } : {}), delete: draft.phases!.delete }] });
    if (ok) {
      setDraft(null);
      setName('');
    }
  };

  return (
    <div className="page">
      <PageHead title="Flows" subtitle="Critical journeys and CRUD screens, recorded in a browser and saved to .qagent.json" />
      {error && <Notice kind="error">{error}</Notice>}

      <div className="card">
        <h2>Record</h2>
        <div className="row" style={{ marginBottom: 12 }}>
          <label className={`chip ${kind === 'flow' ? 'on' : ''}`}>
            <input type="radio" checked={kind === 'flow'} onChange={() => setKind('flow')} />
            Critical flow
          </label>
          <label className={`chip ${kind === 'crud' ? 'on' : ''}`}>
            <input type="radio" checked={kind === 'crud'} onChange={() => setKind('crud')} />
            CRUD screen
          </label>
        </div>
        <div className="grid-2" style={{ gridTemplateColumns: '1.2fr 0.8fr 1fr' }}>
          <label className="field">
            Name
            <input type="text" value={name} placeholder={kind === 'flow' ? 'Create an order and pay' : 'Colours'} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            Environment
            <select value={env} onChange={(e) => setEnv(e.target.value as EnvName)}>
              {envs.map((e) => (
                <option key={e} value={e}>
                  {ENV_LABEL[e]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Start page
            <input type="text" value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
        </div>
        <div className="small muted" style={{ margin: '12px 0' }}>
          {kind === 'flow' ? (
            <>A browser opens with a QAgent bar at the top. Log in if needed, go to where the journey starts, press <b>Record</b>, and do the journey. <b>Add check</b> then a click on some text makes the flow expect that text. Press <b>Finish</b> when done.</>
          ) : (
            <>Go to the list page and press <b>Record</b>. <b>Create</b> a record, typing <code>QAGENT</code> where its name goes; press <b>Create done</b>. <b>Edit</b> it, changing the name to <code>QAGENT-EDITED</code> (or press <b>No edit</b>). <b>Delete</b> it, then <b>Finish</b>. Each run uses a unique QAgent-… name instead.</>
          )}
        </div>
        {env === 'live' && <Notice kind="warn">You are recording on Live. Everything you do in the window really happens there.</Notice>}
        {env !== 'live' && kind === 'crud' && <Notice kind="info">Recording performs the real create, edit and delete on {ENV_LABEL[env]}.</Notice>}
        <button className="btn primary launch" onClick={startRecording} disabled={recording || !envs.length}>
          {recording ? '● Recording in the browser window…' : '● Record'}
        </button>

        {draft && (
          <div style={{ marginTop: 16 }}>
            <h3>Recorded {kind === 'flow' ? `${draft.steps!.length} steps` : 'CRUD screen'}</h3>
            {kind === 'flow' ? (
              <Steps steps={draft.steps!} />
            ) : (
              (['create', 'edit', 'delete'] as const).map((ph) => (
                <div key={ph} style={{ marginTop: 6 }}>
                  <span className="label">{ph}</span>
                  {draft.phases![ph].length ? <Steps steps={draft.phases![ph]} /> : <span className="muted small"> none</span>}
                </div>
              ))
            )}
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn primary" onClick={keep}>
                Save
              </button>
              <button className="btn" onClick={() => setDraft(null)}>
                Discard
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="card flush">
        <div style={{ padding: '16px 20px 6px' }}>
          <h2>Critical flows · {flows.length}</h2>
        </div>
        {!flows.length && <div className="empty">No flows yet. Record the journeys your users depend on most.</div>}
        {flows.map((f: FlowDef, i) => (
          <div className="list-item" key={f.name + i} style={{ alignItems: 'flex-start' }}>
            <div className="grow">
              <button className="btn link" style={{ padding: 0, fontWeight: 600 }} onClick={() => setOpen(open === `f${i}` ? null : `f${i}`)}>
                {open === `f${i}` ? '▾' : '▸'} {f.name}
              </button>
              <span className="muted small"> · {f.steps.length} steps</span>
              {open === `f${i}` && <Steps steps={f.steps} />}
            </div>
            <label className="check small" title="Let this flow save data (never on Live; blocked endpoints stay blocked)">
              <input type="checkbox" checked={!!f.allowWrites} onChange={(e) => save({ criticalFlows: flows.map((x, j) => (j === i ? { ...x, allowWrites: e.target.checked || undefined } : x)) })} />
              Allow writes
            </label>
            <button className="btn link" onClick={() => save({ criticalFlows: flows.filter((_, j) => j !== i) })}>
              Delete
            </button>
          </div>
        ))}
      </div>

      <div className="card flush">
        <div style={{ padding: '16px 20px 6px' }}>
          <h2>CRUD screens · {cruds.length}</h2>
        </div>
        {!cruds.length && <div className="empty">No CRUD screens yet. Pick simple lookup screens where a test record harms nothing.</div>}
        {cruds.map((c: CrudDef, i) => (
          <div className="list-item" key={c.name + i} style={{ alignItems: 'flex-start' }}>
            <div className="grow">
              <button className="btn link" style={{ padding: 0, fontWeight: 600 }} onClick={() => setOpen(open === `c${i}` ? null : `c${i}`)}>
                {open === `c${i}` ? '▾' : '▸'} {c.name}
              </button>
              <span className="muted small mono"> · {c.route}</span>
              {open === `c${i}` &&
                (['create', 'edit', 'delete'] as const).map((ph) =>
                  c[ph]?.length ? (
                    <div key={ph} style={{ marginTop: 6 }}>
                      <span className="label">{ph}</span>
                      <Steps steps={c[ph]!} />
                    </div>
                  ) : null,
                )}
            </div>
            <button className="btn link" onClick={() => save({ crud: cruds.filter((_, j) => j !== i) })}>
              Delete
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
