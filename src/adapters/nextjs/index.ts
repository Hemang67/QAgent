import fs from 'fs';
import path from 'path';
import type { RouteInfo } from '../../shared/types';
import type { Adapter } from '../types';
import { devScript, envUrlsFromDotEnv, hasDependency, listFiles, npmRun, packageJson, portFromDotEnv, rel } from '../common';
import { queryIdParams } from '../react-router';

const PAGE_EXT = ['.js', '.jsx', '.ts', '.tsx', '.mdx'];

/** `[id]` → `:id`, `[...slug]` → `:slug`, `[[...slug]]` → '' (it matches the parent path too). */
const dynamicSegment = (s: string): string => {
  if (/^\[\[\.\.\.\w+\]\]$/.test(s)) return '';
  const m = /^\[(?:\.\.\.)?(\w+)\]$/.exec(s);
  return m ? `:${m[1]}` : s;
};

/** App router segment; null for folders that are not part of the URL. */
const segment = (s: string): string | null => {
  if (/^\(.*\)$/.test(s)) return null; // (group)
  if (s.startsWith('@')) return null; // @parallel slot
  if (s.startsWith('_')) return null; // _private folder
  return dynamicSegment(s);
};

const toRoute = (segments: string[]) => {
  const parts = segments.map(segment).filter((s): s is string => s !== null && s !== '');
  return '/' + parts.join('/');
};

const firstDir = (root: string, names: string[]) => names.map((n) => path.join(root, n)).find((d) => fs.existsSync(d));

export const nextjs: Adapter = {
  id: 'nextjs',
  label: 'Next.js',

  detect: (root) => hasDependency(root, 'next'),

  startCommand(root) {
    const script = devScript(root) ?? 'dev';
    const devCmd: string = packageJson(root)?.scripts?.[script] || '';
    const port = Number(/(?:-p|--port)[\s=](\d+)/.exec(devCmd)?.[1]) || portFromDotEnv(root) || 3000;
    return { command: npmRun(script), url: `http://localhost:${port}` };
  },

  environments: (root) => envUrlsFromDotEnv(root),

  routes(root) {
    const found = new Map<string, RouteInfo>();
    const add = (p: string, file: string) => {
      if (found.has(p)) return;
      const params = [...p.matchAll(/:(\w+)/g)].map((m) => m[1]);
      params.push(...queryIdParams(file).map((q) => `?${q}`));
      found.set(p, { path: p, file: rel(root, file), params, source: 'filesystem' });
    };

    const appDir = firstDir(root, ['app', 'src/app']);
    if (appDir) {
      for (const f of listFiles(appDir, PAGE_EXT)) {
        if (!/^page\.\w+$/.test(path.basename(f))) continue;
        const segs = path.relative(appDir, path.dirname(f)).split(path.sep).filter(Boolean);
        add(toRoute(segs), f);
      }
    }

    const pagesDir = firstDir(root, ['pages', 'src/pages']);
    if (pagesDir) {
      for (const f of listFiles(pagesDir, PAGE_EXT)) {
        const relPath = path.relative(pagesDir, f).replace(/\\/g, '/');
        if (relPath.startsWith('api/') || /^_(app|document|error)\./.test(relPath) || /^(404|500)\./.test(relPath)) continue;
        const segs = relPath.replace(/\.\w+$/, '').split('/');
        if (segs[segs.length - 1] === 'index') segs.pop();
        // The pages router has no groups or private folders: only dynamic segments change
        add('/' + segs.map(dynamicSegment).filter(Boolean).join('/'), f);
      }
    }
    return [...found.values()].sort((a, b) => a.path.localeCompare(b.path));
  },
};
