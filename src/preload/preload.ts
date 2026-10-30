// The only bridge between the window and the main process. The window has no Node access.
import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { QAgentApi } from '../shared/ipc';

const invoke =
  (channel: string) =>
  (...args: unknown[]) =>
    ipcRenderer.invoke(channel, ...args);

const listen = (channel: string) => (cb: (payload: any) => void) => {
  const handler = (_e: unknown, payload: unknown) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
};

const api: QAgentApi = {
  appInfo: invoke('appInfo') as QAgentApi['appInfo'],
  listProjects: invoke('listProjects') as QAgentApi['listProjects'],
  pickProject: invoke('pickProject') as QAgentApi['pickProject'],
  pathForFile: (file) => webUtils.getPathForFile(file),
  openProject: invoke('openProject') as QAgentApi['openProject'],
  removeProject: invoke('removeProject') as QAgentApi['removeProject'],
  validateConfig: invoke('validateConfig') as QAgentApi['validateConfig'],
  saveConfig: invoke('saveConfig') as QAgentApi['saveConfig'],
  startRun: invoke('startRun') as QAgentApi['startRun'],
  cancelRun: invoke('cancelRun') as QAgentApi['cancelRun'],
  onRunEvent: listen('run-event'),
  readHistory: invoke('readHistory') as QAgentApi['readHistory'],
  readSheet: invoke('readSheet') as QAgentApi['readSheet'],
  openResults: invoke('openResults') as QAgentApi['openResults'],
  openFile: invoke('openFile') as QAgentApi['openFile'],
  getSettings: invoke('getSettings') as QAgentApi['getSettings'],
  saveSettings: invoke('saveSettings') as QAgentApi['saveSettings'],
  browserStatus: invoke('browserStatus') as QAgentApi['browserStatus'],
  installChromium: invoke('installChromium') as QAgentApi['installChromium'],
  onInstallLog: listen('install-log'),
  onMenu: listen('menu'),
  openExternal: invoke('openExternal') as QAgentApi['openExternal'],
  recordFlow: invoke('recordFlow') as QAgentApi['recordFlow'],
  approveBaselines: invoke('approveBaselines') as QAgentApi['approveBaselines'],
  pendingBaselines: invoke('pendingBaselines') as QAgentApi['pendingBaselines'],
  newPages: invoke('newPages') as QAgentApi['newPages'],
  saveTestData: invoke('saveTestData') as QAgentApi['saveTestData'],
  reminderStatus: invoke('reminderStatus') as QAgentApi['reminderStatus'],
  installReminder: invoke('installReminder') as QAgentApi['installReminder'],
  startDemo: invoke('startDemo') as QAgentApi['startDemo'],
  whatsNew: invoke('whatsNew') as QAgentApi['whatsNew'],
  markSeen: invoke('markSeen') as QAgentApi['markSeen'],
  updateState: invoke('updateState') as QAgentApi['updateState'],
  checkForUpdate: invoke('checkForUpdate') as QAgentApi['checkForUpdate'],
  downloadUpdate: invoke('downloadUpdate') as QAgentApi['downloadUpdate'],
  installUpdate: invoke('installUpdate') as QAgentApi['installUpdate'],
  onUpdate: listen('update'),
};

contextBridge.exposeInMainWorld('qagent', api);
