import { useEffect, useLayoutEffect, useState } from 'react';
import type { Screen } from './App';

/**
 * One step of the first-run tour. It points at a real control (data-tour="…") on a
 * real screen. The user always moves with Previous / Next / Skip; nothing advances
 * by itself. A step that needs something done (`act`) does it on Next unless the
 * user already did it on the real control (`done`). `ready` holds Next back while
 * something runs.
 */
export interface TourStep {
  title: string;
  text: string;
  /** What this part of QAgent does, in more detail */
  details?: string[];
  target?: string;
  /** Runs when the step opens */
  enter?: () => void | Promise<void>;
  /** The step's action, done on Next if the user has not done it on the real control */
  act?: () => void;
  done?: () => boolean;
  /** Next stays disabled until this is true, with `waiting` shown */
  ready?: () => boolean;
  waiting?: string;
  /** Label for Next when it performs the action */
  actLabel?: string;
}

const q = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const has = (sel: string) => !!q(sel);
const heading = (re: RegExp) => [...document.querySelectorAll('h1')].some((h) => re.test(h.textContent ?? ''));
const click = (sel: string) => q(sel)?.click();
const skipLoginChecked = () => (q('[data-tour="login"] input[type=radio]:checked')?.parentElement?.textContent ?? '').includes('Skip');
const skipLoginRadio = () => [...document.querySelectorAll<HTMLElement>('[data-tour="login"] label')].find((l) => l.textContent?.includes('Skip login'))?.click();

export const buildSteps = (go: (s: Screen) => void, openDemo: () => Promise<void>): TourStep[] => [
  {
    title: 'Welcome to QAgent',
    text: 'QAgent tests web apps the way a careful tester would: it opens every page in a real browser and records what is broken. This tour tests a small demo shop running on your own computer. Nothing is sent anywhere.',
    details: [
      'Use Next and Previous to move, and Skip tour to leave at any time.',
      'You can take the tour again from Help → Take the tour, or App settings.',
    ],
  },
  {
    title: 'A project is a folder',
    text: 'The demo shop is open as a project. QAgent read its folder and found its pages without changing any of its code.',
    details: [
      'Pages are read from the code for React, Next.js, Vue, Angular, SvelteKit, Laravel, .NET and Python; other sites are crawled.',
      'Settings are saved in .qagent.json in the project. Commit it so your team shares it; it never holds passwords.',
      'Open your own projects from Projects, or drop a folder on the window.',
    ],
    target: '[data-tour="project"]',
    enter: openDemo,
  },
  {
    title: 'Where to test',
    text: 'Local is the demo shop on this computer.',
    details: [
      'Real projects also list Dev, Test and Live, read from .env, appsettings or environment files.',
      'Live needs LIVE typed before a run, and only read-only checks run there.',
      'When the local app is not running, QAgent starts it with its start command and stops it afterwards.',
    ],
    target: '[data-tour="envs"]',
    enter: () => go('run'),
  },
  {
    title: 'Choose what to test',
    text: 'Smoke is a quick check that runs first: if it fails, the other types are skipped there. Full regression opens every page and every tab.',
    details: [
      '11 test types: Smoke, Change-impact, Full regression, Critical flows, CRUD, Accessibility, Performance, Broken links, Responsive, Visual change and Security scan.',
      'Tick Full regression yourself, or press Next to tick it.',
    ],
    target: '[data-tour="types"]',
    act: () => click('[data-tour="type-regression"]'),
    done: () => has('[data-tour="type-regression"].on'),
    actLabel: 'Tick it and continue',
  },
  {
    title: 'Logging in',
    text: 'QAgent asks how to log in on every run: in a browser window, with a username and password, or not at all.',
    details: [
      'Passwords stay in memory for that run only; nothing is ever saved.',
      'The login session is deleted when the run ends.',
      'The demo shop has no login: choose Skip login, or press Next.',
    ],
    target: '[data-tour="login"]',
    act: skipLoginRadio,
    done: skipLoginChecked,
    actLabel: 'Choose Skip login',
  },
  {
    title: 'Run the tests',
    text: 'Runs are read-only: QAgent blocks, inside the browser, any request that could change data.',
    details: [
      'Endpoints that send email, ship, book or charge are blocked in every test type.',
      'Only CRUD writes, never on Live, and only after you type YES.',
      'Press Run, or press Next to start it.',
    ],
    target: '[data-tour="run"]',
    act: () => click('[data-tour="run"]'),
    done: () => heading(/scan in progress|scan complete/i),
    actLabel: 'Start the run',
  },
  {
    title: 'Watching the scan',
    text: 'This is the live view of the real run.',
    details: [
      'Each dot on the radar is a tested page: green passed, red failed, amber skipped, grey unverified.',
      '"Testing now" shows the pages being opened at this moment, with a timer.',
      'Each lane is one environment and test type; Abort stops after the pages in progress.',
    ],
    target: '[data-tour="radar"]',
    ready: () => heading(/scan complete|scan aborted/i),
    waiting: 'The scan is still running…',
  },
  {
    title: 'It found real problems',
    text: 'The demo shop has a page whose script crashes. Full regression failed it, as it would in your own app.',
    details: [
      'Results are added to qagent-results.xlsx in the project folder: a sheet per run, plus Run History and a Guide.',
      'Open the results here, or press Next.',
    ],
    target: '[data-tour="view-results"]',
    act: () => click('[data-tour="view-results"]'),
    done: () => has('.tiles'),
    actLabel: 'Open the results',
  },
  {
    title: 'Every result, explained',
    text: 'Failures come first, with the reason and the evidence from the browser: console errors, failed API calls, loaders that never stopped.',
    details: [
      'passed: rendered, data loaded, no errors. failed: a real problem. skipped: not allowed for this user. unverified: not really checked.',
      'Click a source file to open it in your editor.',
      'Visual change differences are approved here too.',
    ],
    target: '[data-tour="results"]',
    ready: () => has('[data-tour="results"]'),
    waiting: 'Opening the results…',
  },
  {
    title: 'Pages',
    text: 'Every page QAgent found in the code, with its source file and the record IDs it still needs.',
    details: [
      'Pages like /orders/:id need a real record ID, kept in .qagent/test-data.<env>.json on your computer only.',
      '"New since the base branch" finds pages you just added and asks how to test them.',
    ],
    target: '[data-tour="nav-pages"]',
    enter: () => go('pages'),
  },
  {
    title: 'Flows',
    text: 'Record the journeys your users depend on, by clicking through them in a browser. QAgent replays them on every run.',
    details: [
      'Critical flows: step-by-step journeys with checks on the text you expect.',
      'CRUD screens: create, edit and delete a QAgent test record, then clean up.',
    ],
    target: '[data-tour="nav-flows"]',
    enter: () => go('flows'),
  },
  {
    title: 'Your turn',
    text: 'Open your own project from Projects and start with a Smoke run on Local.',
    details: ['Updates arrive inside the app: you will see a bar at the top when a new version is ready.'],
    target: '[data-tour="nav-projects"]',
  },
];

