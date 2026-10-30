import fs from 'fs';
import path from 'path';
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell, type MenuItemConstructorOptions } from 'electron';
import type { AppSettings, RunEvent, RunRequest } from '../shared/ipc';
import type { QAgentConfig } from '../shared/config';
import { browserStatus, installChromium } from './browsers';
import { openInEditor } from './editor';
import { projectView, saveProjectConfig, validateConfig } from './project';
import { readHistory, readSheet } from './results';
import { RunManager } from './run';
import { startDemo, stopDemo } from './demo';
import { changelog, newer, Updater } from './updater';
import { record, type RecordKind } from './recorder';
import { approveBaselines, countPending } from '../engine/checks/visual';
import type { EnvName } from '../shared/types';
import { findNewPages } from '../planner/new-pages';
import { inspectProject } from '../planner/plan';
import { installReminder, reminderStatus } from '../planner/reminder';
import { readTestData } from '../shared/config';
import { forgetProject, getSettings, listProjects, rememberProject, saveSettings } from './store';

const RELEASES_URL = 'https://github.com/Hemang67/QAgent/releases';

// Tests and portable use can point the app at its own settings folder
if (process.env.QAGENT_USER_DATA) app.setPath('userData', process.env.QAGENT_USER_DATA);

let win: BrowserWindow | null = null;
const send = (channel: string, payload: unknown) => win?.webContents.send(channel, payload);
const updater = new Updater((s) => send('update', s));
const runs = new RunManager(path.join(__dirname, 'engine.js'), (e: RunEvent) => send('run-event', e));

/** A project folder given on the command line (`qagent <folder>`) or in QAGENT_OPEN. */
const startupProject = (argv: string[]) => {
  // In development Electron is started as `electron <app folder>`: that folder is not a project
  const args = argv.slice(1).filter((a) => !a.startsWith('-') && path.resolve(a) !== path.resolve(app.getAppPath()));
  const candidate = process.env.QAGENT_OPEN || args[args.length - 1];
  return candidate && fs.existsSync(candidate) && fs.statSync(candidate).isDirectory() ? path.resolve(candidate) : null;
};

const resultsFile = (root: string) => projectView(root).resultsFile;

const buildMenu = () => {
  const cmd = (command: string) => () => send('menu', command);
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        { label: 'Open project…', accelerator: 'CmdOrCtrl+O', click: cmd('open-project') },
        { label: 'Projects', accelerator: 'CmdOrCtrl+Shift+P', click: cmd('projects') },
        { type: 'separator' },
        { label: 'App settings', accelerator: 'CmdOrCtrl+,', click: cmd('app-settings') },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Project',
      submenu: [
        { label: 'Run tests', accelerator: 'CmdOrCtrl+R', click: cmd('run') },
        { label: 'Results', accelerator: 'CmdOrCtrl+E', click: cmd('results') },
        { label: 'List pages', click: cmd('pages') },
        { label: 'Flows and CRUD screens', click: cmd('flows') },
        { label: 'Approve visual baseline…', click: cmd('results') },
        { label: 'Project settings', click: cmd('settings') },
        { label: 'Set up project again', click: cmd('setup') },
      ],
    },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
    {
      label: 'Help',
      submenu: [
        { label: 'Take the tour', click: cmd('tour') },
        { label: "What's new", click: cmd('whats-new') },
        { label: 'Check for updates', click: () => updater.check() },
        { type: 'separator' },
        { label: 'Releases and downloads', click: () => shell.openExternal(RELEASES_URL) },
        { label: `About QAgent ${app.getVersion()}`, click: () => dialog.showMessageBox({ title: 'QAgent', message: `QAgent ${app.getVersion()}`, detail: 'Tests any web app and records the results in Excel.\nMIT licence · Techovarya' }) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
};

const createWindow = () => {
  win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 620,
    show: false,
    title: 'QAgent',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#14161a' : '#f6f7f9',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  win.once('ready-to-show', () => win?.show());
  // The window shows only QAgent's own pages; links go to the system browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win?.webContents.getURL()) e.preventDefault();
  });
  win.on('closed', () => (win = null));

  const project = startupProject(process.argv);
  win.webContents.once('did-finish-load', () => project && send('menu', `open:${project}`));
  if (process.env.VITE_DEV_SERVER_URL) win.loadURL(process.env.VITE_DEV_SERVER_URL);
  else win.loadFile(path.join(__dirname, 'ui', 'index.html'));
};

