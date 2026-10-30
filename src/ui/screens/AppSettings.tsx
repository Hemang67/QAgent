import { useEffect, useState } from 'react';
import type { AppSettings as Settings, BrowserStatus, EditorChoice } from '../../shared/ipc';
import { api } from '../api';
import { Logo, Notice, PageHead } from '../components';

const EDITORS: [EditorChoice, string][] = [
  ['code', 'Visual Studio Code'],
  ['cursor', 'Cursor'],
  ['windsurf', 'Windsurf'],
  ['idea', 'JetBrains IDE (idea)'],
  ['system', 'System default app'],
];

export default function AppSettings({ onTour }: { onTour: () => void }) {
  const [s, setS] = useState<Settings | null>(null);
  const [browser, setBrowser] = useState<BrowserStatus | null>(null);
  const [info, setInfo] = useState<{ version: string; platform: string } | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installLog, setInstallLog] = useState<string[]>([]);
  const [installError, setInstallError] = useState('');

  useEffect(() => {
    api.getSettings().then(setS);
    api.browserStatus().then(setBrowser);
    api.appInfo().then(setInfo);
    return api.onInstallLog((line) => setInstallLog((l) => [...l.slice(-30), line]));
  }, []);

  const update = (patch: Partial<Settings>) => {
    const next = { ...s!, ...patch };
    setS(next);
    api.saveSettings(next);
  };

  const install = async () => {
    setInstalling(true);
    setInstallError('');
    setInstallLog([]);
    const r = await api.installChromium();
    setInstalling(false);
    if (!r.ok) setInstallError(r.error ?? 'Download failed');
    setBrowser(await api.browserStatus());
  };

  if (!s) return null;
  return (
    <div className="page">
      <PageHead title="App settings" subtitle={info ? `QAgent ${info.version} · ${info.platform === 'win32' ? 'Windows' : 'Linux'}` : ''} />

      <div className="card">
        <h2>Browser</h2>
        {browser?.channel ? (
          <p>
            Tests run in your installed <strong>{browser.channel === 'msedge' ? 'Microsoft Edge' : 'Google Chrome'}</strong>. Nothing to download.
          </p>
        ) : browser?.chromiumInstalled ? (
          <p>Tests run in Chromium downloaded by QAgent.</p>
        ) : (
          <>
            <p>No Chrome or Edge was found. QAgent needs Chromium (about 150 MB download, shared by all projects).</p>
            <button className="btn primary" onClick={install} disabled={installing}>
              {installing ? 'Downloading…' : 'Download Chromium'}
            </button>
          </>
        )}
        {installError && <Notice kind="error">{installError}. Behind a proxy? Set it below and try again.</Notice>}
        {installLog.length > 0 && <pre className="log" style={{ marginTop: 10 }}>{installLog.join('\n')}</pre>}
        <label className="field" style={{ marginTop: 12, maxWidth: 420 }}>
          Proxy for downloads (optional)
          <input type="text" placeholder="http://proxy.company.com:8080" value={s.proxy} onChange={(e) => update({ proxy: e.target.value.trim() })} />
        </label>
      </div>

      <div className="card">
        <h2>Opening source files</h2>
        <label className="field" style={{ maxWidth: 420 }}>
          Editor used when you click a source file
          <select value={s.editor} onChange={(e) => update({ editor: e.target.value as EditorChoice })}>
            {EDITORS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <p className="muted small" style={{ marginTop: 8 }}>
          If the editor's command is not installed, the file opens in the system's default app.
        </p>
      </div>

      <div className="card">
        <h2>Appearance</h2>
        <div className="row">
          {(['system', 'light', 'dark'] as const).map((t) => (
            <label key={t} className="check">
              <input type="radio" checked={s.theme === t} onChange={() => update({ theme: t })} />
              {t === 'system' ? 'Follow the system' : t === 'light' ? 'Light' : 'Dark'}
            </label>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>Updates</h2>
        <div className="row" style={{ marginBottom: 10 }}>
          <button className="btn" onClick={() => api.checkForUpdate()}>
            Check for updates now
          </button>
          <span className="muted small">New versions download inside QAgent and install when it restarts.</span>
        </div>
        <div className="stack">
          <label className="check">
            <input type="checkbox" checked={s.checkUpdates} onChange={(e) => update({ checkUpdates: e.target.checked })} />
            Check for updates when QAgent starts
          </label>
          <label className="check">
            <input type="checkbox" checked={s.betaUpdates} disabled={!s.checkUpdates} onChange={(e) => update({ betaUpdates: e.target.checked })} />
            Include beta versions
          </label>
        </div>
      </div>

      <div className="card row" style={{ alignItems: 'center', gap: 20 }}>
        <Logo size={96} />
        <div>
          <h2 style={{ marginBottom: 4 }}>QAgent {info?.version}</h2>
          <p className="muted small" style={{ margin: 0 }}>Tests any web app and records the results in Excel. MIT licence · Techovarya</p>
          <button className="btn link" onClick={() => api.openExternal('https://github.com/Hemang67/QAgent')}>github.com/Hemang67/QAgent</button>
        </div>
      </div>

      <div className="card">
        <h2>Getting started</h2>
        <p className="muted small">A guided tour of the real screens, testing a demo shop on this computer.</p>
        <button className="btn" onClick={() => onTour()}>
          Take the tour
        </button>
      </div>

      <p className="muted small">QAgent stores only this list of settings and your recent projects. Passwords and login sessions are never saved.</p>
    </div>
  );
}
