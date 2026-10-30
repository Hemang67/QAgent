import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { detectAdapter } from '../adapters';
import { changeImpact } from './impact';
import { DEFAULT_BUDGETS, DEFAULT_READINESS, readConfig, readTestData, type QAgentConfig } from '../shared/config';
import {
  IMPLEMENTED_TYPES,
  TEST_TYPE_LABEL,
  TYPE_ENVS,
  type EnvName,
  type LoginPlan,
  type PlannedPage,
  type RouteInfo,
  type RunJob,
  type RunPlan,
  type TestType,
} from '../shared/types';

export interface RunChoices {
  envs: EnvName[];
  types: TestType[];
  /** Login per environment; username/password stay in memory */
  logins: Partial<Record<EnvName, Pick<LoginPlan, 'mode' | 'username' | 'password'>>>;
  headless?: boolean;
  /** Change-impact: branch to compare with */
  baseBranch?: string;
  /** CRUD writes data: YES must be typed */
  confirmCrud?: string;
  /** The security scan on Live needs LIVE SECURITY typed */
  confirmLiveSecurity?: string;
  /** Security scan: second, low-permission login per environment */
  lowLogins?: Partial<Record<EnvName, Pick<LoginPlan, 'mode' | 'username' | 'password'>>>;
}

export interface ProjectInfo {
  root: string;
  name: string;
  framework: string;
  config: QAgentConfig;
  routes: RouteInfo[];
  urls: Partial<Record<EnvName, { url: string; apiUrl?: string }>>;
  localStart: string | null;
}

/** Everything detected or configured about a project, before any choice is made. */
export const inspectProject = (root: string): ProjectInfo => {
  const config = readConfig(root) ?? {};
  const adapter = detectAdapter(root, config.framework);
  const detected = adapter.environments(root);
  const start = adapter.startCommand(root);
  const urls: ProjectInfo['urls'] = {};
  const local = config.local?.url ?? detected.local?.url ?? start?.url;
  if (local) urls.local = { url: local, apiUrl: config.local?.apiUrl ?? detected.local?.apiUrl };
  for (const env of ['dev', 'test', 'live'] as const) {
    const c = config.environments?.[env];
    const url = c?.url ?? detected[env]?.url;
    if (url) urls[env] = { url, apiUrl: c?.apiUrl ?? detected[env]?.apiUrl };
  }
  const routes = config.discovery === 'crawl' ? [] : adapter.routes(root);
  const pkgName = (() => {
    try {
      return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).name as string;
    } catch {
      return '';
    }
  })();
  return {
    root,
    name: pkgName || path.basename(root),
    framework: adapter.id,
    config,
    routes,
    urls,
    localStart: config.local?.start ?? start?.command ?? null,
  };
};

const origin = (u: string | undefined) => {
  try {
    return u ? new URL(u).origin : undefined;
  } catch {
    return undefined;
  }
};

/** Fills `:id` and ID query parameters from .qagent/test-data.<env>.json; unverified when one is missing. */
export const planPage = (r: RouteInfo, baseUrl: string, config: QAgentConfig, testData: Record<string, unknown>, env: EnvName): PlannedPage => {
  const pageCfg = config.pages?.[r.path] ?? {};
  const keyFor = (param: string) => pageCfg.params?.[param] ?? param;
  const missing: string[] = [];
  let p = r.path;
  const query = new URLSearchParams();
  for (const param of r.params) {
    const name = param.replace(/^\?/, '');
    const key = keyFor(name);
    const value = testData[key];
    if (value === undefined || value === null || value === '') {
      missing.push(key);
      continue;
    }
    if (param.startsWith('?')) query.set(name, String(value));
    else p = p.replace(new RegExp(`:${name}\\??(?=/|$)`), encodeURIComponent(String(value)));
  }
  // Optional path parameters that were not set are dropped from the URL
  p = p.replace(/\/:[A-Za-z0-9_]+\?(?=\/|$)/g, '');
  const qs = query.toString();
  return {
    route: r.path,
    file: r.file,
    url: missing.length ? null : new URL(p + (qs ? `?${qs}` : ''), baseUrl).toString(),
    missing: missing.length ? `Needs a record ID: set ${missing.join(', ')} in .qagent/test-data.${env}.json` : undefined,
    skip: pageCfg.skip,
    exploreTabs: true,
  };
};

