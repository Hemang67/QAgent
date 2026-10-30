import fs from 'fs';
import path from 'path';
import type { EnvName, RouteInfo } from '../../shared/types';
import type { Adapter, DetectedEnv } from '../types';
import { listFiles, readJson, rel } from '../common';

// {id:int} or {id} → :id; {id?} optional, left out; catch-all {*slug} → not a single page
const template = (t: string) => t.replace(/\/?\{\w+(:[^}]*)?\?\}/g, '').replace(/\{\*{1,2}\w+[^}]*\}/g, '*').replace(/\{(\w+)(:[^}]*)?\}/g, ':$1');
const join = (...parts: string[]) => ('/' + parts.join('/').split('/').filter(Boolean).join('/')).replace(/\/index$/i, '') || '/';
const params = (p: string) => [...p.matchAll(/:(\w+)/g)].map((m) => m[1]);

const projectDir = (root: string) => {
  const csproj = fs.readdirSync(root).find((f) => f.endsWith('.csproj'));
  if (csproj) return root;
  // A solution folder: the first project folder with Pages/ or Controllers/
  for (const d of fs.readdirSync(root, { withFileTypes: true })) {
    if (d.isDirectory() && fs.existsSync(path.join(root, d.name)) && fs.readdirSync(path.join(root, d.name)).some((f) => f.endsWith('.csproj'))) return path.join(root, d.name);
  }
  return root;
};

/**
 * Razor Pages (Pages/**\/*.cshtml with @page), Blazor components (@page "/x"),
 * and MVC controllers: attribute routes, or /Controller/Action by convention.
 */
export const dotnetRoutes = (root: string): RouteInfo[] => {
  const dir = projectDir(root);
  const found = new Map<string, RouteInfo>();
  const add = (p: string, file: string) => {
    if (p.includes('*') || found.has(p)) return;
    found.set(p, { path: p, file: rel(root, file), params: params(p), source: 'router' });
  };

  for (const f of listFiles(dir, ['.cshtml', '.razor'])) {
    const text = fs.readFileSync(f, 'utf8');
    const name = path.basename(f);
    if (name.startsWith('_')) continue;
    if (f.endsWith('.razor')) {
      for (const m of text.matchAll(/^@page\s+"([^"]*)"/gm)) add(join(template(m[1])), f);
      continue;
    }
    const page = /^@page(?:\s+"([^"]*)")?/m.exec(text);
    if (!page) continue; // MVC views and partials
    const pagesDir = path.join(dir, 'Pages');
    if (!f.startsWith(pagesDir + path.sep)) continue;
    const base = path.relative(pagesDir, f).replace(/\\/g, '/').replace(/\.cshtml$/, '');
    const t = page[1] ?? '';
    add(t.startsWith('/') ? join(template(t)) : join(base, template(t)), f);
  }

  for (const f of listFiles(dir, ['.cs'])) {
    if (!/Controller\.cs$/.test(f)) continue;
    const text = fs.readFileSync(f, 'utf8');
    if (/\[ApiController\]/.test(text)) continue; // JSON APIs are not pages
    const cls = /class\s+(\w+)Controller\b/.exec(text)?.[1];
    if (!cls) continue;
    const classRoute = /\[Route\("([^"]*)"\)\]\s*(?:\[[^\]]*\]\s*)*public\s+(?:sealed\s+|partial\s+)*class/.exec(text)?.[1];
    // Public actions returning a view (GET by default; [HttpPost]-only actions are skipped)
    const action = /((?:\[[^\]]+\]\s*)*)public\s+(?:async\s+)?(?:Task<)?(?:IActionResult|ActionResult|ViewResult)>?\s+(\w+)\s*\(/g;
    for (const m of text.matchAll(action)) {
      const attrs = m[1];
      if (/\[Http(Post|Put|Delete|Patch)/.test(attrs) && !/\[HttpGet/.test(attrs)) continue;
      const own = /\[(?:HttpGet|Route)\("([^"]*)"\)\]/.exec(attrs)?.[1];
      const tokens = (s: string) => s.replace(/\[controller\]/gi, cls).replace(/\[action\]/gi, m[2]);
      let p: string;
      if (own?.startsWith('/') || own?.startsWith('~/')) p = join(template(tokens(own.replace(/^~/, ''))));
      else if (classRoute !== undefined || own !== undefined) p = join(template(tokens(classRoute ?? '')), template(tokens(own ?? '')));
      else p = cls === 'Home' && m[2] === 'Index' ? '/' : join(cls, m[2] === 'Index' ? '' : m[2]);
      add(p, f);
    }
  }
  return [...found.values()].sort((a, b) => a.path.localeCompare(b.path));
};

const APPSETTINGS: [RegExp, EnvName][] = [
  [/^appsettings\.(Development|Local)\.json$/i, 'local'],
  [/^appsettings\.(Dev)\.json$/i, 'dev'],
  [/^appsettings\.(Staging|Test|QA|UAT)\.json$/i, 'test'],
  [/^appsettings\.(Production|Prod)\.json$/i, 'live'],
];

/** Local URL from launchSettings.json; others from *Url keys in appsettings.{Env}.json. */
export const dotnetEnvironments = (root: string) => {
  const dir = projectDir(root);
  const out: Partial<Record<EnvName, DetectedEnv>> = {};
  const launch = readJson(path.join(dir, 'Properties', 'launchSettings.json'));
  const urls: string[] = Object.values<any>(launch?.profiles ?? {}).flatMap((p) => String(p.applicationUrl ?? '').split(';')).filter(Boolean);
  const local = urls.find((u) => u.startsWith('https:')) ?? urls[0];
  if (local) out.local = { url: local.replace(/\/+$/, ''), from: 'Properties/launchSettings.json' };
  for (const f of fs.readdirSync(dir)) {
    const env = APPSETTINGS.find(([re]) => re.test(f))?.[1];
    if (!env) continue;
    const flat = JSON.stringify(readJson(path.join(dir, f)) ?? {});
    const e: DetectedEnv = { ...out[env] };
    for (const m of flat.matchAll(/"(\w*(?:Url|Uri|Host))"\s*:\s*"(https?:\/\/[^"]+)"/gi)) {
      if (/api|backend|service/i.test(m[1])) e.apiUrl ??= new URL(m[2]).origin;
      else if (!e.url || env !== 'local') e.url = m[2].replace(/\/+$/, '');
    }
    if (e.url || e.apiUrl) out[env] = { ...e, from: e.from ?? f };
  }
  return out;
};

export const dotnet: Adapter = {
  id: 'dotnet',
  label: '.NET (Razor Pages, Blazor, MVC)',
  detect: (root) => fs.readdirSync(root).some((f) => /\.(csproj|sln)$/.test(f)),
  startCommand(root) {
    const local = dotnetEnvironments(root).local?.url ?? 'http://localhost:5000';
    const dir = projectDir(root);
    return { command: dir === root ? 'dotnet run' : `dotnet run --project "${path.basename(dir)}"`, url: local };
  },
  environments: dotnetEnvironments,
  routes: dotnetRoutes,
};
