import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { CODE_EXT, listFiles, parseFile, rel, walk } from '../adapters/common';
import { makeResolver } from '../adapters/resolve';
import type { RouteInfo } from '../shared/types';

const BASE_CANDIDATES = ['origin/development', 'origin/main', 'origin/master', 'development', 'main', 'master'];

// Changes here can affect every page
const GLOBAL_FILE = [
  /(^|\/)package(-lock)?\.json$|(^|\/)(yarn\.lock|pnpm-lock\.yaml)$/,
  /(^|\/)(tsconfig|jsconfig)\.json$|(^|\/)(vite|next|webpack|craco|nuxt|svelte|astro)\.config\.\w+$/,
  /(^|\/)\.env(\.[\w.]+)?$/,
  /(^|\/)src\/(App|app|main|index|root|Root)\.(t|j)sx?$/,
  /(^|\/)(pages\/_app|pages\/_document|app\/layout|src\/app\/layout)\.\w+$/,
  /(^|\/)(layouts?|Layouts?)\//,
  /(^|\/)(styles?|css|scss|theme)\//i,
  /(^|\/)(index|global|globals|app|main|styles)\.(css|scss|sass|less)$/,
  // Server frameworks: start-up, settings, dependencies and shared layouts
  /(^|\/)(Program|Startup)\.cs$|\.csproj$|(^|\/)appsettings(\.\w+)?\.json$|(^|\/)_(Layout|ViewStart|ViewImports)\.cshtml$/,
  /(^|\/)(settings|wsgi|asgi)\.py$|(^|\/)requirements[\w.-]*\.txt$|(^|\/)(pyproject\.toml|Pipfile)$|(^|\/)templates\/base\.html$/,
  /(^|\/)composer\.(json|lock)$|(^|\/)resources\/views\/(layouts|components)\//,
];
// Files QAgent cannot trace imports for yet: a change that is not a page's own file tests every page
const SERVER_EXT = ['.php', '.cs', '.cshtml', '.razor', '.py', '.html', '.htm', '.twig', '.jinja', '.jinja2', '.vue', '.svelte'];
const IGNORED = /(\.(test|spec|stories)\.\w+$)|(^|\/)(__tests__|__mocks__|e2e|cypress|test|tests|fixtures|docs?)\/|\.(md|mdx|txt|png|jpe?g|gif|svg|ico)$/i;
const ROUTER_DECL = /createBrowserRouter|createHashRouter|useRoutes\(|<Route[\s>]|<Routes[\s>]/;

const git = (cwd: string, args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }).trim();

export interface ImpactResult {
  base: string;
  /** Routes to test, or every page */
  routes: Set<string> | 'all';
  /** One line per changed file that selected pages, for the sheet */
  notes: string[];
  changedFiles: number;
}

/** First base branch that exists; the user's choice first. */
export const resolveBase = (root: string, preferred?: string) => {
  for (const b of [preferred, ...BASE_CANDIDATES].filter(Boolean) as string[]) {
    try {
      git(root, ['rev-parse', '--verify', '--quiet', `${b}^{commit}`]);
      return b;
    } catch {
      // try the next one
    }
  }
  throw new Error(`Base branch not found${preferred ? ` (${preferred})` : ''}: run git fetch, or choose another base branch`);
};

