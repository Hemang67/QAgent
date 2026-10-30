import fs from 'fs';
import path from 'path';
import type { RouteInfo } from '../../shared/types';
import type { Adapter } from '../types';
import { envUrlsFromDotEnv, listFiles, rel } from '../common';

const join = (...parts: string[]) => '/' + parts.join('/').split('/').filter(Boolean).join('/');
const params = (p: string) => [...p.matchAll(/:(\w+)/g)].map((m) => m[1]);
// Django <int:pk> / <slug>, Flask <int:id> / <name>, FastAPI {id} → :name
const toPath = (p: string) => p.replace(/<(?:\w+:)?(\w+)>/g, ':$1').replace(/\{(\w+)(:[^}]*)?\}/g, ':$1');
const read = (f: string) => fs.readFileSync(f, 'utf8');
const pyFiles = (root: string) => listFiles(root, ['.py']).filter((f) => !/[\\/](venv|\.venv|env|site-packages|migrations|tests?)[\\/]/.test(f));

const kind = (root: string) => {
  if (fs.existsSync(path.join(root, 'manage.py'))) return 'django';
  const deps = ['requirements.txt', 'pyproject.toml', 'Pipfile'].map((f) => (fs.existsSync(path.join(root, f)) ? read(path.join(root, f)) : '')).join('\n').toLowerCase();
  if (/\bflask\b/.test(deps)) return 'flask';
  if (/\bfastapi\b/.test(deps)) return 'fastapi';
  return null;
};

/** Django: path('orders/<int:pk>/', views.detail) in urls.py files, following include('app.urls'). */
const djangoRoutes = (root: string): RouteInfo[] => {
  const settings = pyFiles(root).find((f) => path.basename(f) === 'settings.py' && /ROOT_URLCONF/.test(read(f)));
  const rootConf = settings ? /ROOT_URLCONF\s*=\s*['"]([\w.]+)['"]/.exec(read(settings))?.[1] : null;
  const moduleFile = (mod: string) => {
    const f = path.join(root, ...mod.split('.')) + '.py';
    return fs.existsSync(f) ? f : null;
  };
  const start = rootConf ? moduleFile(rootConf) : pyFiles(root).find((f) => path.basename(f) === 'urls.py');
  const found = new Map<string, RouteInfo>();
  const visit = (file: string, prefix: string, seen: Set<string>) => {
    if (seen.has(file)) return;
    seen.add(file);
    const text = read(file);
    const viewsFile = path.join(path.dirname(file), 'views.py');
    for (const m of text.matchAll(/\b(path|re_path)\(\s*r?['"]([^'"]*)['"]\s*,\s*([^,)]+(?:\([^)]*\))?)/g)) {
      const [, fn, raw, target] = m;
      if (fn === 're_path' && /[[(*+?\\]/.test(raw.replace(/^\^|\$$/g, ''))) continue; // real regexes cannot be turned into a URL
      const route = join(prefix, toPath(raw.replace(/^\^|\$$/g, '')));
      const inc = /include\(\s*['"]([\w.]+)['"]/.exec(target)?.[1];
      if (inc) {
        const f = moduleFile(inc);
        if (f) visit(f, route, seen);
        continue;
      }
      if (/admin\.site\.urls/.test(target)) continue;
      if (!found.has(route)) found.set(route, { path: route, file: fs.existsSync(viewsFile) ? rel(root, viewsFile) : rel(root, file), params: params(route), source: 'router' });
    }
  };
  if (start) visit(start, '/', new Set());
  return [...found.values()];
};

/** Flask: @app.route / @bp.route / @app.get, with Blueprint url_prefix. GET routes only. */
const flaskRoutes = (root: string): RouteInfo[] => {
  const found = new Map<string, RouteInfo>();
  const files = pyFiles(root);
  // Blueprint variable → prefix, from Blueprint(..., url_prefix=) or register_blueprint(bp, url_prefix=)
  const prefixes = new Map<string, string>();
  for (const f of files) {
    const text = read(f);
    for (const m of text.matchAll(/(\w+)\s*=\s*Blueprint\(([^)]*)\)/g)) {
      const p = /url_prefix\s*=\s*['"]([^'"]*)['"]/.exec(m[2])?.[1];
      if (p) prefixes.set(m[1], p);
    }
    for (const m of text.matchAll(/register_blueprint\(\s*(?:\w+\.)?(\w+)\s*,[^)]*url_prefix\s*=\s*['"]([^'"]*)['"]/g)) prefixes.set(m[1], m[2]);
  }
  for (const f of files) {
    const text = read(f);
    for (const m of text.matchAll(/@(\w+)\.(route|get)\(\s*['"]([^'"]*)['"]([^)]*)\)/g)) {
      const [, obj, verb, raw, rest] = m;
      if (verb === 'route' && /methods\s*=/.test(rest) && !/['"]GET['"]/i.test(rest)) continue;
      const route = join(prefixes.get(obj) ?? '', toPath(raw));
      if (!found.has(route)) found.set(route, { path: route, file: rel(root, f), params: params(route), source: 'router' });
    }
  }
  return [...found.values()];
};

/** FastAPI: GET routes that render HTML (HTMLResponse or a template); JSON APIs are not pages. */
const fastapiRoutes = (root: string): RouteInfo[] => {
  const found = new Map<string, RouteInfo>();
  for (const f of pyFiles(root)) {
    const text = read(f);
    const prefixes = new Map<string, string>();
    for (const m of text.matchAll(/(\w+)\s*=\s*APIRouter\(([^)]*)\)/g)) prefixes.set(m[1], /prefix\s*=\s*['"]([^'"]*)['"]/.exec(m[2])?.[1] ?? '');
    const decos = [...text.matchAll(/@(\w+)\.get\(\s*['"]([^'"]*)['"]([^)]*)\)\s*\n\s*(?:async\s+)?def\s+\w+[^]*?(?=\n@|\n(?:async\s+)?def\s|$)/g)];
    for (const m of decos) {
      const [body, obj, raw, rest] = m;
      if (!/HTMLResponse|TemplateResponse|templates\./.test(rest + body)) continue;
      const route = join(prefixes.get(obj) ?? '', toPath(raw));
      if (!found.has(route)) found.set(route, { path: route, file: rel(root, f), params: params(route), source: 'router' });
    }
  }
  return [...found.values()];
};

export const python: Adapter = {
  id: 'python',
  label: 'Python (Django, Flask, FastAPI)',
  detect: (root) => kind(root) !== null,
  startCommand(root) {
    const k = kind(root);
    if (k === 'django') return { command: 'python manage.py runserver', url: 'http://127.0.0.1:8000' };
    if (k === 'flask') return { command: 'flask run', url: 'http://127.0.0.1:5000' };
    const app = pyFiles(root).find((f) => /FastAPI\(/.test(read(f)));
    const mod = app ? rel(root, app).replace(/\.py$/, '').replace(/\//g, '.') : 'main';
    return { command: `uvicorn ${mod}:app`, url: 'http://127.0.0.1:8000' };
  },
  environments: (root) => envUrlsFromDotEnv(root),
  routes(root) {
    const k = kind(root);
    const routes = k === 'django' ? djangoRoutes(root) : k === 'flask' ? flaskRoutes(root) : k === 'fastapi' ? fastapiRoutes(root) : [];
    return routes.sort((a, b) => a.path.localeCompare(b.path));
  },
};
