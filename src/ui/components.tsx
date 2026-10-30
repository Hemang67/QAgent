import { useState, type ReactNode } from 'react';
import type { PageResult } from '../shared/types';
import logo from './assets/logo.png';
import mark from './assets/mark.png';

export const Result = ({ value }: { value: PageResult | 'running' | string }) => <span className={`res ${value}`}>{value}</span>;

export const Notice = ({ kind, children }: { kind: 'error' | 'warn' | 'info' | 'ok'; children: ReactNode }) => (
  <div className={`notice ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
    {children}
  </div>
);

export const Tiles = ({ passed, failed, skipped, unverified }: Record<PageResult, number>) => {
  const d = passed + failed + unverified;
  return (
    <div className="tiles">
      <div className="tile passed"><div className="label">Passed</div><div className="value">{passed}</div></div>
      <div className="tile failed"><div className="label">Failed</div><div className="value">{failed}</div></div>
      <div className="tile skipped"><div className="label">Skipped</div><div className="value">{skipped}</div></div>
      <div className="tile unverified"><div className="label">Unverified</div><div className="value">{unverified}</div></div>
      <div className="tile rate"><div className="label">Pass rate</div><div className="value">{d ? `${Math.round((passed / d) * 100)}%` : '—'}</div></div>
    </div>
  );
};

export const FileLink = ({ file, onOpen }: { file?: string; onOpen: (file: string) => void }) =>
  file ? (
    <button className="btn link mono" title="Open in your editor" onClick={(e) => (e.stopPropagation(), onOpen(file))}>
      {file}
    </button>
  ) : null;

export const PageHead = ({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children?: ReactNode }) => (
  <div className="page-head">
    <div>
      <h1>{title}</h1>
      {subtitle && <div className="sub">{subtitle}</div>}
    </div>
    {children && <div className="row">{children}</div>}
  </div>
);

export const BrandMark = () => <img className="brand-mark" src={mark} alt="" aria-hidden />;

export const Logo = ({ size }: { size: number }) => <img className="logo" src={logo} alt="QAgent" width={size} height={size} />;

const BOOT_LINES = ['Initialising QAgent core', 'Loading framework adapters', 'Arming safety guard: read-only', 'Linking browser engine'];

/** A short start-up sequence; purely visual, never blocks clicks, skipped with reduced motion. */
export function Boot() {
  const [gone, setGone] = useState(false);
  if (gone) return null;
  return (
    <div className="boot" onAnimationEnd={(e) => e.animationName === 'boot-out' && setGone(true)} aria-hidden>
      <div className="boot-inner">
        <Logo size={220} />
        {BOOT_LINES.map((l, i) => (
          <div className="boot-line" key={l} style={{ animationDelay: `${0.15 + i * 0.28}s` }}>
            {l} <span>OK</span>
          </div>
        ))}
        <div className="progress">
          <div />
        </div>
      </div>
    </div>
  );
}
