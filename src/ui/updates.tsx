import { useEffect, useState } from 'react';
import type { ReleaseNotes, UpdateState } from '../shared/ipc';
import { api } from './api';

/** "What's new" after an update: the changelog sections since the last version seen. */
export function WhatsNew({ notes, onClose }: { notes: ReleaseNotes[]; onClose: () => void }) {
  return (
    <div className="modal-back" role="dialog" aria-label="What's new">
      <div className="card modal">
        <div className="label">QAgent was updated</div>
        <h1 style={{ marginBottom: 14 }}>What's new</h1>
        <div style={{ maxHeight: 380, overflow: 'auto' }}>
          {notes.map((n) => (
            <section key={n.version} style={{ marginBottom: 14 }}>
              <h2>{n.title}</h2>
              {n.intro && <p className="muted">{n.intro}</p>}
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                {n.items.map((it, k) => (
                  <li key={k} style={{ marginBottom: 4 }}>
                    {it.replace(/`/g, '')}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
          <button className="btn primary" onClick={onClose}>
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

/** In-app updates: a bar at the top when a new release is out, with download progress and restart. */
export function UpdateBar() {
  const [s, setS] = useState<UpdateState>({ state: 'idle' });
  const [hidden, setHidden] = useState('');
  useEffect(() => {
    api.updateState().then(setS);
    return api.onUpdate(setS);
  }, []);
  if (!('version' in s) || hidden === s.version + s.state) return null;
  return (
    <div className="update-bar" role="status">
      {s.state === 'available' && (
        <>
          <span>
            <strong>QAgent {s.version}</strong> is available.
          </span>
          <button className="btn primary" onClick={() => api.downloadUpdate()}>
            Download
          </button>
          <button className="btn link" onClick={() => setHidden(s.version + s.state)}>
            Later
          </button>
        </>
      )}
      {s.state === 'downloading' && (
        <>
          <span>Downloading QAgent {s.version}…</span>
          <div className="progress" style={{ width: 180 }}>
            <div style={{ width: `${s.percent}%` }} />
          </div>
          <span className="label">{s.percent}%</span>
        </>
      )}
      {s.state === 'ready' && (
        <>
          <span>
            <strong>QAgent {s.version}</strong> is ready. It installs when QAgent restarts.
          </span>
          <button className="btn primary" onClick={() => api.installUpdate()}>
            Restart now
          </button>
          <button className="btn link" onClick={() => setHidden(s.version + s.state)}>
            On next start
          </button>
        </>
      )}
      {s.state === 'installing' && <span>Installing QAgent {s.version}…</span>}
    </div>
  );
}
