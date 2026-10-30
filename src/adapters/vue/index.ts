import fs from 'fs';
import path from 'path';
import type { RouteInfo } from '../../shared/types';
import type { Adapter } from '../types';
import { devScript, envUrlsFromDotEnv, hasDependency, listFiles, npmRun, portFromDotEnv, rel } from '../common';
import { codeRoutes, queryIdParams } from '../react-router';

/** Nuxt `pages/`: index.vue → /, users/[id].vue → /users/:id, [...slug].vue → catch-all (left out). */
export const nuxtRoutes = (root: string): RouteInfo[] => {
  const dir = ['pages', 'app/pages', 'src/pages'].map((d) => path.join(root, d)).find((d) => fs.existsSync(d));
  if (!dir) return [];
  const found = new Map<string, RouteInfo>();
  for (const f of listFiles(dir, ['.vue'])) {
    const segs = path.relative(dir, f).replace(/\\/g, '/').replace(/\.vue$/, '').split('/');
    if (segs[segs.length - 1] === 'index') segs.pop();
    if (segs.some((s) => /^\[\.\.\./.test(s))) continue;
    const parts = segs
      .filter((s) => !/^\(.*\)$/.test(s)) // (group) folders
      .map((s) => s.replace(/^\[\[(\w+)\]\]$/, ':$1?').replace(/^\[(\w+)\]$/, ':$1'));
    const p = '/' + parts.join('/');
    if (found.has(p)) continue;
    const params = parts.filter((s) => s.startsWith(':') && !s.endsWith('?')).map((s) => s.slice(1));
    found.set(p, { path: p, file: rel(root, f), params: [...params, ...queryIdParams(f).map((q) => `?${q}`)], source: 'filesystem' });
  }
  return [...found.values()].sort((a, b) => a.path.localeCompare(b.path));
};

export const vue: Adapter = {
  id: 'vue',
  label: 'Vue (Vue Router or Nuxt)',
  detect: (root) => hasDependency(root, 'nuxt') || hasDependency(root, 'vue-router') || hasDependency(root, 'vue'),
  startCommand(root) {
    const script = devScript(root);
    if (!script) return null;
    const port = portFromDotEnv(root) ?? (hasDependency(root, 'nuxt') ? 3000 : 5173);
    return { command: npmRun(script), url: `http://localhost:${port}` };
  },
  environments: (root) => envUrlsFromDotEnv(root),
  // Nuxt builds routes from pages/; Vue Router declares them in code
  routes: (root) => (hasDependency(root, 'nuxt') ? nuxtRoutes(root) : codeRoutes(root)),
};