const useRect = (selector: string | undefined) => {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useLayoutEffect(() => {
    if (!selector) return setRect(null);
    const measure = () => {
      const el = q(selector);
      setRect(el ? el.getBoundingClientRect() : null);
    };
    q(selector)?.scrollIntoView({ block: 'nearest' });
    measure();
    const t = setInterval(measure, 250);
    return () => clearInterval(t);
  }, [selector]);
  return rect;
};

/** Re-renders every 400 ms so `ready` and `done` reflect the live screen. */
const useTick = () => {
  const [, set] = useState(0);
  useEffect(() => {
    const t = setInterval(() => set((n) => n + 1), 400);
    return () => clearInterval(t);
  }, []);
};

/** The tour overlay: a spotlight on the real control, and a card with the step. */
export function Tour({ steps, onClose }: { steps: TourStep[]; onClose: (finished: boolean) => void }) {
  const [i, setI] = useState(0);
  useTick();
  const step = steps[i];
  const rect = useRect(step.target);
  const last = i === steps.length - 1;

  useEffect(() => {
    step.enter?.();
  }, [i]);

  const waiting = step.ready && !step.ready();
  const needsAct = step.act && !(step.done?.() ?? false);
  const next = () => {
    if (needsAct) step.act!();
    if (last) onClose(true);
    else setI(i + 1);
  };

  const pad = 6;
  const box = rect && { left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 };
  // The card sits below the target, or above it when there is no room below
  const below = !box || box.top + box.height + 300 < window.innerHeight;
  const cardStyle = box
    ? { left: Math.min(Math.max(16, box.left), window.innerWidth - 436), top: below ? box.top + box.height + 14 : undefined, bottom: below ? undefined : window.innerHeight - box.top + 14 }
    : { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' };

  return (
    <div className="tour" role="dialog" aria-label="QAgent tour">
      {box ? <div className="tour-spot" style={box} /> : <div className="tour-dim" />}
      <div className="tour-card card" style={cardStyle}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="label">
            Tour · step {i + 1} of {steps.length}
          </span>
          <button className="btn link small" onClick={() => onClose(false)}>
            Skip tour
          </button>
        </div>
        <div className="tour-progress" aria-hidden>
          <div style={{ width: `${((i + 1) / steps.length) * 100}%` }} />
        </div>
        <h2>{step.title}</h2>
        <p>{step.text}</p>
        {step.details && (
          <ul className="tour-details">
            {step.details.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        )}
        <div className="row" style={{ justifyContent: 'space-between', marginTop: 14 }}>
          <button className="btn" onClick={() => setI(i - 1)} disabled={i === 0}>
            ← Previous
          </button>
          {waiting ? (
            <span className="res running">{step.waiting}</span>
          ) : (
            <button className="btn primary" onClick={next}>
              {i === 0 ? 'Start the tour →' : last ? 'Finish' : needsAct ? `${step.actLabel} →` : 'Next →'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