const gitUser = (root: string) => {
  try {
    return execFileSync('git', ['config', 'user.name'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return os.userInfo().username;
  }
};

/** An installed Chrome or Edge, so most users never download Chromium. */
export const findBrowser = (): RunPlan['browser'] => {
  const candidates: [string, string[]][] =
    process.platform === 'win32'
      ? [
          ['chrome', [`${process.env['PROGRAMFILES']}\\Google\\Chrome\\Application\\chrome.exe`, `${process.env['PROGRAMFILES(X86)']}\\Google\\Chrome\\Application\\chrome.exe`, `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`]],
          ['msedge', [`${process.env['PROGRAMFILES(X86)']}\\Microsoft\\Edge\\Application\\msedge.exe`, `${process.env['PROGRAMFILES']}\\Microsoft\\Edge\\Application\\msedge.exe`]],
        ]
      : process.platform === 'darwin'
        ? [
            ['chrome', ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']],
            ['msedge', ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']],
          ]
        : [
            ['chrome', ['/opt/google/chrome/chrome', '/usr/bin/google-chrome']],
            ['msedge', ['/opt/microsoft/msedge/msedge', '/usr/bin/microsoft-edge']],
          ];
  for (const [channel, paths] of candidates) if (paths.some((p) => fs.existsSync(p))) return { channel, headless: true };
  // Playwright's own Chromium (downloaded on first run by the extension)
  return { headless: true };
};

export const buildPlan = (info: ProjectInfo, choices: RunChoices): RunPlan => {
  const { config, root } = info;
  const loginPath = config.login?.path ?? '/login';

  for (const t of choices.types) {
    if (!IMPLEMENTED_TYPES.includes(t)) throw new Error(`${TEST_TYPE_LABEL[t]} is not available in this version yet`);
  }
  // Safety rule 3, enforced here as well as in the run panel
  if (choices.envs.includes('live') && choices.types.includes('crud')) throw new Error('CRUD never runs on Live');
  // Safety rule 4: CRUD writes data, so it needs YES typed
  if (choices.types.includes('crud') && choices.confirmCrud !== 'YES') throw new Error('Type YES to run CRUD: it creates and deletes test records');
  // Safety rule 4: the security scan on Live has its own confirmation
  if (choices.envs.includes('live') && choices.types.includes('security') && choices.confirmLiveSecurity !== 'LIVE SECURITY') throw new Error('Type LIVE SECURITY to scan the Live site');
  for (const env of choices.envs) {
    for (const t of choices.types) if (!TYPE_ENVS[t].includes(env)) throw new Error(`${TEST_TYPE_LABEL[t]} does not run on ${env}`);
  }
  // Change-impact reads git once; the same pages are tested on each environment
  const impact = choices.types.includes('impact') ? changeImpact(root, info.routes, choices.baseBranch ?? config.baseBranch) : null;

  const jobs: RunJob[] = [];
  const logins: RunPlan['logins'] = {};
  const lowLogins: RunPlan['lowLogins'] = {};
  for (const env of choices.envs) {
    const target = info.urls[env];
    if (!target) throw new Error(`No URL for ${env}: add it to .qagent.json`);
    const baseUrl = target.url.replace(/\/+$/, '');
    const testData = readTestData(root, env);
    const pages = info.routes
      .filter((r) => r.path.toLowerCase() !== loginPath.toLowerCase())
      .map((r) => planPage(r, baseUrl, config, testData, env));
    const choice = choices.logins[env] ?? { mode: 'skip' as const };
    logins[env] = {
      ...choice,
      loginPath,
      loggedInPath: config.login?.loggedInPath,
      logoutPath: config.login?.logoutPath,
      accountSelector: config.login?.accountSelector,
    };
    const low = choices.lowLogins?.[env];
    if (low && low.mode !== 'skip') lowLogins[env] = { ...logins[env]!, ...low, username: low.username, password: low.password };
    for (const type of choices.types) {
      const job: RunJob = {
        env,
        type,
        baseUrl,
        apiOrigins: [origin(target.apiUrl)].filter((o): o is string => !!o),
        // Smoke picks its own pages; it uses this list to find their source files
        pages,
        crawl: info.routes.length === 0,
        crawlLimit: config.crawlLimit ?? 300,
        smokeList: config.lists?.smoke ?? [],
      };
      if (type === 'impact' && impact) {
        job.crawl = false;
        if (impact.routes !== 'all') job.pages = pages.filter((p) => (impact.routes as Set<string>).has(p.route));
        job.notes = [`Compared with ${impact.base}: ${impact.changedFiles} changed file(s) → ${job.pages.length} page(s)`, ...impact.notes.slice(0, 12)];
      }
      if (type === 'flows') job.flows = config.lists?.criticalFlows ?? [];
      if (type === 'crud') job.crud = config.lists?.crud ?? [];
      jobs.push(job);
    }
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return {
    projectRoot: root,
    projectName: info.name,
    framework: info.framework,
    resultsFile: path.resolve(root, config.results?.file ?? 'qagent-results.xlsx'),
    fallbackDir: path.join(root, '.qagent', 'results', stamp),
    jobs,
    logins,
    lowLogins,
    blockedEndpoints: config.blockedEndpoints ?? [],
    readOnlyAllow: config.readOnlyAllow ?? [],
    budgets: { ...DEFAULT_BUDGETS, ...config.budgets },
    readiness: { ...DEFAULT_READINESS, ...config.readiness },
    visual: { threshold: config.visual?.threshold ?? 0.005, mask: config.visual?.mask ?? [], dir: path.join(root, '.qagent', 'baselines') },
    workers: config.workers ?? 3,
    runBy: gitUser(root),
    device: os.hostname(),
    browser: { ...findBrowser(), headless: choices.headless ?? true },
  };
};
