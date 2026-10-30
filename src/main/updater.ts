import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { ReleaseNotes, UpdateState } from '../shared/ipc';
import { getSettings } from './store';

const EVERY = 4 * 60 * 60 * 1000;

/** Release notes from CHANGELOG.md (shipped inside the app): one section per "## x.y.z" heading. */
export const changelog = (): ReleaseNotes[] => {
  // The build copies it into dist/, next to main.js
  const file = path.join(__dirname, 'CHANGELOG.md');
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  return text
    .split(/^## /m)
    .slice(1)
    .map((block) => {
      const [head, ...body] = block.split('\n');
      const version = /^v?(\d+\.\d+\.\d+[\w.-]*)/.exec(head.trim())?.[1] ?? '';
      return {
        version,
        title: head.trim(),
        items: body.map((l) => l.trim()).filter((l) => l.startsWith('- ')).map((l) => l.slice(2)),
        intro: body.map((l) => l.trim()).filter((l) => l && !l.startsWith('- ')).join(' '),
      };
    })
    .filter((s) => s.version);
};

/** a > b for x.y.z versions (pre-release suffixes ignored). */
export const newer = (a: string, b: string) => {
  const p = (v: string) => v.split(/[.-]/).slice(0, 3).map(Number);
  const [x, y] = [p(a), p(b)];
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};

/**
 * In-app updates from GitHub Releases: checks at start and every few hours, and
 * reports to the window, which asks before downloading and before restarting.
 * QAGENT_FAKE_UPDATE=<version> plays the whole sequence without a server (tests).
 */
export class Updater {
  state: UpdateState = { state: 'idle' };
  private timer: NodeJS.Timeout | null = null;

  constructor(private send: (s: UpdateState) => void) {}

  private set(s: UpdateState) {
    this.state = s;
    this.send(s);
  }

  start() {
    if (process.env.QAGENT_FAKE_UPDATE) return setTimeout(() => this.check(), 1500);
    if (!app.isPackaged) return;
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('checking-for-update', () => this.set({ state: 'checking' }));
    autoUpdater.on('update-not-available', () => this.set({ state: 'none' }));
    autoUpdater.on('update-available', (i) =>
      this.set({ state: 'available', version: i.version, notes: typeof i.releaseNotes === 'string' ? i.releaseNotes.replace(/<[^>]+>/g, '').trim() : '', date: i.releaseDate }),
    );
    autoUpdater.on('download-progress', (p) => this.set({ state: 'downloading', version: (this.state as any).version, percent: Math.round(p.percent) }));
    autoUpdater.on('update-downloaded', (i) => this.set({ state: 'ready', version: i.version }));
    autoUpdater.on('error', (e) => this.set({ state: 'error', message: e.message.split('\n')[0] }));
    setTimeout(() => this.check(), 10_000);
    this.timer = setInterval(() => this.check(), EVERY);
  }

  async check() {
    const s = getSettings();
    if (!s.checkUpdates && !process.env.QAGENT_FAKE_UPDATE) return this.state;
    if (process.env.QAGENT_FAKE_UPDATE) {
      this.set({ state: 'available', version: process.env.QAGENT_FAKE_UPDATE, notes: 'A test release.', date: new Date().toISOString() });
      return this.state;
    }
    if (!app.isPackaged) return this.set({ state: 'none' }), this.state;
    autoUpdater.allowPrerelease = s.betaUpdates;
    await autoUpdater.checkForUpdates().catch((e) => this.set({ state: 'error', message: (e as Error).message.split('\n')[0] }));
    return this.state;
  }

  async download() {
    if (process.env.QAGENT_FAKE_UPDATE) {
      const version = process.env.QAGENT_FAKE_UPDATE;
      for (const percent of [20, 55, 90]) {
        this.set({ state: 'downloading', version, percent });
        await new Promise((r) => setTimeout(r, 300));
      }
      return this.set({ state: 'ready', version });
    }
    await autoUpdater.downloadUpdate().catch((e) => this.set({ state: 'error', message: (e as Error).message.split('\n')[0] }));
  }

  install() {
    if (process.env.QAGENT_FAKE_UPDATE) return this.set({ state: 'installing', version: process.env.QAGENT_FAKE_UPDATE });
    autoUpdater.quitAndInstall(false, true);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }
}
