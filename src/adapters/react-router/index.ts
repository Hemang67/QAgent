import fs from 'fs';
import path from 'path';
import type { RouteInfo } from '../../shared/types';
import type { Adapter } from '../types';
import { devScript, envUrlsFromDotEnv, hasDependency, listFiles, npmRun, packageJson, parseFile, portFromDotEnv, rel, walk } from '../common';
import { collectConstants, dynamicImportIn, evalString, importsOf, makeResolver } from '../resolve';

// Route-object keys of React Router, Vue Router and Angular
const ROUTE_KEYS = new Set(['element', 'Component', 'component', 'components', 'lazy', 'children', 'loader', 'errorElement', 'loadComponent', 'loadChildren']);
// Folders whose components are pages rather than wrappers (guards, layouts)
const PAGE_DIR = /[\\/](pages|views|screens|routes|features|modules)[\\/]/i;
// Query parameters that carry a record ID; others (?tab=, ?page=) are optional
const ID_PARAM = /(^id$|Id$|_id$|ID$)/;

const propsOf = (obj: any) => {
  const m = new Map<string, any>();
  for (const p of obj.properties) {
    if (p.type !== 'ObjectProperty' && p.type !== 'ObjectMethod') continue;
    const key = p.key.type === 'Identifier' ? p.key.name : p.key.type === 'StringLiteral' ? p.key.value : null;
    if (key) m.set(key, p.type === 'ObjectMethod' ? p : p.value);
  }
  return m;
};

const jsxName = (n: any): string | null => {
  const name = n.openingElement?.name;
  if (!name) return null;
  if (name.type === 'JSXIdentifier') return name.name;
  if (name.type === 'JSXMemberExpression') return `${jsxName({ openingElement: { name: name.object } })}.${name.property.name}`;
  return null;
};

const joinPath = (parent: string, child: string) => {
  if (child.startsWith('/')) return child;
  return `${parent.replace(/\/+$/, '')}/${child}`.replace(/\/{2,}/g, '/');
};

const normalise = (p: string) => {
  const s = ('/' + p).replace(/\/{2,}/g, '/');
  return s.length > 1 ? s.replace(/\/+$/, '') : s;
};

export const reactRouter: Adapter = {
  id: 'react-router',
  label: 'React + React Router',

  detect: (root) => hasDependency(root, 'react-router-dom') || hasDependency(root, 'react-router'),

  startCommand(root) {
    const script = devScript(root);
    if (!script) return null;
    const pkg = packageJson(root);
    const vite = !!(pkg?.devDependencies?.vite || pkg?.dependencies?.vite);
    const port = portFromDotEnv(root) ?? vitePort(root) ?? (vite ? 5173 : 3000);
    return { command: npmRun(script), url: `http://localhost:${port}` };
  },

  environments: (root) => envUrlsFromDotEnv(root),

  routes: (root) => codeRoutes(root),
};

/**
 * Pages declared in code: route objects ({ path, element | component | loadComponent, children })
 * as React Router, Vue Router and Angular write them, and <Route> JSX. Lazy child route
 * files (Angular loadChildren) inherit the path of the route that loads them.
 */
