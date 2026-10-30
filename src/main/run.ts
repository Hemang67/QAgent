import { spawn, type ChildProcess } from 'child_process';
import readline from 'readline';
import { ensureLocalApp } from '../planner/local-server';
import { buildPlan, inspectProject } from '../planner/plan';
import type { RunEvent, RunRequest } from '../shared/ipc';
import type { EngineMessage } from '../shared/types';

/**
 * One run at a time: plans it, starts the local app if needed, runs the
 * engine as a separate Node process (Electron's own Node), and forwards its
 * progress to the window.
 */
export class RunManager {
  private engine: ChildProcess | null = null;
  private stopLocal: () => void = () => {};
  private cancelled = false;

  constructor(
    private engineFile: string,
    private emit: (e: RunEvent) => void,
  ) {}

  get running() {
    return this.engine !== null;
  }

  async start(req: RunRequest): Promise<{ ok: boolean; error?: string }> {
    if (this.engine) return { ok: false, error: 'A run is already in progress' };
    // Safety rules 3 and 4, checked again here whatever the window sent
    if (req.envs.includes('live') && req.confirmLive !== 'LIVE') return { ok: false, error: 'Type LIVE to run against the Live site' };
    let plan;
    const info = inspectProject(req.root);
    try {
      plan = buildPlan(info, { envs: req.envs, types: req.types, logins: req.logins, headless: true, baseBranch: req.baseBranch || undefined, confirmCrud: req.confirmCrud, confirmLiveSecurity: req.confirmLiveSecurity, lowLogins: req.lowLogins });
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }

    this.cancelled = false;
    this.emit({ kind: 'run-started', envs: req.envs, types: req.types });
    if (req.envs.includes('local')) {
      try {
        this.stopLocal = await ensureLocalApp(
          info.urls.local!.url,
          info.localStart,
          req.root,
          (text) => this.emit({ kind: 'log', text }),
          (text) => this.emit({ kind: 'local-log', text }),
        );
      } catch (e) {
        this.emit({ kind: 'error', text: (e as Error).message });
        this.emit({ kind: 'run-ended', ok: false, cancelled: false });
        return { ok: true };
      }
    }

    // cwd must be a real folder: in an installed app the engine lives inside app.asar
    const engine = spawn(process.execPath, [this.engineFile], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: req.root,
      windowsHide: true,
    });
    this.engine = engine;
    engine.on('error', (e) => {
      this.engine = null;
      this.stopLocal();
      this.stopLocal = () => {};
      this.emit({ kind: 'error', text: `The test engine could not start: ${e.message}` });
      this.emit({ kind: 'run-ended', ok: false, cancelled: false });
    });
    // The plan carries typed credentials: it goes over stdin, never to disk
    engine.stdin!.write(JSON.stringify(plan) + '\n');

    let ok = false;
    readline.createInterface({ input: engine.stdout! }).on('line', (line) => {
      let m: EngineMessage;
      try {
        m = JSON.parse(line);
      } catch {
        return;
      }
      if (m.kind === 'done') {
        ok = m.ok;
        engine.stdin!.end();
      }
      this.emit(m);
    });
    let stderr = '';
    engine.stderr!.on('data', (d) => {
      stderr = (stderr + d.toString()).slice(-3000);
      process.stderr.write(d); // visible when the app runs from a terminal
    });
    engine.on('exit', (code) => {
      this.engine = null;
      this.stopLocal();
      this.stopLocal = () => {};
      if (code && !this.cancelled) this.emit({ kind: 'error', text: `The engine stopped (code ${code}). ${stderr.trim()}` });
      this.emit({ kind: 'run-ended', ok, cancelled: this.cancelled });
    });
    return { ok: true };
  }

  /** Finishes the pages in progress, writes what finished, marks the rest unverified. */
  cancel() {
    if (!this.engine) return;
    this.cancelled = true;
    this.engine.stdin!.write('{"kind":"cancel"}\n');
  }

  /** App is quitting: closing stdin makes the engine cancel and delete its session. */
  shutdown() {
    this.engine?.stdin?.end();
    this.stopLocal();
  }
}
