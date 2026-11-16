import fs from 'fs';
import path from 'path';
import { listFiles, rel } from '../adapters/common';
import type { RouteInfo } from '../shared/types';
import { IGNORED, ROUTER_DECL } from './impact';

// Files that can open a page: code, components and server templates
const TEXT_EXT = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.vue', '.svelte', '.html', '.htm', '.cshtml', '.razor', '.php', '.py', '.twig', '.jinja', '.jinja2', '.erb'];
// Keys that hold a path in router or menu config, not a route constant other code refers to
const GENERIC_KEYS = new Set(['path', 'url', 'href', 'to', 'route', 'link', 'pathname', 'redirect', 'redirectTo', 'from', 'as', 'src']);
const MAX_SOURCES = 5;
const MAX_DEPTH = 4;
// Code that opens a page, in any framework: the same line or the two before it.
// API calls, page titles and "pathname === …" checks mention paths too, and are not this
const NAVIGATES = /navigate|\.push\(|\.replace\(|\bhref\b|\bto\s*[=:]|<Link\b|NavLink|redirect|location\.|window\.open|router|routerLink|url_for|\burl\s*\(|asp-page|asp-action|Url\.Action|route\(/i;

// import … from '…', import('…'), require('…'), export … from '…'
const IMPORT = /(?:\bfrom|\bimport\s*\(?|\brequire\s*\()\s*['"]([^'"]+)['"]/g;

/** "orders/tabs/estimation.tsx" and "./tabs/estimation" → "estimation"; an index file goes by its folder. */
const moduleName = (spec: string) => {
  const parts = spec.replace(/\\/g, '/').replace(/\.\w+$/, '').split('/').filter(Boolean);
  const last = parts.pop() ?? '';
  return (last.toLowerCase() === 'index' ? (parts.pop() ?? last) : last).toLowerCase();
};

/** Whether the match at `index` sits in code that opens a page. */
const inNavigation = (text: string, index: number) => {
  let start = index;
  for (let n = 0; n < 3 && start > 0; n++) start = text.lastIndexOf('\n', start - 1);
  const end = text.indexOf('\n', index);
  return NAVIGATES.test(text.slice(Math.max(0, start), end < 0 ? undefined : end));
};

/** A page whose code opens a page that needs a record ID (a list leading to its records). */
export interface RecordSource {
  route: string;
  /** The file holding the link or navigation, relative to the project */
  file: string;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Path text before the first parameter: "/orders/" for /orders/:orderId, the whole path otherwise. */
const fixedPart = (route: string) => {
  const i = route.indexOf('/:');
  return i < 0 ? route : route.slice(0, i + 1);
};

/**
 * For every page that needs a record ID: the pages whose code opens it, best first.
 * A file opens a page when it holds the page's path as text ("/customer?customerId=",
 * `/orders/${id}`) or uses the constant that holds it (NavigationRoutes.siteDetails).
 * Files are traced to pages through their own route file, or up through the files that
 * import them to the nearest pages. Pages that open without an ID come first.
 * The run checks each one: only a URL the app really opens is used.
 */
export const recordSources = (root: string, routes: RouteInfo[]): Record<string, RecordSource[]> => {
  const waiting = routes.filter((r) => r.params.length);
  const out: Record<string, RecordSource[]> = {};
  if (!waiting.length) return out;

  const texts = new Map<string, string>();
  for (const f of listFiles(root, TEXT_EXT)) {
    if (IGNORED.test(rel(root, f))) continue;
    try {
      const t = fs.readFileSync(f, 'utf8');
      // The router declares every page: it does not lead to records
      if (!ROUTER_DECL.test(t)) texts.set(path.resolve(f), t);
    } catch {
      // unreadable file
    }
  }
  const byFile = new Map<string, string[]>();
  for (const r of routes) {
    if (!r.file) continue;
    const abs = path.resolve(root, r.file);
    byFile.set(abs, [...(byFile.get(abs) ?? []), r.path]);
  }
  const needsId = new Set(waiting.map((r) => r.path));
  // Who imports what, by module name: a full import graph takes far too long on a large project
  const importersByName = new Map<string, Set<string>>();
  for (const [f, t] of texts) {
    for (const m of t.matchAll(IMPORT)) {
      const name = moduleName(m[1]);
      (importersByName.get(name) ?? importersByName.set(name, new Set()).get(name)!).add(f);
    }
  }

  /** The nearest pages using `file`: its own pages, else the first level of importers that reaches any. */
  const pagesOf = (file: string): { route: string; depth: number }[] => {
    let level = [file];
    const seen = new Set(level);
    for (let depth = 0; depth <= MAX_DEPTH && level.length; depth++) {
      const found = level.flatMap((f) => byFile.get(f) ?? []);
      if (found.length) return [...new Set(found)].map((route) => ({ route, depth }));
      level = level.flatMap((f) => [...(importersByName.get(moduleName(f)) ?? [])]).filter((f) => !seen.has(f) && (seen.add(f), true));
    }
    return [];
  };

  const lower = new Map([...texts].map(([f, t]) => [f, t.toLowerCase()]));

  for (const w of waiting) {
    const fixed = fixedPart(w.path);
    const own = w.file ? path.resolve(root, w.file) : '';
    // Definitions of the path ("siteDetails: '/siteDetails'", "const CUSTOMER = '/customer'"), and the names they give
    const def = new RegExp(`(?:\\b(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=|(?:^|[\\s,{(])['"]?([A-Za-z_$][\\w$]*)['"]?\\s*:)\\s*['"\`]${esc(w.path)}['"\`]`, 'gim');
    const names = new Map<string, 'const' | 'key'>();
    const needle = w.path.toLowerCase();
    for (const [f, t] of texts) {
      // Plain text first: the regular expressions are slow on a large project
      if (!lower.get(f)!.includes(needle)) continue;
      for (const m of t.matchAll(def)) {
        if (m[1]) names.set(m[1], 'const');
        else if (m[2] && !GENERIC_KEYS.has(m[2])) names.set(m[2], 'key');
      }
    }
    const usages = [...names].map(([n, kind]) => ({ text: kind === 'key' ? `.${n}` : n, re: new RegExp(kind === 'key' ? `\\.${esc(n)}\\b` : `\\b${esc(n)}\\b(?!\\s*=[^=])`, 'g') }));
    // The path as text, followed by where an ID goes: a quote, "?", "/", or ${…}
    const literal = fixed.length > 1 ? new RegExp(`['"\`]${esc(fixed)}${fixed === w.path ? `(?=['"\`?/#]|\\$\\{)` : ''}`, 'gi') : null;
    const fixedLower = fixed.toLowerCase();

    const found = new Map<string, { route: string; depth: number; file: string }>();
    for (const [file, t] of texts) {
      if (file === own) continue;
      const low = lower.get(file)!;
      const res = [literal && low.includes(fixedLower) ? literal : null, ...usages.filter((u) => t.includes(u.text)).map((u) => u.re)].filter((r): r is RegExp => !!r);
      if (!res.length) continue;
      const body = low.includes(needle) ? t.replace(def, '') : t;
      if (!res.some((re) => [...body.matchAll(re)].some((m) => inNavigation(body, m.index!)))) continue;
      for (const p of pagesOf(file)) {
        if (p.route === w.path) continue;
        const prev = found.get(p.route);
        if (!prev || p.depth < prev.depth) found.set(p.route, { ...p, file: rel(root, file) });
      }
    }
    out[w.path] = [...found.values()]
      .sort((a, b) => a.depth - b.depth || Number(needsId.has(a.route)) - Number(needsId.has(b.route)) || a.route.localeCompare(b.route))
      .slice(0, MAX_SOURCES)
      .map(({ route, file }) => ({ route, file }));
  }
  return out;
};
