import fs from 'fs';
import path from 'path';
import type { RouteInfo } from '../../shared/types';
import type { Adapter } from '../types';
import { readDotEnv, rel } from '../common';

const join = (...parts: string[]) => '/' + parts.join('/').split('/').filter(Boolean).join('/');
// {id} → :id; {id?} → optional, left out of the URL
const toPath = (uri: string) => uri.replace(/\/?\{(\w+)\?\}/g, '').replace(/\{(\w+)\}/g, ':$1');

/**
 * routes/web.php: Route::get / ::view / ::match / ::any, Route::resource, and
 * Route::prefix('x')->group(…) nesting. Controllers and views are mapped to files.
 */
export const laravelRoutes = (root: string): RouteInfo[] => {
  const file = path.join(root, 'routes', 'web.php');
  if (!fs.existsSync(file)) return [];
  const src = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const found = new Map<string, RouteInfo>();
  const fileFor = (rest: string) => {
    const ctrl = /([A-Z]\w*Controller)::class/.exec(rest)?.[1] ?? /['"]([A-Z]\w*Controller)@/.exec(rest)?.[1];
    if (ctrl) {
      const f = path.join(root, 'app', 'Http', 'Controllers', `${ctrl}.php`);
      return fs.existsSync(f) ? rel(root, f) : undefined;
    }
    const view = /^\s*,\s*['"]([\w.-]+)['"]/.exec(rest)?.[1];
    if (view) {
      const f = path.join(root, 'resources', 'views', `${view.replace(/\./g, '/')}.blade.php`);
      return fs.existsSync(f) ? rel(root, f) : undefined;
    }
    return undefined;
  };
  const add = (p: string, f?: string) => {
    if (!found.has(p)) found.set(p, { path: p, file: f, params: [...p.matchAll(/:(\w+)/g)].map((m) => m[1]), source: 'router' });
  };

  // Walk the file once, tracking which prefix groups are open by brace depth
  const prefixes: { prefix: string; depth: number }[] = [];
  let depth = 0;
  const token = /Route::prefix\(\s*['"]([^'"]*)['"]\s*\)[^;{]*?->group\(\s*function\s*\([^)]*\)\s*(?:use\s*\([^)]*\)\s*)?\{|Route::(get|view|match|any)\(\s*(?:\[[^\]]*\]\s*,\s*)?['"]([^'"]*)['"]([^;]*);|Route::resource\(\s*['"]([^'"]+)['"]([^;]*);|\{|\}/g;
  for (const m of src.matchAll(token)) {
    const prefix = prefixes.map((x) => x.prefix);
    if (m[1] !== undefined) {
      depth++;
      prefixes.push({ prefix: m[1], depth });
    } else if (m[0] === '{') depth++;
    else if (m[0] === '}') {
      if (prefixes.length && prefixes[prefixes.length - 1].depth === depth) prefixes.pop();
      depth--;
    } else if (m[2]) {
      // A POST-only match() is not a page
      if (m[2] === 'match' && !/['"]get['"]/i.test(m[0])) continue;
      add(join(...prefix, toPath(m[3])), fileFor(m[4]));
    } else if (m[5]) {
      // resource('photos'): index, create, show, edit (GET routes only)
      const name = m[5];
      const param = name.split('.').pop()!.replace(/s$/, '');
      const f = fileFor(m[6]);
      const only = /only\(\s*\[([^\]]*)\]/.exec(m[6])?.[1];
      const except = /except\(\s*\[([^\]]*)\]/.exec(m[6])?.[1];
      const keep = (a: string) => (!only || only.includes(`'${a}'`) || only.includes(`"${a}"`)) && !except?.includes(a);
      const base = join(...prefix, name.replace(/\./g, '/'));
      if (keep('index')) add(base, f);
      if (keep('create')) add(`${base}/create`, f);
      if (keep('show')) add(`${base}/:${param}`, f);
      if (keep('edit')) add(`${base}/:${param}/edit`, f);
    }
  }
  return [...found.values()].sort((a, b) => a.path.localeCompare(b.path));
};

export const laravel: Adapter = {
  id: 'laravel',
  label: 'PHP / Laravel',
  detect: (root) => fs.existsSync(path.join(root, 'artisan')) && fs.existsSync(path.join(root, 'composer.json')),
  startCommand: () => ({ command: 'php artisan serve', url: 'http://127.0.0.1:8000' }),
  environments(root) {
    const url = readDotEnv(path.join(root, '.env')).APP_URL;
    return /^https?:\/\//.test(url ?? '') ? { local: { url: url!.replace(/\/+$/, ''), from: '.env' } } : {};
  },
  routes: laravelRoutes,
};