/** Names a diff adds as exports: `export const X`, `export function X`, `export { a, b }`. */
const addedExports = (addedLines: string[]) => {
  const names = new Set<string>();
  for (const l of addedLines) {
    const m = /^\s*export\s+(?:default\s+)?(?:async\s+)?(?:const|let|var|function\*?|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/.exec(l);
    if (m) names.add(m[1]);
    const list = /^\s*export\s*\{([^}]*)\}/.exec(l);
    if (list) for (const n of list[1].split(',')) names.add(n.trim().split(/\s+as\s+/).pop()!.trim());
    // A new key in an exported object (NavigationRoutes.newPage, apiEndPoints.newCall)
    const key = /^\s*([A-Za-z_$][\w$]*)\s*:\s*['"`]/.exec(l);
    if (key) names.add(key[1]);
  }
  return [...names].filter(Boolean);
};

/** Import graph of the project's code: file → files it imports. */
const importGraph = (root: string) => {
  const resolve = makeResolver(root);
  const srcDir = fs.existsSync(path.join(root, 'src')) ? path.join(root, 'src') : root;
  const dirs = [srcDir, ...['app', 'pages', 'components', 'lib'].map((d) => path.join(root, d)).filter((d) => d !== srcDir && fs.existsSync(d))];
  const imports = new Map<string, Set<string>>();
  for (const file of [...new Set(dirs.flatMap((d) => listFiles(d, CODE_EXT)))]) {
    const ast = parseFile(file);
    const out = new Set<string>();
    if (ast) {
      walk(ast, (n) => {
        let spec: string | null = null;
        if ((n.type === 'ImportDeclaration' || n.type === 'ExportNamedDeclaration' || n.type === 'ExportAllDeclaration') && n.source) spec = n.source.value;
        else if (n.type === 'ImportExpression' && n.source?.type === 'StringLiteral') spec = n.source.value;
        else if (n.type === 'CallExpression' && (n.callee.type === 'Import' || (n.callee.type === 'Identifier' && n.callee.name === 'require')) && n.arguments[0]?.type === 'StringLiteral') spec = n.arguments[0].value;
        if (spec) {
          const target = resolve(spec, file);
          if (target) out.add(path.resolve(target));
        }
      });
    }
    imports.set(path.resolve(file), out);
  }
  const importers = new Map<string, Set<string>>();
  for (const [file, deps] of imports) for (const d of deps) (importers.get(d) ?? importers.set(d, new Set()).get(d)!).add(file);
  return importers;
};

/**
 * Pages affected by git changes since the merge base with `base`: committed,
 * uncommitted and new files.
 *  - a page file → that page
 *  - the router file with only additions → only the new pages
 *  - a shared file that only gained exports → pages that use the new names
 *  - an edited shared file → every page that imports it, directly or not
 *  - app shell, layouts, global styles, package or build config → every page
 */
export interface GitChanges {
  /** The project folder as git sees it (real, long path) */
  root: string;
  base: string;
  mergeBase: string;
  /** Committed, uncommitted and new files; status A = added */
  changes: { status: string; abs: string }[];
}

/** Files changed since the merge base with the base branch: committed, uncommitted and new. */
export const gitChanges = (projectRoot: string, preferredBase?: string): GitChanges => {
  // git reports real, long paths; the project path may be a short (8.3) or symlinked form of the same folder
  const root = fs.realpathSync.native(projectRoot);
  const top = fs.realpathSync.native(git(root, ['rev-parse', '--show-toplevel']));
  const base = resolveBase(root, preferredBase);
  const mergeBase = git(root, ['merge-base', 'HEAD', base]);
  const tracked = git(root, ['diff', '--name-status', '--no-renames', mergeBase, '--', '.'])
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [status, file] = l.split('\t');
      return { status, abs: path.resolve(top, file) };
    });
  const untracked = git(root, ['ls-files', '--others', '--exclude-standard', '--full-name', '--', '.'])
    .split('\n')
    .filter(Boolean)
    .map((f) => ({ status: 'A', abs: path.resolve(top, f) }));
  return { root, base, mergeBase, changes: [...tracked, ...untracked].filter((c) => c.abs.startsWith(path.resolve(root) + path.sep)) };
};

/** Lines a changed file gained since the merge base (all lines of a new file). */
export const addedLines = (g: GitChanges, c: { status: string; abs: string }) => {
  if (c.status === 'A') return fs.existsSync(c.abs) ? fs.readFileSync(c.abs, 'utf8').split('\n') : [];
  return git(g.root, ['diff', g.mergeBase, '--', c.abs])
    .split('\n')
    .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
    .map((l) => l.slice(1));
};

