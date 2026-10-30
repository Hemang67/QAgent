import { spawn, spawnSync, type ChildProcess } from 'child_process';
import http from 'http';
import https from 'https';

const START_TIMEOUT = 5 * 60_000;

/** True when anything answers HTTP on the URL (any status). */
export const isUp = (url: string) =>
  new Promise<boolean>((resolve) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { timeout: 3000, rejectUnauthorized: false }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });

const killTree = (child: ChildProcess) => {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  else {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
  }
};

/**
 * Local runs only: starts the app with its start command when nothing answers
 * on the local URL, and waits up to 5 minutes. Returns a function that stops
 * it again (a no-op when the app was already running).
 */
export const ensureLocalApp = async (
  url: string,
  command: string | null,
  cwd: string,
  log: (s: string) => void,
  onOutput?: (chunk: string) => void,
): Promise<() => void> => {
  if (await isUp(url)) return () => {};
  if (!command) throw new Error(`Nothing answers on ${url} and no start command is set (local.start in .qagent.json)`);
  log(`Starting the app: ${command} (waiting for ${url}, up to 5 minutes)…`);
  // BROWSER=none stops dev servers (CRA, Vite) from opening a browser tab. windowsHide: started
  // from the desktop app, a console process would otherwise open a window and take the focus
  const child = spawn(command, {
    cwd,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
    windowsHide: true,
    env: { ...process.env, BROWSER: 'none' },
  });
  let output = '';
  const keep = (d: Buffer) => {
    const s = d.toString();
    output = (output + s).slice(-4000);
    onOutput?.(s);
  };
  child.stdout?.on('data', keep);
  child.stderr?.on('data', keep);
  const deadline = Date.now() + START_TIMEOUT;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`The start command exited (code ${child.exitCode}):\n${output.slice(-1500)}`);
    if (await isUp(url)) return () => killTree(child);
    await new Promise((r) => setTimeout(r, 1000));
  }
  killTree(child);
  throw new Error(`${url} did not answer within 5 minutes of "${command}"`);
};
