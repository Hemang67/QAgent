import { useCallback, useEffect, useState } from 'react';
import type { ProjectView } from '../shared/ipc';
import { api } from './api';
import { Boot, BrandMark, Notice } from './components';
import { buildSteps, Tour } from './tour';
import { UpdateBar, WhatsNew } from './updates';
import type { ReleaseNotes } from '../shared/ipc';
import { useRunState } from './runState';
import AppSettings from './screens/AppSettings';
import Flows from './screens/Flows';
import Pages from './screens/Pages';
import Projects from './screens/Projects';
import Results from './screens/Results';
import Run from './screens/Run';
import Settings from './screens/Settings';
import Setup from './screens/Setup';

export type Screen = 'projects' | 'setup' | 'run' | 'results' | 'pages' | 'flows' | 'settings' | 'app-settings';

const NAV: { id: Screen; label: string; icon: string }[] = [
  { id: 'run', label: 'Run tests', icon: '◉' },
  { id: 'results', label: 'Results', icon: '▤' },
  { id: 'pages', label: 'Pages', icon: '⌗' },
  { id: 'flows', label: 'Flows', icon: '⇢' },
  { id: 'settings', label: 'Project settings', icon: '⚒' },
];

export default function App() {
  const [screen, setScreen] = useState<Screen>('projects');
  const [project, setProject] = useState<ProjectView | null>(null);
  const [error, setError] = useState('');
  const [run, dispatch] = useRunState();
  // Results screen opens on a specific sheet after a run
  const [resultsSheet, setResultsSheet] = useState<string | null>(null);
  const [version, setVersion] = useState('');
  const [tour, setTour] = useState(false);
  const [notes, setNotes] = useState<ReleaseNotes[]>([]);
  useEffect(() => {
    api.appInfo().then((i) => setVersion(i.version));
    // First launch: the tour. After an update: what's new. Either way, this version is now seen.
    (async () => {
      const s = await api.getSettings();
      const fresh = await api.whatsNew();
      if (fresh.length) setNotes(fresh);
      else api.markSeen();
      if (!s.tourDone) setTour(true);
    })();
  }, []);

  const endTour = async () => {
    setTour(false);
    api.saveSettings({ ...(await api.getSettings()), tourDone: true });
  };
  const closeNotes = () => {
    setNotes([]);
    api.markSeen();
  };

  const open = useCallback(async (root: string) => {
    setError('');
    try {
      const view = await api.openProject(root);
      setProject(view);
      setScreen(view.hasConfig ? 'run' : 'setup');
    } catch (e) {
      setError(`Could not open ${root}: ${(e as Error).message}`);
    }
  }, []);

  const reload = useCallback(async () => {
    if (project) setProject(await api.openProject(project.root));
  }, [project]);

  const pick = useCallback(async () => {
    const root = await api.pickProject();
    if (root) await open(root);
  }, [open]);

  useEffect(
    () =>
      api.onMenu((cmd) => {
        if (cmd.startsWith('open:')) open(cmd.slice(5));
        else if (cmd === 'tour') setTour(true);
        else if (cmd === 'whats-new') api.whatsNew(true).then(setNotes);
        else if (cmd === 'open-project') pick();
        else if (cmd === 'projects' || cmd === 'app-settings') setScreen(cmd);
        else if (project) setScreen(cmd as Screen);
      }),
    [open, pick, project],
  );

  const showResults = (sheet: string | null) => {
    setResultsSheet(sheet);
    setScreen('results');
  };

  const running = run.status === 'running';
  return (
    <div className="app">
      <Boot />
      {tour && <Tour steps={buildSteps(setScreen, async () => open(await api.startDemo()))} onClose={endTour} />}
      {notes.length > 0 && !tour && <WhatsNew notes={notes} onClose={closeNotes} />}
      <aside className="sidebar">
        <div className="brand">
          <BrandMark />
          <span className="brand-name">QAGENT</span>
        </div>
        <div className={`sys-status ${running ? 'busy' : ''}`}>{running ? 'SCAN ACTIVE' : 'SYSTEMS ONLINE'}</div>
        {project && (
          <div className="project-chip" title={project.root} data-tour="project">
            <div className="name">{project.name}</div>
            <div className="fw">
              {project.framework} · {project.routes.length || 'crawl'} pages
            </div>
          </div>
        )}
        {NAV.map((n) => (
          <button key={n.id} data-tour={`nav-${n.id}`} className={`nav-item ${screen === n.id ? 'active' : ''}`} disabled={!project} onClick={() => setScreen(n.id)}>
            <span className="ico" aria-hidden>
              {n.icon}
            </span>
            {n.label}
            {n.id === 'run' && running && <span className="dot" title="Run in progress" />}
          </button>
        ))}
        <div className="spacer" />
        <button data-tour="nav-projects" className={`nav-item ${screen === 'projects' ? 'active' : ''}`} onClick={() => setScreen('projects')}>
          <span className="ico" aria-hidden>
            ⌂
          </span>
          Projects
        </button>
        <button className={`nav-item ${screen === 'app-settings' ? 'active' : ''}`} onClick={() => setScreen('app-settings')}>
          <span className="ico" aria-hidden>
            ⚙
          </span>
          App settings
        </button>
        {version && <div className="version">v{version} · read-only guard armed</div>}
      </aside>
      <main className="main">
        <UpdateBar />
        {error && (
          <div className="page" style={{ paddingBottom: 0 }}>
            <Notice kind="error">{error}</Notice>
          </div>
        )}
        {screen === 'projects' && <Projects onOpen={open} onPick={pick} current={project?.root ?? null} />}
        {screen === 'app-settings' && <AppSettings onTour={() => setTour(true)} />}
        {project && screen === 'setup' && <Setup project={project} onSaved={async () => (await reload(), setScreen('run'))} />}
        {project && screen === 'run' && <Run project={project} run={run} dispatch={dispatch} onResults={showResults} onSetup={() => setScreen('settings')} />}
        {project && screen === 'results' && <Results project={project} sheet={resultsSheet} onSheet={setResultsSheet} />}
        {project && screen === 'pages' && <Pages project={project} onSaved={reload} />}
        {project && screen === 'flows' && <Flows project={project} onSaved={reload} />}
        {project && screen === 'settings' && <Settings project={project} onSaved={reload} onSetup={() => setScreen('setup')} />}
      </main>
    </div>
  );
}
