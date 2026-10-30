import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import type { Finding, SeverityLevel } from './client';

/** A check that could not run (tool missing, no lock file): reported unverified, never passed. */
export class NotChecked extends Error {}

const run = (cmd: string, args: string[], cwd: string) =>
  new Promise<{ code: number | null; out: string; missing: boolean }>((resolve) => {
    const child = spawn(cmd, args, { cwd, shell: process.platform === 'win32', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill(), 180_000);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', () => (clearTimeout(timer), resolve({ code: null, out, missing: true })));
    child.on('close', (code) => {
      clearTimeout(timer);
      // Windows shells report a missing command through exit code and stderr
      resolve({ code, out, missing: code !== 0 && !out.trim() && /not recognized|not found/i.test(err) });
    });
  });

const SEVERITY: Record<string, SeverityLevel> = { critical: 'Critical', high: 'High', moderate: 'Medium', medium: 'Medium', low: 'Low', info: 'Low' };
const CHECK = 'Vulnerable libraries';

const fromNpm = (out: string): Finding[] => {
  const data = JSON.parse(out);
  if (data.error || data.message) throw new NotChecked(`npm audit: ${data.error?.summary ?? data.message}`);
  return Object.values<any>(data.vulnerabilities ?? {}).map((v) => {
    const via = (v.via ?? []).find((x: any) => typeof x === 'object');
    return {
      severity: SEVERITY[v.severity] ?? 'Medium',
      check: CHECK,
      url: `package: ${v.name}`,
      evidence: `${v.name} ${v.range ?? ''}${via?.title ? `: ${via.title}` : ''}`.trim(),
      fix: v.fixAvailable ? 'Run npm audit fix, or upgrade this package' : 'No fix is published yet: consider replacing the package',
    };
  });
};

const fromPip = (out: string): Finding[] => {
  const data = JSON.parse(out);
  return (data.dependencies ?? data).flatMap((d: any) =>
    (d.vulns ?? []).map((v: any) => ({ severity: 'High' as const, check: CHECK, url: `package: ${d.name}`, evidence: `${d.name} ${d.version}: ${v.id}`, fix: v.fix_versions?.length ? `Upgrade to ${v.fix_versions[0]}` : 'No fix is published yet' })),
  );
};

const fromComposer = (out: string): Finding[] =>
  Object.entries<any>(JSON.parse(out).advisories ?? {}).flatMap(([name, list]) =>
    Object.values<any>(list).map((a) => ({ severity: SEVERITY[String(a.severity).toLowerCase()] ?? 'Medium', check: CHECK, url: `package: ${name}`, evidence: `${name}: ${a.title}`, fix: 'Run composer update for this package' })),
  );

const fromDotnet = (out: string): Finding[] =>
  (JSON.parse(out).projects ?? []).flatMap((p: any) =>
    (p.frameworks ?? []).flatMap((f: any) =>
      (f.topLevelPackages ?? []).concat(f.transitivePackages ?? []).flatMap((pkg: any) =>
        (pkg.vulnerabilities ?? []).map((v: any) => ({ severity: SEVERITY[String(v.severity).toLowerCase()] ?? 'Medium', check: CHECK, url: `package: ${pkg.id}`, evidence: `${pkg.id} ${pkg.resolvedVersion}: ${v.advisoryurl}`, fix: 'Upgrade this package' })),
      ),
    ),
  );

/** Known CVEs in dependencies, using the tool of each ecosystem found in the project. */
export const checkLibraries = async (root: string): Promise<Finding[]> => {
  const has = (f: string) => fs.existsSync(path.join(root, f));
  const found: Finding[] = [];
  const skipped: string[] = [];
  let ran = 0;
  const tool = async (name: string, cmd: string, args: string[], parse: (o: string) => Finding[]) => {
    const r = await run(cmd, args, root);
    if (r.missing || !r.out.trim()) {
      skipped.push(`${name} is not available`);
      return;
    }
    found.push(...parse(r.out));
    ran++;
  };
  if (has('package-lock.json')) await tool('npm audit', 'npm', ['audit', '--json'], fromNpm);
  else if (has('package.json')) skipped.push('npm audit needs a package-lock.json');
  if (has('requirements.txt')) await tool('pip-audit', 'pip-audit', ['-r', 'requirements.txt', '-f', 'json'], fromPip);
  if (has('composer.lock')) await tool('composer audit', 'composer', ['audit', '--format=json'], fromComposer);
  if (fs.readdirSync(root).some((f) => /\.(csproj|sln)$/.test(f))) await tool('dotnet', 'dotnet', ['list', 'package', '--vulnerable', '--include-transitive', '--format', 'json'], fromDotnet);
  if (!ran) throw new NotChecked(skipped.join('; ') || 'No dependency file found');
  return found;
};

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', '.svelte-kit', 'coverage', '.qagent', 'vendor', 'bin', 'obj', '__pycache__', 'venv', '.venv', 'release']);
const SKIP_FILE = /\.(png|jpe?g|gif|ico|webp|svg|pdf|zip|gz|woff2?|ttf|eot|mp4|mp3|xlsx?|docx?|map|min\.js|lock|exe|dll|so)$|(^|[\\/])(package-lock\.json|pnpm-lock\.yaml)$/i;
const PLACEHOLDER = /example|placeholder|changeme|change-me|your[-_]|xxx|\*\*\*|<|\$\{|\{\{|process\.env|import\.meta|^test$|^password$|^secret$/i;

const PATTERNS: { name: string; severity: SeverityLevel; re: RegExp }[] = [
  { name: 'Private key', severity: 'Critical', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  { name: 'AWS access key', severity: 'Critical', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'GitHub token', severity: 'Critical', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: 'Slack token', severity: 'High', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'Stripe live key', severity: 'Critical', re: /\b[sr]k_live_[A-Za-z0-9]{16,}\b/ },
  { name: 'Google API key', severity: 'High', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'Password or key in code', severity: 'High', re: /\b(?:password|passwd|pwd|secret|api[_-]?key|apikey|auth[_-]?token|access[_-]?token|client[_-]?secret)\b["']?\s*[:=]\s*["'`]([^"'`\s]{8,})["'`]/i },
];
const ENV_LINE = /^\s*(?:export\s+)?[A-Z0-9_]*(?:PASSWORD|PASSWD|SECRET|API_?KEY|TOKEN|PRIVATE_?KEY)[A-Z0-9_]*\s*=\s*["']?([^"'\s#]{8,})/gim;

/** Never show a secret in a report: the first four characters only. */
export const mask = (s: string) => `${s.slice(0, 4)}${'*'.repeat(8)}`;

const listAll = (root: string) => {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(p);
      } else if (!SKIP_FILE.test(e.name) && e.name !== 'qagent-results.xlsx') out.push(p);
    }
  };
  walk(root);
  return out;
};

const ignoredByGit = async (root: string, rel: string) => (await run('git', ['check-ignore', '-q', rel], root)).code === 0;

/** API keys, passwords and tokens in the repository or .env files; values are masked. */
export const checkSecrets = async (root: string): Promise<Finding[]> => {
  const found: Finding[] = [];
  const fix = 'Move it to a secret store or an untracked environment file, and replace the exposed value';
  for (const file of listAll(root)) {
    let text: string;
    try {
      if (fs.statSync(file).size > 1_000_000) continue;
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const rel = path.relative(root, file).replace(/\\/g, '/');
    const lineOf = (i: number) => text.slice(0, i).split('\n').length;
    if (/^\.env/.test(path.basename(file))) {
      const hits = [...text.matchAll(ENV_LINE)].filter((m) => !PLACEHOLDER.test(m[1]));
      if (hits.length) {
        // Normal for a local .env, serious when it is committed
        const ignored = await ignoredByGit(root, rel);
        for (const m of hits) found.push({ severity: ignored ? 'Low' : 'High', check: 'Secrets in code', url: `${rel}:${lineOf(m.index)}`, evidence: `Value ${mask(m[1])}${ignored ? ' (file is gitignored)' : ' (file is not gitignored)'}`, fix });
      }
      continue;
    }
    for (const p of PATTERNS) {
      const m = p.re.exec(text);
      if (!m) continue;
      const value = m[1] ?? m[0];
      if (PLACEHOLDER.test(value)) continue;
      found.push({ severity: p.severity, check: 'Secrets in code', url: `${rel}:${lineOf(m.index)}`, evidence: `${p.name}: ${mask(value)}`, fix });
    }
  }
  return found;
};
