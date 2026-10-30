import type { QAgentApi } from '../shared/ipc';

declare global {
  interface Window {
    qagent: QAgentApi;
  }
}

export const api = window.qagent;
