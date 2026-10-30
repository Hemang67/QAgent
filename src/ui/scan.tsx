import { useEffect, useState } from 'react';
import { ENV_LABEL, TEST_TYPE_LABEL } from '../shared/types';
import type { JobProgress, RunState } from './runState';

/** Re-renders every `ms` while `on`: drives clocks, timers and fading radar pings. */
export const useNow = (on: boolean, ms = 500) => {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [on, ms]);
  return now;
};

export const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

// Stable position for a page on the radar, so a locked target and its result share a spot
const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};
const SIZE = 272;
const C = SIZE / 2;
const spot = (key: string) => {
  const h = hash(key);
  const angle = ((h % 360) * Math.PI) / 180;
  const r = 22 + ((h >>> 9) % 104);
  return { x: C + r * Math.cos(angle), y: C + r * Math.sin(angle) };
};

export function Radar({ run, now }: { run: RunState; now: number }) {
  const done = run.jobs.flatMap((j) => j.pages.map((p) => ({ ...p, key: `${j.env}:${j.type}:${p.step}:${p.route}:${p.part ?? ""}` })));
  const active = run.active.map((a) => ({ ...a, key: `${a.env}:${a.type}:page:${a.route}` }));
  return (
    <div className={`radar ${run.status === 'running' ? '' : 'idle'}`} role="img" aria-label={`${done.length} pages tested, ${active.length} in progress`}>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width={SIZE} height={SIZE}>
        {[34, 66, 98, 128].map((r) => (
          <circle key={r} className="ring" cx={C} cy={C} r={r} />
        ))}
        <line className="axis" x1={C} y1={4} x2={C} y2={SIZE - 4} />
        <line className="axis" x1={4} y1={C} x2={SIZE - 4} y2={C} />
        {Array.from({ length: 36 }, (_, i) => {
          const a = (i * 10 * Math.PI) / 180;
          const r1 = i % 9 === 0 ? 120 : 124;
          return <line key={i} className="tick" x1={C + r1 * Math.cos(a)} y1={C + r1 * Math.sin(a)} x2={C + 128 * Math.cos(a)} y2={C + 128 * Math.sin(a)} />;
        })}
        {done.map((p) => {
          const { x, y } = spot(p.key);
          const fresh = now - p.at < 1400;
          return (
            <g key={p.key}>
              {fresh && <circle className={`ping ${p.result}`} cx={x} cy={y} r={4} />}
              <circle className={`blip ${p.result}`} cx={x} cy={y} r={p.result === 'failed' ? 4.2 : 3.2}>
                <title>
                  {p.route} — {p.result}
                </title>
              </circle>
            </g>
          );
        })}
        {active.map((a) => {
          const { x, y } = spot(a.key);
          return (
            <g key={`${a.key}:${a.since}`}>
              <rect className="lock" x={x - 9} y={y - 9} width={18} height={18} strokeDasharray="5 4" />
              <circle className="blip active" cx={x} cy={y} r={3.5} />
            </g>
          );
        })}
      </svg>
      <div className="sweep" />
    </div>
  );
}

export function RadarLegend() {
  return (
    <div className="radar-legend">
      <span><i style={{ background: 'var(--passed)' }} />Passed</span>
      <span><i style={{ background: 'var(--failed)' }} />Failed</span>
      <span><i style={{ background: 'var(--skipped)' }} />Skipped</span>
      <span><i style={{ background: 'var(--unverified)' }} />Unverified</span>
      <span><i style={{ background: 'var(--accent)' }} />Scanning</span>
    </div>
  );
}

/** The pages being tested right now, each with a laser sweeping a page wireframe. */
export function Targets({ run, now }: { run: RunState; now: number }) {
  if (!run.active.length) {
    return <div className="idle-target">{run.status === 'running' ? 'Acquiring targets…' : 'No pages in progress.'}</div>;
  }
  return (
    <div className="targets">
      {run.active.map((a) => (
        <div className="target" key={`${a.env}:${a.type}:${a.route}:${a.since}`}>
          <div className="wire" aria-hidden>
            <i />
            <i />
            <i />
            <i />
            <i />
          </div>
          <div className="route" title={a.route}>
            {a.route}
          </div>
          <div className="meta">
            <span>
              {ENV_LABEL[a.env]} · {TEST_TYPE_LABEL[a.type]}
            </span>
            <span>{((now - a.since) / 1000).toFixed(1)}s</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export function Lanes({ jobs }: { jobs: JobProgress[] }) {
  return (
    <>
      {jobs.map((j) => {
        const done = j.pages.length;
        const pct = j.status ? 100 : j.total ? Math.min(100, Math.round((done / j.total) * 100)) : 0;
        return (
          <div className="lane" key={`${j.env}:${j.type}`}>
            <span className="name">
              {ENV_LABEL[j.env]} · {TEST_TYPE_LABEL[j.type]}
            </span>
            <div className="progress" aria-label={`${done} of ${j.total} pages`}>
              <div style={{ width: `${pct}%` }} />
            </div>
            <span className="row">
              <span className="count">
                {done}/{Math.max(j.total, done)}
              </span>
              {j.status ? <span className={`verdict ${j.status}`}>{j.status}</span> : <span className="res running">scanning</span>}
            </span>
          </div>
        );
      })}
    </>
  );
}

export function Terminal({ lines, errors }: { lines: string[]; errors: string[] }) {
  return (
    <div className="terminal" aria-live="polite">
      {lines.map((l, i) => (
        <div key={`l${i}`}>{l}</div>
      ))}
      {errors.map((e, i) => (
        <div key={`e${i}`} className="err">
          {e}
        </div>
      ))}
    </div>
  );
}