export const changeImpact = (projectRoot: string, routes: RouteInfo[], preferredBase?: string): ImpactResult => {
  const { root, base, mergeBase, changes } = gitChanges(projectRoot, preferredBase);
  const result: ImpactResult = { base, routes: new Set(), notes: [], changedFiles: changes.length };
  if (!changes.length) {
    result.notes.push(`No changes since ${base}`);
    return result;
  }

  const byFile = new Map<string, RouteInfo[]>();
  for (const r of routes) if (r.file) (byFile.get(path.resolve(root, r.file)) ?? byFile.set(path.resolve(root, r.file), []).get(path.resolve(root, r.file))!).push(r);
  if (!byFile.size) {
    result.routes = 'all';
    result.notes.push('Pages are not linked to source files in this project: every page is tested');
    return result;
  }
  const selected = result.routes as Set<string>;
  let graph: Map<string, Set<string>> | null = null;
  const importers = () => (graph ??= importGraph(root));

  /** Pages reachable upward from files (through importers). */
  const pagesUsing = (start: string[]) => {
    const seen = new Set<string>(start);
    const queue = [...start];
    const found = new Set<string>();
    while (queue.length) {
      const f = queue.shift()!;
      for (const r of byFile.get(f) ?? []) found.add(r.path);
      for (const imp of importers().get(f) ?? []) if (!seen.has(imp)) (seen.add(imp), queue.push(imp));
    }
    return found;
  };
  const addAll = (why: string) => {
    result.routes = 'all';
    result.notes.unshift(why);
  };

  for (const c of changes) {
    if (result.routes === 'all') break;
    const relPath = rel(root, c.abs);
    // Global files first: requirements.txt must not be ignored as a text file
    if (GLOBAL_FILE.some((re) => re.test(relPath))) {
      addAll(`${relPath} affects the whole app: every page is tested`);
      break;
    }
    if (IGNORED.test(relPath)) continue;
    const pages = byFile.get(c.abs);
    if (pages) {
      pages.forEach((p) => selected.add(p.path));
      result.notes.push(`${relPath} → ${pages.map((p) => p.path).join(', ')}`);
      if (!fs.existsSync(c.abs)) continue;
    }
    if (!CODE_EXT.includes(path.extname(c.abs))) {
      // A controller, view or template is mapped to its routes; anything else cannot be traced
      if (pages || !SERVER_EXT.some((e) => relPath.endsWith(e))) continue;
      addAll(`${relPath} is not a page's own file, and QAgent traces imports for JavaScript and TypeScript only: every page is tested`);
      break;
    }
    // Next.js layouts and templates wrap every page in their folder
    if (/^(layout|template|loading|error)\.\w+$/.test(path.basename(c.abs))) {
      const dir = path.dirname(c.abs) + path.sep;
      const under = routes.filter((r) => r.file && path.resolve(root, r.file).startsWith(dir)).map((r) => r.path);
      under.forEach((p) => selected.add(p));
      result.notes.push(`${relPath} wraps ${under.length} page(s)`);
      continue;
    }

    const isNew = c.status === 'A';
    const diff = isNew ? '' : git(root, ['diff', mergeBase, '--', c.abs]);
    const added = isNew ? [] : diff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).map((l) => l.slice(1));
    const removed = isNew ? [] : diff.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---') && l.slice(1).trim());
    const onlyAdditions = !isNew && removed.length === 0;
    const text = fs.existsSync(c.abs) ? fs.readFileSync(c.abs, 'utf8') : '';

    if (ROUTER_DECL.test(text) && !pages) {
      if (!onlyAdditions) {
        addAll(`${relPath} (routes) was edited: every page is tested`);
        break;
      }
      // Only new routes: the pages whose path or component appears in the added lines
      const fresh = routes.filter((r) => added.some((l) => l.includes(`'${r.path}'`) || l.includes(`"${r.path}"`) || (r.file && l.includes(path.basename(r.file).replace(/\.\w+$/, '')))));
      fresh.forEach((r) => selected.add(r.path));
      result.notes.push(`${relPath}: new routes only → ${fresh.map((r) => r.path).join(', ') || 'none matched'}`);
      continue;
    }
    if (isNew) continue; // a new file matters only through what imports it, which is itself changed

    if (onlyAdditions) {
      const names = addedExports(added);
      if (names.length) {
        // Only pages using the new names
        const users = [...(importers().get(c.abs) ?? [])].filter((imp) => {
          const t = fs.readFileSync(imp, 'utf8');
          return names.some((n) => new RegExp(`\\b${n.replace(/\$/g, '\\$')}\\b`).test(t));
        });
        const found = pagesUsing(users);
        found.forEach((p) => selected.add(p));
        result.notes.push(`${relPath}: new ${names.slice(0, 4).join(', ')}${names.length > 4 ? '…' : ''} → ${found.size} page(s)`);
        continue;
      }
    }
    const found = pagesUsing([c.abs]);
    found.forEach((p) => selected.add(p));
    if (found.size && !pages) result.notes.push(`${relPath} → ${found.size} page(s) that import it`);
  }
  return result;
};
