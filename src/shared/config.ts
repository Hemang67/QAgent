import fs from 'fs';
import path from 'path';
import type { Budgets, CrudDef, EnvName, FlowDef, Readiness } from './types';

export const CONFIG_FILE = '.qagent.json';

export interface EnvConfig {
  url: string;
  /** API origin when it differs from the site, e.g. https://api.example.com */
  apiUrl?: string;
}

export interface PageConfig {
  /** Path parameter → key in .qagent/test-data.<env>.json */
  params?: Record<string, string>;
  skip?: string;
}

export interface QAgentConfig {
  framework?: string;
  local?: { start?: string; url?: string; apiUrl?: string };
  environments?: Partial<Record<Exclude<EnvName, 'local'>, EnvConfig>>;
  login?: { path?: string; loggedInPath?: string; logoutPath?: string; accountSelector?: string };
  lists?: { smoke?: string[]; criticalFlows?: FlowDef[]; crud?: CrudDef[] };
  visual?: { threshold?: number; mask?: string[] };
  /** Change-impact: branch to compare with (default origin/development, then origin/main) */
  baseBranch?: string;
  pages?: Record<string, PageConfig>;
  /** "auto": adapter routes, crawl when none found. "crawl": always crawl */
  discovery?: 'auto' | 'crawl';
  crawlLimit?: number;
  blockedEndpoints?: string[];
  readOnlyAllow?: string[];
  budgets?: Partial<Budgets>;
  readiness?: Partial<Pick<Readiness, 'contentSelector' | 'loaderSelector' | 'quietWindowMs' | 'readyTimeoutMs' | 'maxTabDepth'>>;
  workers?: number;
  results?: { file?: string };
}

export const DEFAULT_BUDGETS: Budgets = { readyWarnMs: 5000, readyFailMs: 15000, apiWarnMs: 3000, lcpWarnMs: 4000 };

// Common page containers and loaders across UI libraries. Projects can override both.
export const DEFAULT_READINESS: Readiness = {
  contentSelector: 'main, [role="main"], #root, #app, #__next, body',
  loaderSelector: [
    '[aria-busy="true"]',
    '[role="progressbar"]:not([aria-valuenow])',
    '.spinner',
    '.spinner-border',
    '.spinner-grow',
    '.loader',
    '.loading',
    '.skeleton',
    '.placeholder-glow',
    '.MuiCircularProgress-root',
    '.MuiSkeleton-root',
    '.ant-spin-spinning',
    '.chakra-spinner',
    '.v-progress-circular',
    'mat-spinner',
    'mat-progress-spinner',
  ].join(', '),
  quietWindowMs: 750,
  readyTimeoutMs: 30000,
  maxTabDepth: 3,
};

// Name fragments of endpoints that usually reach outside the app
export const SIDE_EFFECT_WORDS = ['send', 'email', 'sms', 'notify', 'book', 'tender', 'ship', 'void', 'cancel', 'charge', 'pay', 'refund', 'invoice', 'label'];

export const readConfig = (root: string): QAgentConfig | null => {
  const file = path.join(root, CONFIG_FILE);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`${CONFIG_FILE} is not valid JSON: ${(e as Error).message}`);
  }
};

// The schema is attached by the extension's jsonValidation contribution, so no $schema key
export const writeConfig = (root: string, config: QAgentConfig) => {
  fs.writeFileSync(path.join(root, CONFIG_FILE), JSON.stringify(config, null, 2) + '\n', 'utf8');
};

/** Record IDs per environment, kept on each developer's machine. */
export const readTestData = (root: string, env: EnvName): Record<string, string | number | null> => {
  const file = path.join(root, '.qagent', `test-data.${env}.json`);
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
};
