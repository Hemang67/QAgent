import fs from 'fs';
import path from 'path';
import { parse } from '@babel/parser';
import type { EnvName } from '../shared/types';
import type { DetectedEnv } from './types';

// Build output and installed dependencies of every supported ecosystem
const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', '.output', '.svelte-kit', '.angular', 'coverage', '.qagent', 'vendor', 'bin', 'obj', 'venv', '.venv', '.deps', '__pycache__', 'site-packages', 'release']);
export const CODE_EXT = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'];

export const readJson = (file: string): any => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

export const packageJson = (root: string) => readJson(path.join(root, 'package.json'));

export const hasDependency = (root: string, name: string) => {
  const pkg = packageJson(root);
  return !!(pkg?.dependencies?.[name] || pkg?.devDependencies?.[name]);
};

/** All files under `dir` with one of `exts`, skipping build output and dependencies. */
export const listFiles = (dir: string, exts = CODE_EXT): string[] => {
  const out: string[] = [];
  const walk = (d: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!IGNORED_DIRS.has(e.name)) walk(path.join(d, e.name));
      } else if (exts.includes(path.extname(e.name))) {
        out.push(path.join(d, e.name));
      }
    }
  };
  walk(dir);
  return out;
};

export const rel = (root: string, file: string) => path.relative(root, file).replace(/\\/g, '/');

/** Parses JS/TS/JSX; returns null for files Babel cannot read. */
export const parseFile = (file: string) => {
  try {
    const code = fs.readFileSync(file, 'utf8');
    const ts = /\.tsx?$/.test(file);
    return parse(code, {
      sourceType: 'unambiguous',
      errorRecovery: true,
      plugins: [ts ? 'typescript' : 'flow', 'jsx', 'decorators-legacy', 'importAttributes'] as any,
    });
  } catch {
    return null;
  }
};

/** Depth-first walk over every AST node; `visit` gets the node and its ancestors. */
export const walk = (node: any, visit: (n: any, parents: any[]) => void, parents: any[] = []) => {
  if (!node || typeof node.type !== 'string') return;
  visit(node, parents);
  const next = [...parents, node];
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'start' || key === 'end' || key === 'extra' || key.endsWith('Comments')) continue;
    const v = node[key];
    if (Array.isArray(v)) for (const c of v) walk(c, visit, next);
    else if (v && typeof v.type === 'string') walk(v, visit, next);
  }
};

/** Parses KEY=value lines, tolerating `KEY = "value";` as some projects write it. */
export const readDotEnv = (file: string): Record<string, string> => {
  const vars: Record<string, string> = {};
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return vars;
  }
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    vars[m[1]] = m[2].trim().replace(/;$/, '').trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return vars;
};

// .env file name → environment. `.env.development` usually points at the Dev server
// (local runs use `.env.local`); setup lets the user correct this.
const ENV_FILES: [RegExp, EnvName][] = [
  [/^\.env(\.local)?$/, 'local'],
  [/^\.env\.(development|dev)(\.local)?$/, 'dev'],
  [/^\.env\.(test|qa|staging|stage|uat)(\.local)?$/, 'test'],
  [/^\.env\.(production|prod|live)(\.local)?$/, 'live'],
];

const isUrl = (v: string) => /^https?:\/\/[^\s]+$/i.test(v);
const API_NAME = /API|BACKEND|SERVER|GRAPHQL/i;
const NOT_SITE = /SIGNALR|SOCKET|WS_|_WS|CDN|ASSET|IMAGE|STORAGE|AUTH|SENTRY|ANALYTICS|MAP/i;
const SITE_NAME = /(BASE|APP|SITE|PUBLIC|FRONTEND|WEB|CLIENT|HOST)_?URL$|^(NEXT_PUBLIC_|VITE_|REACT_APP_|NUXT_PUBLIC_)?URL$/i;

const trimUrl = (u: string) => u.replace(/\/+$/, '');
const origin = (u: string) => {
  try {
    return new URL(u).origin;
  } catch {
    return undefined;
  }
};

/**
 * Site and API URLs per environment from `.env.*` files. The site URL is a
 * *_URL variable that is not an API; the API URL is one named like an API.
 */
export const envUrlsFromDotEnv = (root: string): Partial<Record<EnvName, DetectedEnv>> => {
  const found: Partial<Record<EnvName, DetectedEnv>> = {};
  let files: string[] = [];
  try {
    files = fs.readdirSync(root).filter((f) => f.startsWith('.env') && !f.endsWith('.example') && !f.endsWith('.sample'));
  } catch {
    return found;
  }
  // Plain names first so `.env.development` wins over `.env.development.local`
  files.sort((a, b) => a.length - b.length);
  for (const f of files) {
    const env = ENV_FILES.find(([re]) => re.test(f))?.[1];
    if (!env) continue;
    const vars = readDotEnv(path.join(root, f));
    const entry = (found[env] ??= {});
    for (const [name, value] of Object.entries(vars)) {
      if (!isUrl(value)) continue;
      if (API_NAME.test(name)) {
        if (!entry.apiUrl) entry.apiUrl = origin(value);
      } else if (!NOT_SITE.test(name) && SITE_NAME.test(name)) {
        if (!entry.url) {
          entry.url = trimUrl(value);
          entry.from = f;
        }
      }
    }
    if (!entry.url && !entry.apiUrl) delete found[env];
  }
  return found;
};

/** `PORT=` in .env files, if set. */
export const portFromDotEnv = (root: string): number | null => {
  for (const f of ['.env.local', '.env', '.env.development']) {
    const p = Number(readDotEnv(path.join(root, f)).PORT);
    if (p) return p;
  }
  return null;
};

/** Script name in package.json to start the dev server: dev, then start, then serve. */
export const devScript = (root: string): string | null => {
  const scripts = packageJson(root)?.scripts || {};
  for (const s of ['dev', 'start', 'serve']) if (scripts[s]) return s;
  return null;
};

export const npmRun = (script: string) => (script === 'start' ? 'npm start' : `npm run ${script}`);
