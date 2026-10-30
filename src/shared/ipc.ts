// The contract between the window (React) and the main process. The window
// reaches the main process only through `window.qagent`, built in the preload.
import type { QAgentConfig } from './config';
import type { EngineMessage, EnvName, FlowStep, LoginMode, PageResult, RouteInfo, TestType } from './types';

export interface RecentProject {
  root: string;
  name: string;
  framework: string;
  lastOpened: number;
}

export interface EndpointCandidate {
  endpoint: string;
  file: string;
}

/** Everything the Setup, Run, Pages and Settings screens need about one project. */
export interface ProjectView {
  root: string;
  name: string;
  framework: string;
  hasConfig: boolean;
  config: QAgentConfig;
  routes: RouteInfo[];
  urls: Partial<Record<EnvName, { url: string; apiUrl?: string }>>;
  localStart: string | null;
  /** Side-effect endpoints found in the code that are not blocked yet */
  endpointCandidates: EndpointCandidate[];
  /** Record IDs set per environment in .qagent/test-data.<env>.json */
  testDataKeys: Partial<Record<EnvName, string[]>>;
  gitignoreReady: boolean;
  resultsFile: string;
  resultsExists: boolean;
}

export interface RunLogin {
  mode: LoginMode;
  username?: string;
  password?: string;
}

export interface RunRequest {
  root: string;
  envs: EnvName[];
  types: TestType[];
  logins: Partial<Record<EnvName, RunLogin>>;
  /** Typed confirmations: "LIVE" for Live runs, "YES" for CRUD */
  confirmLive?: string;
  confirmCrud?: string;
  /** "LIVE SECURITY" for the security scan on Live */
  confirmLiveSecurity?: string;
  /** Security scan: second, low-permission login */
  lowLogins?: Partial<Record<EnvName, RunLogin>>;
  /** Change-impact: branch to compare with */
  baseBranch?: string;
}

/** Engine messages plus what the main process adds around a run. */
export type RunEvent =
  | EngineMessage
  | { kind: 'local-log'; text: string }
  | { kind: 'run-started'; envs: EnvName[]; types: TestType[] }
  | { kind: 'run-ended'; ok: boolean; cancelled: boolean };

export interface HistoryRow {
  runTime: string;
  env: string;
  type: string;
  result: string;
  passed: number;
  failed: number;
  skipped: number;
  unverified: number;
  passRate: number | null;
  sheet: string | null;
  runBy: string;
  device: string;
  appAccount: string;
}

export interface SheetRow {
  page: string;
  what: string;
  kind: string;
  result: PageResult;
  reason: string;
  details: string;
  consoleErrors: number;
  failedApi: number;
  ms: number;
  file: string;
}

export interface FindingRow {
  severity: string;
  check: string;
  url: string;
  evidence: string;
  fix: string;
}

export interface SheetView {
  name: string;
  title: string;
  subtitle: string;
  summary: string;
  rows: SheetRow[];
  findings: FindingRow[];
}

export type EditorChoice = 'code' | 'cursor' | 'windsurf' | 'idea' | 'system';

export interface AppSettings {
  editor: EditorChoice;
  theme: 'system' | 'light' | 'dark';
  checkUpdates: boolean;
  betaUpdates: boolean;
  /** Proxy for the Chromium download, e.g. http://proxy:8080 */
  proxy: string;
  /** The first-run tour was finished or skipped */
  tourDone: boolean;
  /** Version whose "What's new" was shown last; empty on a fresh install */
  lastSeenVersion: string;
}

export interface ReleaseNotes {
  version: string;
  title: string;
  intro: string;
  items: string[];
}

export type UpdateState =
  | { state: 'idle' | 'checking' | 'none' }
  | { state: 'available'; version: string; notes: string; date?: string }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'ready' | 'installing'; version: string }
  | { state: 'error'; message: string };

export interface BrowserStatus {
  /** Installed Chrome or Edge in use, if any */
  channel: string | null;
  chromiumInstalled: boolean;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export interface QAgentApi {
  appInfo(): Promise<{ version: string; platform: string }>;
  listProjects(): Promise<RecentProject[]>;
  pickProject(): Promise<string | null>;
  /** Path of a folder dropped on the window */
  pathForFile(file: File): string;
  openProject(root: string): Promise<ProjectView>;
  removeProject(root: string): Promise<void>;
  validateConfig(config: unknown): Promise<ValidationResult>;
  saveConfig(root: string, config: QAgentConfig, addGitignore?: boolean): Promise<ValidationResult>;
  startRun(req: RunRequest): Promise<{ ok: boolean; error?: string }>;
  cancelRun(): Promise<void>;
  onRunEvent(cb: (e: RunEvent) => void): () => void;
  readHistory(root: string): Promise<HistoryRow[]>;
  readSheet(root: string, sheet: string): Promise<SheetView | null>;
  openResults(root: string): Promise<string | null>;
  openFile(root: string, file: string): Promise<string | null>;
  getSettings(): Promise<AppSettings>;
  saveSettings(s: AppSettings): Promise<void>;
  browserStatus(): Promise<BrowserStatus>;
  installChromium(): Promise<{ ok: boolean; error?: string }>;
  onInstallLog(cb: (line: string) => void): () => void;
  /** Menu commands ("open-project", "run", "settings"…) */
  onMenu(cb: (command: string) => void): () => void;
  openExternal(url: string): Promise<void>;
  /** Opens a browser where the user performs a journey; resolves when they finish */
  recordFlow(root: string, env: EnvName, kind: 'flow' | 'crud', startPath: string): Promise<RecordResult>;
  /** Accepts the latest screenshots as the visual baselines; returns how many */
  approveBaselines(root: string): Promise<number>;
  /** Screenshots waiting for approval */
  pendingBaselines(root: string): Promise<number>;
  /** Pages and send/book/charge endpoints added since the base branch */
  newPages(root: string, base?: string): Promise<{ ok: true; base: string; pages: (RouteInfo & { configured: boolean })[]; endpoints: EndpointCandidate[] } | { ok: false; error: string }>;
  /** Merges record IDs into .qagent/test-data.<env>.json (this machine only) */
  saveTestData(root: string, env: EnvName, data: Record<string, string>): Promise<void>;
  reminderStatus(root: string): Promise<{ state: 'installed' | 'not-installed' | 'not-git' | 'other-hook'; hookFile?: string; line?: string }>;
  installReminder(root: string): Promise<{ state: 'installed' | 'not-installed' | 'not-git' | 'other-hook'; hookFile?: string; line?: string }>;
  /** Copies and serves the demo shop for the tour; returns its folder */
  startDemo(): Promise<string>;
  /** Release notes newer than the last version seen, for "What's new" (empty when there is nothing to show) */
  whatsNew(all?: boolean): Promise<ReleaseNotes[]>;
  markSeen(): Promise<void>;
  updateState(): Promise<UpdateState>;
  checkForUpdate(): Promise<UpdateState>;
  downloadUpdate(): Promise<void>;
  installUpdate(): Promise<void>;
  onUpdate(cb: (s: UpdateState) => void): () => void;
}

export interface RecordResult {
  ok: boolean;
  error?: string;
  startPath?: string;
  steps?: FlowStep[];
  phases?: Record<'create' | 'edit' | 'delete', FlowStep[]>;
}
