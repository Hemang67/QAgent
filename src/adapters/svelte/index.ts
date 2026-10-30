import fs from 'fs';
import path from 'path';
import type { RouteInfo } from '../../shared/types';
import type { Adapter } from '../types';
import { devScript, envUrlsFromDotEnv, hasDependency, listFiles, npmRun, portFromDotEnv, rel } from '../common';

/** SvelteKit src/routes: a folder with +page.svelte is a page; [id] → :id, (group) folders are not in the URL. */
export const svelteKitRoutes = (root: string): RouteInfo[] => {
  const dir = path.join(root, 'src', 'routes');
  if (!fs.existsSync(dir)) return [];
  const found: RouteInfo[] = [];
  for (const f of listFiles(dir, ['.svelte'])) {
    if (path.basename(f) !== '+page.svelte') continue;
    const segs = path.relative(dir, path.dirname(f)).split(path.sep).filter(Boolean);
    if (segs.some((s) => s.startsWith('[...'))) continue; // rest parameters: catch-all pages
    const parts = segs.filter((s) => !/^\(.*\)$/.test(s)).map((s) => s.replace(/^\[\[(\w+)(=\w+)?\]\]$/, ':$1?').replace(/^\[(\w+)(=\w+)?\]$/, ':$1'));
    const p = '/' + parts.join('/');
    const params = parts.filter((s) => s.startsWith(':') && !s.endsWith('?')).map((s) => s.slice(1));
    found.push({ path: p, file: rel(root, f), params, source: 'filesystem' });
  }
  return found.sort((a, b) => a.path.localeCompare(b.path));
};

export const svelte: Adapter = {
  id: 'svelte',
  label: 'SvelteKit',
  detect: (root) => hasDependency(root, '@sveltejs/kit'),
  startCommand(root) {
    const script = devScript(root);
    return script ? { command: npmRun(script), url: `http://localhost:${portFromDotEnv(root) ?? 5173}` } : null;
  },
  environments: (root) => envUrlsFromDotEnv(root),
  routes: svelteKitRoutes,
};