const registerIpc = () => {
  const handle = (channel: string, fn: (...args: any[]) => unknown) => ipcMain.handle(channel, (_e, ...args) => fn(...args));
  handle('appInfo', () => ({ version: app.getVersion(), platform: process.platform }));
  handle('listProjects', () => listProjects());
  handle('pickProject', async () => {
    const r = await dialog.showOpenDialog(win!, { title: 'Open a web project', properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  handle('openProject', (root: string) => {
    const view = projectView(root);
    rememberProject({ root, name: view.name, framework: view.framework });
    return view;
  });
  handle('removeProject', (root: string) => forgetProject(root));
  handle('validateConfig', (config: unknown) => validateConfig(config));
  handle('saveConfig', (root: string, config: QAgentConfig, gitignore?: boolean) => saveProjectConfig(root, config, gitignore));
  handle('startRun', (req: RunRequest) => runs.start(req));
  handle('cancelRun', () => runs.cancel());
  handle('readHistory', (root: string) => readHistory(resultsFile(root)));
  handle('readSheet', (root: string, sheet: string) => readSheet(resultsFile(root), sheet));
  handle('openResults', async (root: string) => {
    const file = resultsFile(root);
    if (!fs.existsSync(file)) return 'No results yet: run tests first';
    return (await shell.openPath(file)) || null;
  });
  handle('openFile', (root: string, file: string) => openInEditor(root, file, getSettings().editor));
  handle('getSettings', () => getSettings());
  handle('saveSettings', (s: AppSettings) => {
    saveSettings(s);
    nativeTheme.themeSource = s.theme;
  });
  handle('browserStatus', () => browserStatus());
  handle('installChromium', () => installChromium(getSettings().proxy, (line) => send('install-log', line)));
  handle('openExternal', (url: string) => (url.startsWith('https://') ? shell.openExternal(url) : undefined));
  handle('recordFlow', (root: string, env: EnvName, kind: RecordKind, startPath: string) => {
    const url = projectView(root).urls[env]?.url;
    return url ? record(url, startPath || '/', kind) : { ok: false, error: `No URL for ${env}` };
  });
  const baselineDir = (root: string) => path.join(root, '.qagent', 'baselines');
  handle('approveBaselines', (root: string) => approveBaselines(baselineDir(root)));
  handle('pendingBaselines', (root: string) => countPending(baselineDir(root)));
  handle('newPages', (root: string, base?: string) => {
    try {
      const info = inspectProject(root);
      return { ok: true, ...findNewPages(root, info.routes, info.config, base || info.config.baseBranch) };
    } catch (e) {
      return { ok: false, error: (e as Error).message.split('\n')[0] };
    }
  });
  handle('saveTestData', (root: string, env: EnvName, data: Record<string, string>) => {
    const dir = path.join(root, '.qagent');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `test-data.${env}.json`), JSON.stringify({ ...readTestData(root, env), ...data }, null, 2) + '\n', 'utf8');
  });
  handle('reminderStatus', (root: string) => reminderStatus(root));
  handle('startDemo', () => startDemo());
  // Notes for versions after the last one seen; nothing on a fresh install (the tour greets instead)
  handle('whatsNew', (all?: boolean) => {
    // From the Help menu: the notes of this version and the two before it
    if (all) return changelog().filter((n) => !newer(n.version, app.getVersion())).slice(0, 3);
    const seen = getSettings().lastSeenVersion;
    if (!seen) return [];
    return changelog().filter((n) => newer(n.version, seen) && !newer(n.version, app.getVersion()));
  });
  handle('markSeen', () => saveSettings({ ...getSettings(), lastSeenVersion: app.getVersion() }));
  handle('updateState', () => updater.state);
  handle('checkForUpdate', () => updater.check());
  handle('downloadUpdate', () => updater.download());
  handle('installUpdate', () => updater.install());
  handle('installReminder', (root: string) => installReminder(root));
};

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
    const project = startupProject(argv);
    if (project) send('menu', `open:${project}`);
  });

  app.whenReady().then(() => {
    nativeTheme.themeSource = getSettings().theme;
    buildMenu();
    registerIpc();
    createWindow();
    updater.start();
  });

  app.on('before-quit', (e) => {
    if (!runs.running) return;
    const choice = dialog.showMessageBoxSync({
      type: 'warning',
      buttons: ['Cancel the run and quit', 'Keep running'],
      defaultId: 1,
      message: 'A test run is in progress',
      detail: 'Quitting cancels it. Pages already tested are still written to the workbook.',
    });
    if (choice === 1) e.preventDefault();
    else runs.shutdown();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => {
    updater.stop();
    stopDemo();
  });
}
