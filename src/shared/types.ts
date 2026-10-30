// Types shared by the planner, the engine and (later) the extension.
// Nothing here may import vscode or playwright.

export type EnvName = 'local' | 'dev' | 'test' | 'live';
export const ENV_NAMES: EnvName[] = ['local', 'dev', 'test', 'live'];
export const ENV_LABEL: Record<EnvName, string> = { local: 'Local', dev: 'Dev', test: 'Test', live: 'Live' };

// Phase 1 implements smoke and regression; the rest are declared so the
// plan, the Guide sheet and the safety rules already know about them
export type TestType =
  | 'smoke'
  | 'impact'
  | 'regression'
  | 'flows'
  | 'crud'
  | 'a11y'
  | 'perf'
  | 'links'
  | 'responsive'
  | 'visual'
  | 'security';

export const TEST_TYPE_LABEL: Record<TestType, string> = {
  smoke: 'Smoke',
  impact: 'Change-impact',
  regression: 'Full regression',
  flows: 'Critical flows',
  crud: 'CRUD',
  a11y: 'Accessibility',
  perf: 'Performance',
  links: 'Broken links',
  responsive: 'Responsive',
  visual: 'Visual change',
  security: 'Security scan',
};

export const IMPLEMENTED_TYPES: TestType[] = ['smoke', 'impact', 'regression', 'flows', 'crud', 'a11y', 'perf', 'links', 'responsive', 'visual', 'security'];

/** Where each test type may run (safety rule 3 and the test-type table). */
export const TYPE_ENVS: Record<TestType, EnvName[]> = {
  smoke: ['local', 'dev', 'test', 'live'],
  impact: ['local', 'dev'],
  regression: ['local', 'dev', 'test', 'live'],
  flows: ['local', 'dev', 'test', 'live'],
  crud: ['local', 'dev', 'test'],
  a11y: ['local', 'dev', 'test', 'live'],
  perf: ['local', 'dev', 'test', 'live'],
  links: ['local', 'dev', 'test', 'live'],
  responsive: ['local', 'dev', 'test', 'live'],
  visual: ['local', 'dev', 'test', 'live'],
  security: ['local', 'dev', 'test', 'live'],
};

/** One recorded action. Values may use {{name}}: the unique QAgent-… name of a CRUD run. */
export type FlowStep =
  | { goto: string }
  | { click: string }
  | { fill: string; value: string }
  | { select: string; value: string }
  | { check: string }
  | { press: string; key: string }
  | { expectText: string }
  | { expectUrl: string };

export interface FlowDef {
  name: string;
  steps: FlowStep[];
  /** Let this flow's non-GET requests through (never on Live; blocked endpoints stay blocked) */
  allowWrites?: boolean;
}

/** A screen where CRUD creates, edits and deletes a QAgent-… record. */
export interface CrudDef {
  name: string;
  route: string;
  create: FlowStep[];
  edit?: FlowStep[];
  delete: FlowStep[];
}

export type PageResult = 'passed' | 'failed' | 'skipped' | 'unverified';
export type Severity = 'error' | 'warning' | 'info';

export interface Problem {
  type: string;
  severity: Severity;
  detail: string;
}

/** A page as found by an adapter or the crawler. */
export interface RouteInfo {
  /** Path pattern, e.g. `/orders/:id` */
  path: string;
  /** Source file of the page, relative to the project root, when known */
  file?: string;
  /** Names of path parameters (`:id`) and query parameters the page reads */
  params: string[];
  /** How it was found */
  source: 'router' | 'filesystem' | 'crawl' | 'config';
}

/** A page ready to visit: the URL is resolved, or it is unverified for a reason. */
export interface PlannedPage {
  route: string;
  file?: string;
  url: string | null;
  /** Why the page cannot be opened (missing record ID); the page is reported unverified */
  missing?: string;
  /** Configured skip reason */
  skip?: string;
  exploreTabs: boolean;
}

export type LoginMode = 'browser' | 'credentials' | 'skip';

export interface LoginPlan {
  mode: LoginMode;
  /** Kept in memory only; the plan travels to the engine over stdin, never on disk */
  username?: string;
  password?: string;
  loginPath: string;
  loggedInPath?: string;
  logoutPath?: string;
  /** CSS selector of the element showing the logged-in user's name */
  accountSelector?: string;
}

export interface Budgets {
  readyWarnMs: number;
  readyFailMs: number;
  apiWarnMs: number;
  lcpWarnMs: number;
}

export interface Readiness {
  /** Where the page renders its content; first match wins */
  contentSelector: string;
  loaderSelector: string;
  quietWindowMs: number;
  readyTimeoutMs: number;
  maxTabDepth: number;
}

/** One environment × one test type. */
export interface RunJob {
  env: EnvName;
  type: TestType;
  baseUrl: string;
  /** Extra origins that count as the app's own API (e.g. https://api.example.com) */
  apiOrigins: string[];
  pages: PlannedPage[];
  /** Crawl the running site for pages (no adapter routes, or config asks for it) */
  crawl: boolean;
  crawlLimit: number;
  /** Smoke list from config; empty = choose top menu pages at run time */
  smokeList: string[];
  /** Critical flows and CRUD screens, for those types */
  flows?: FlowDef[];
  crud?: CrudDef[];
  /** Notes from planning, shown on the sheet (e.g. what Change-impact selected and why) */
  notes?: string[];
}

export interface VisualSettings {
  /** Share of pixels that may differ before a page fails (0.005 = 0.5 %) */
  threshold: number;
  /** Selectors hidden before the screenshot (dates, live counters) */
  mask: string[];
  /** Folder of baselines: .qagent/baselines */
  dir: string;
}

export interface RunPlan {
  projectRoot: string;
  projectName: string;
  framework: string;
  resultsFile: string;
  /** Where results go when the workbook cannot be written */
  fallbackDir: string;
  jobs: RunJob[];
  /** Login per environment */
  logins: Partial<Record<EnvName, LoginPlan>>;
  /** Security scan: the second, low-permission login for role checks */
  lowLogins: Partial<Record<EnvName, LoginPlan>>;
  blockedEndpoints: string[];
  /** Non-GET requests allowed in read-only runs, e.g. "POST /api/search" */
  readOnlyAllow: string[];
  budgets: Budgets;
  readiness: Readiness;
  visual: VisualSettings;
  workers: number;
  runBy: string;
  device: string;
  /** Browser to drive: an installed channel, or a Chromium executable path */
  browser: { channel?: string; executablePath?: string; headless: boolean };
}

/** Lines the engine writes to stdout, one JSON object per line. */
export type EngineMessage =
  | { kind: 'log'; text: string }
  | { kind: 'job-start'; env: EnvName; type: TestType; pages: number }
  /** A page visit began (the UI shows what is being tested right now) */
  | { kind: 'page-start'; env: EnvName; type: TestType; route: string }
  | { kind: 'page'; env: EnvName; type: TestType; route: string; step: 'site' | 'login' | 'page' | 'flow' | 'crud' | 'check'; part?: string; result: PageResult; reason: string; done: number; total: number; file?: string }
  | { kind: 'job-end'; env: EnvName; type: TestType; status: PageResult; counts: Record<PageResult, number> }
  | { kind: 'workbook'; file: string; sheets: string[] }
  | { kind: 'fallback'; dir: string; error: string }
  | { kind: 'done'; ok: boolean }
  | { kind: 'error'; text: string };
