import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import type { AppSettings, RecentProject } from '../shared/ipc';

// The app keeps only the recent-projects list and its own settings. Never credentials.
const file = (name: string) => path.join(app.getPath('userData'), name);

const read = <T>(name: string, fallback: T): T => {
  try {
    return { ...fallback, ...JSON.parse(fs.readFileSync(file(name), 'utf8')) };
  } catch {
    return fallback;
  }
};

const write = (name: string, value: unknown) => {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(file(name), JSON.stringify(value, null, 2), 'utf8');
};

export const DEFAULT_SETTINGS: AppSettings = { editor: 'code', theme: 'system', checkUpdates: true, betaUpdates: false, proxy: '', tourDone: false, lastSeenVersion: '' };

export const getSettings = (): AppSettings => read('settings.json', DEFAULT_SETTINGS);
export const saveSettings = (s: AppSettings) => write('settings.json', s);

export const listProjects = (): RecentProject[] =>
  read<{ projects: RecentProject[] }>('projects.json', { projects: [] })
    .projects.filter((p) => fs.existsSync(p.root))
    .sort((a, b) => b.lastOpened - a.lastOpened);

export const rememberProject = (p: Omit<RecentProject, 'lastOpened'>) => {
  const others = listProjects().filter((x) => path.resolve(x.root) !== path.resolve(p.root));
  write('projects.json', { projects: [{ ...p, lastOpened: Date.now() }, ...others].slice(0, 20) });
};

export const forgetProject = (root: string) =>
  write('projects.json', { projects: listProjects().filter((x) => path.resolve(x.root) !== path.resolve(root)) });
