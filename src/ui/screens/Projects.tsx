import { useEffect, useState } from 'react';
import type { RecentProject } from '../../shared/ipc';
import { api } from '../api';
import { PageHead } from '../components';

const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(t).toLocaleDateString();
};

export default function Projects({ onOpen, onPick, current }: { onOpen: (root: string) => void; onPick: () => void; current: string | null }) {
  const [projects, setProjects] = useState<RecentProject[] | null>(null);
  const [over, setOver] = useState(false);

  const load = () => api.listProjects().then(setProjects);
  useEffect(() => {
    load();
  }, [current]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setOver(false);
    const file = e.dataTransfer.files[0];
    if (file) onOpen(api.pathForFile(file));
  };

  return (
    <div className="page" onDragOver={(e) => (e.preventDefault(), setOver(true))} onDragLeave={() => setOver(false)} onDrop={onDrop}>
      <PageHead title="Projects" subtitle="Open a web project to find its pages and test them.">
        <button className="btn primary" onClick={onPick}>
          Open project…
        </button>
      </PageHead>

      <div className={`drop ${over ? 'over' : ''}`} style={{ marginBottom: 20 }}>
        Drop a project folder here, or use <strong>Open project…</strong> (Ctrl+O)
      </div>

      {projects && projects.length > 0 && (
        <div className="card flush">
          {projects.map((p) => (
            <div className="list-item" key={p.root}>
              <div className="grow">
                <div style={{ fontWeight: 600 }}>
                  {p.name} {p.root === current && <span className="tag">open</span>}
                </div>
                <div className="muted small ellipsis" title={p.root}>
                  {p.framework} · {p.root}
                </div>
              </div>
              <span className="muted small">{ago(p.lastOpened)}</span>
              <button className="btn" onClick={() => onOpen(p.root)}>
                Open
              </button>
              <button className="btn link" title="Remove from this list (the project is not touched)" onClick={() => api.removeProject(p.root).then(load)}>
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
      {projects && projects.length === 0 && <div className="empty">No projects yet. Open a React, Next.js or any other web project to start.</div>}
    </div>
  );
}