export const codeRoutes = (root: string): RouteInfo[] => {
  {
    const srcDir = fs.existsSync(path.join(root, 'src')) ? path.join(root, 'src') : root;
    const asts = new Map<string, any>();
    for (const f of listFiles(srcDir)) {
      const ast = parseFile(f);
      if (ast) asts.set(f, ast);
    }
    const consts = collectConstants(asts);
    const resolve = makeResolver(root);
    let found = new Map<string, RouteInfo>();
    // File of lazily loaded child routes → path of the route that loads them
    let prefixes = new Map<string, string>();

    const pageFile = (expr: any, file: string, imports: Map<string, string>): string | undefined => {
      if (!expr) return undefined;
      const lazy = dynamicImportIn(expr);
      if (lazy) {
        const f = resolve(lazy, file);
        if (f) return f;
      }
      if (expr.type === 'Identifier') return imports.get(expr.name);
      // <Guard><Page/></Guard> or <Guard element={<Page/>}/>: prefer a component from a pages folder
      const hits: string[] = [];
      walk(expr, (n) => {
        if (n.type === 'JSXElement') {
          const t = imports.get(jsxName(n)?.split('.')[0] ?? '');
          if (t) hits.push(t);
        }
      });
      return hits.reverse().find((h) => PAGE_DIR.test(h)) ?? hits[0];
    };

    const add = (routePath: string, file: string | undefined) => {
      const p = normalise(routePath);
      if (p.includes('*')) return; // catch-all / 404 routes
      const existing = found.get(p);
      if (existing) {
        if (!existing.file && file) existing.file = file;
        return;
      }
      found.set(p, { path: p, file, params: [], source: 'router' });
    };

    const parse = () => {
    const next = new Map<string, string>();
    for (const [file, ast] of asts) {
      const imports = importsOf(ast, file, resolve);
      const fileBase = prefixes.get(path.resolve(file)) ?? '/';

      // Object routes: createBrowserRouter([...]), useRoutes([...]), plain route arrays
      const routeObjects = new Map<any, { own: string | null; index: boolean; props: Map<string, any> }>();
      walk(ast, (n) => {
        if (n.type !== 'ObjectExpression') return;
        const props = propsOf(n);
        const hasPath = props.has('path');
        const index = props.get('index')?.value === true;
        if (!hasPath && !index && !props.has('children')) return;
        if (![...props.keys()].some((k) => ROUTE_KEYS.has(k))) return;
        routeObjects.set(n, { own: hasPath ? evalString(props.get('path'), consts) : null, index, props });
      });
      // Full path = parent route's full path + own path, through `children` arrays
      const fullPath = new Map<any, string | null>();
      walk(ast, (n, parents) => {
        const info = routeObjects.get(n);
        if (!info) return;
        const parent = [...parents].reverse().find((p) => routeObjects.has(p));
        const base = parent ? fullPath.get(parent) ?? null : fileBase;
        if (base === null || (info.own === null && info.props.has('path'))) {
          fullPath.set(n, null); // unresolvable path expression
          return;
        }
        const full = info.own === null ? base : joinPath(base, info.own);
        fullPath.set(n, full);
        const lazyChildren = info.props.get('loadChildren');
        const childSpec = lazyChildren ? dynamicImportIn(lazyChildren) : null;
        const childFile = childSpec ? resolve(childSpec, file) : null;
        if (childFile) next.set(path.resolve(childFile), full);
        const target = info.props.get('element') ?? info.props.get('Component') ?? info.props.get('component') ?? info.props.get('loadComponent') ?? info.props.get('lazy');
        // Pathless layout routes and pure redirects are not pages
        if (info.own === null && !info.index) return;
        if (!target && info.props.has('children')) return;
        if (!target && !info.index) return;
        add(full, pageFile(target, file, imports));
      });

      // JSX routes: <Route path="…" element={…}/> nested inside other <Route>s
      const jsxPaths = new Map<any, string | null>();
      walk(ast, (n, parents) => {
        if (n.type !== 'JSXElement' || jsxName(n) !== 'Route') return;
        const attrs = new Map<string, any>();
        for (const a of n.openingElement.attributes) {
          if (a.type === 'JSXAttribute') attrs.set(a.name.name, a.value ?? { type: 'BooleanLiteral', value: true });
        }
        const parent = [...parents].reverse().find((p) => p.type === 'JSXElement' && jsxName(p) === 'Route');
        const base = parent ? jsxPaths.get(parent) ?? null : '/';
        const own = attrs.has('path') ? evalString(attrs.get('path'), consts) : null;
        if (base === null || (attrs.has('path') && own === null)) {
          jsxPaths.set(n, null);
          return;
        }
        const full = own === null ? base : joinPath(base, own);
        jsxPaths.set(n, full);
        const target = attrs.get('element') ?? attrs.get('component') ?? attrs.get('Component');
        const indexRoute = attrs.has('index');
        if ((own === null && !indexRoute) || !target) return;
        const expr = target.type === 'JSXExpressionContainer' ? target.expression : target;
        add(full, pageFile(expr, file, imports));
      });
    }
    return next;
    };

    // Lazy route files learn their prefix from the file that loads them: repeat until stable
    for (let i = 0; i < 5; i++) {
      const next = parse();
      if ([...next].every(([k, v]) => prefixes.get(k) === v) && next.size === prefixes.size) break;
      prefixes = next;
      found = new Map();
    }

    for (const r of found.values()) {
      r.params = [...r.path.matchAll(/:([A-Za-z0-9_]+)\??/g)].map((m) => m[1]);
      if (r.file) {
        r.params.push(...queryIdParams(r.file).map((q) => `?${q}`));
        r.file = rel(root, r.file);
      }
    }
    return [...found.values()].sort((a, b) => a.path.localeCompare(b.path));
  }
};

/** Query parameters that look like record IDs, read with searchParams.get('…') or similar. */
export const queryIdParams = (file: string): string[] => {
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const names = new Set<string>();
  for (const m of text.matchAll(/(?:searchParams|params|query|urlParams|search)\??\.get\(\s*['"`]([\w-]+)['"`]\s*\)/gi)) {
    if (ID_PARAM.test(m[1])) names.add(m[1]);
  }
  return [...names];
};

const vitePort = (root: string): number | null => {
  for (const f of ['vite.config.ts', 'vite.config.js', 'vite.config.mjs']) {
    try {
      const m = /port\s*:\s*(\d{2,5})/.exec(fs.readFileSync(path.join(root, f), 'utf8'));
      if (m) return Number(m[1]);
    } catch {
      // no such config
    }
  }
  return null;
};
