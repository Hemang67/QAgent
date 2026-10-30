import fs from 'fs';
import path from 'path';
import type { EnvName } from '../../shared/types';
import type { Adapter, DetectedEnv } from '../types';
import { readJson } from '../common';
import { codeRoutes } from '../react-router';

// environment.ts → Local, environment.development.ts → Dev, …staging/test/qa → Test, …prod → Live
const ENV_FILE: [RegExp, EnvName][] = [
  [/^environment\.ts$/, 'local'],
  [/^environment\.(development|dev)\.ts$/, 'dev'],
  [/^environment\.(staging|test|qa|uat)\.ts$/, 'test'],
  [/^environment\.(production|prod)\.ts$/, 'live'],
];

/** URLs in src/environments/*.ts: a key named like an API is the API, another *Url is the site. */
export const angularEnvironments = (root: string) => {
  const dir = path.join(root, 'src', 'environments');
  const out: Partial<Record<EnvName, DetectedEnv>> = {};
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir)) {
    const env = ENV_FILE.find(([re]) => re.test(f))?.[1];
    if (!env) continue;
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    const e: DetectedEnv = {};
    for (const m of text.matchAll(/(\w+)\s*:\s*['"`](https?:\/\/[^'"`]+)['"`]/g)) {
      if (/api|backend|server/i.test(m[1])) e.apiUrl ??= new URL(m[2]).origin;
      else if (/url|site|base|app|host/i.test(m[1])) e.url ??= m[2].replace(/\/+$/, '');
    }
    if (e.url || e.apiUrl) out[env] = { ...e, from: `src/environments/${f}` };
  }
  return out;
};

export const angular: Adapter = {
  id: 'angular',
  label: 'Angular',
  detect: (root) => fs.existsSync(path.join(root, 'angular.json')),
  startCommand(root) {
    const ng = readJson(path.join(root, 'angular.json'));
    const project = ng && Object.values<any>(ng.projects ?? {})[0];
    const port = project?.architect?.serve?.options?.port ?? 4200;
    return { command: 'npm start', url: `http://localhost:${port}` };
  },
  environments: angularEnvironments,
  // Routes arrays in routing modules and app.routes.ts, including loadChildren prefixes
  routes: (root) => codeRoutes(root),
};
