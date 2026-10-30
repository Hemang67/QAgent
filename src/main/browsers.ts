import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright-core';
import { findBrowser } from '../planner/plan';
import type { BrowserStatus } from '../shared/ipc';

const chromiumInstalled = () => {
  try {
    return fs.existsSync(chromium.executablePath());
  } catch {
    return false;
  }
};

export const browserStatus = (): BrowserStatus => ({ channel: findBrowser().channel ?? null, chromiumInstalled: chromiumInstalled() });

/** playwright-core's own installer, run with Electron's Node. Unpacked from the app archive in installed builds. */
const installerScript = () => require.resolve('playwright-core/cli.js').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

/** Downloads Chromium (about 150 MB) into the shared Playwright browser folder. */
export const installChromium = (proxy: string, onLine: (line: string) => void) =>
  new Promise<{ ok: boolean; error?: string }>((resolve) => {
    const env: NodeJS.ProcessEnv = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
    if (proxy) env.HTTPS_PROXY = env.HTTP_PROXY = proxy;
    const child = spawn(process.execPath, [installerScript(), 'install', 'chromium'], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let tail = '';
    const onData = (d: Buffer) => {
      const s = d.toString();
      tail = (tail + s).slice(-2000);
      for (const line of s.split(/\r?\n|\r/)) if (line.trim()) onLine(line.trim());
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (e) => resolve({ ok: false, error: e.message }));
    child.on('exit', (code) => resolve(code === 0 && chromiumInstalled() ? { ok: true } : { ok: false, error: tail.trim().split('\n').slice(-3).join(' ') || `Exit code ${code}` }));
  });
