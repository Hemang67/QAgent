/**
 * Developer CLI for the engine (Phase 1, before the VS Code run panel exists).
 * It plans a run exactly as the extension will and talks to the engine over
 * the same stdin/stdout protocol.
 *
 *   node dist/cli.js pages <project>
 *   node dist/cli.js run <project> --env local,dev --types smoke,regression --login browser|credentials|skip [--headed] [--crawl] [--base origin/main] [--confirm LIVE] [--confirm-crud YES] [--low-login credentials] [--confirm-security "LIVE SECURITY"]
 *
 * Credentials: QAGENT_USERNAME / QAGENT_PASSWORD, or typed when asked. Never written anywhere.
 */
import { spawn } from 'child_process';
import path from 'path';
import readline from 'readline';
import { buildPlan, inspectProject, type RunChoices } from './planner/plan';
import { ensureLocalApp } from './planner/local-server';
import { findNewPages } from './planner/new-pages';
import { ENV_NAMES, TEST_TYPE_LABEL, type EngineMessage, type EnvName, type LoginMode, type TestType } from './shared/types';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (name: string) => args.includes(`--${name}`);

const ask = (question: string, hidden = false) =>
  new Promise<string>((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      // Echo nothing while the password is typed
      (rl as any)._writeToOutput = (s: string) => {
        if (s.includes(question)) process.stdout.write(s);
      };
    }
    rl.question(question, (a) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(a.trim());
    });
  });

const ICON: Record<string, string> = { passed: '✔', failed: '✖', skipped: '–', unverified: '?' };

const listPages = (root: string) => {
  const info = inspectProject(root);
  console.log(`${info.name} — ${info.framework}, ${info.routes.length} page(s)`);
  for (const [env, u] of Object.entries(info.urls)) console.log(`  ${env.padEnd(6)} ${u.url}${u.apiUrl ? `  (API ${u.apiUrl})` : ''}`);
  if (info.localStart) console.log(`  start  ${info.localStart}`);
  console.log('');
  for (const r of info.routes) console.log(`  ${r.path.padEnd(40)} ${(r.file ?? '').padEnd(60)} ${r.params.join(', ')}`);
  if (!info.routes.length) console.log('  No routes found in code: pages will be found by crawling the running site.');
};

const run = async (root: string) => {
  const info = inspectProject(root);
  // Ignore the routes found in code and crawl the running site instead (tests the crawler)
  if (has('crawl')) info.routes = [];
  const envs = (flag('env') ?? 'local').split(',') as EnvName[];
  const types = (flag('types') ?? 'smoke').split(',') as TestType[];
  for (const e of envs) if (!ENV_NAMES.includes(e)) throw new Error(`Unknown environment "${e}"`);
  for (const t of types) if (!TEST_TYPE_LABEL[t]) throw new Error(`Unknown test type "${t}"`);

  // Safety rule 4: Live needs LIVE typed
  if (envs.includes('live')) {
    const typed = flag('confirm') ?? (await ask('Type LIVE to run against the Live site: '));
    if (typed !== 'LIVE') throw new Error('Live run not confirmed');
  }

  const mode = (flag('login') ?? 'browser') as LoginMode;
  const logins: RunChoices['logins'] = {};
  for (const env of envs) {
    if (mode === 'credentials') {
      const username = process.env.QAGENT_USERNAME || (await ask(`${env} username: `));
      const password = process.env.QAGENT_PASSWORD || (await ask(`${env} password: `, true));
      logins[env] = { mode, username, password };
    } else {
      logins[env] = { mode };
    }
  }

  // Safety rule 4: CRUD writes data, so it needs YES typed
  let confirmCrud: string | undefined;
  if (types.includes('crud')) confirmCrud = flag('confirm-crud') ?? (await ask('CRUD creates and deletes test records. Type YES to continue: '));

  // Safety rule 4: the security scan on Live has its own confirmation
  let confirmLiveSecurity: string | undefined;
  if (envs.includes('live') && types.includes('security')) confirmLiveSecurity = flag('confirm-security') ?? (await ask('Only scan sites you own or may test. Type LIVE SECURITY to continue: '));
  // Second, low-permission login for the role checks: QAGENT_LOW_USERNAME / QAGENT_LOW_PASSWORD
  const lowLogins: RunChoices['lowLogins'] = {};
  if (flag('low-login') === 'credentials') for (const env of envs) lowLogins[env] = { mode: 'credentials', username: process.env.QAGENT_LOW_USERNAME, password: process.env.QAGENT_LOW_PASSWORD };

  const plan = buildPlan(info, { envs, types, logins, headless: !has('headed'), baseBranch: flag('base'), confirmCrud, confirmLiveSecurity, lowLogins });
  console.log(`${info.name}: ${envs.join(', ')} × ${types.map((t) => TEST_TYPE_LABEL[t]).join(', ')} — ${info.routes.length || 'crawled'} page(s), browser ${plan.browser.channel ?? 'chromium'}`);

  let stopLocal = () => {};
  if (envs.includes('local')) stopLocal = await ensureLocalApp(info.urls.local!.url, info.localStart, root, (s) => console.log(s));

  const engine = spawn(process.execPath, [path.join(__dirname, 'engine.js')], { stdio: ['pipe', 'pipe', 'inherit'] });
  engine.stdin.write(JSON.stringify(plan) + '\n');
  process.on('SIGINT', () => engine.stdin.write('{"kind":"cancel"}\n'));

  let ok = false;
  const rl = readline.createInterface({ input: engine.stdout });
  rl.on('line', (line) => {
    let m: EngineMessage;
    try {
      m = JSON.parse(line);
    } catch {
      console.log(line);
      return;
    }
    switch (m.kind) {
      case 'log':
        console.log(`  ${m.text}`);
        break;
      case 'job-start':
        console.log(`\n▶ ${m.env} · ${TEST_TYPE_LABEL[m.type]}`);
        break;
      case 'page':
        console.log(`  ${ICON[m.result]} ${(m.part ? `${m.route} · ${m.part}` : m.route).padEnd(40)} ${m.result.padEnd(10)} ${m.reason}`);
        break;
      case 'job-end':
        console.log(`  = ${m.status.toUpperCase()}  passed ${m.counts.passed}, failed ${m.counts.failed}, skipped ${m.counts.skipped}, unverified ${m.counts.unverified}`);
        break;
      case 'workbook':
        console.log(`\nResults: ${m.file} (${m.sheets.join(', ') || 'Run History only'})`);
        break;
      case 'fallback':
        console.log(`\nCould not write the workbook (${m.error}).\nResults kept in ${m.dir}`);
        break;
      case 'error':
        console.error(`Engine error: ${m.text}`);
        break;
      case 'done':
        ok = m.ok;
        engine.stdin.end();
        break;
    }
  });
  const code = await new Promise<number>((resolve) => engine.on('exit', (c) => resolve(c ?? 1)));
  stopLocal();
  process.exitCode = code || (ok ? 0 : 1);
};

const main = async () => {
  const [cmd, project] = args;
  const root = path.resolve(project ?? '.');
  if (cmd === 'pages') return listPages(root);
  if (cmd === 'new-pages') {
    const info = inspectProject(root);
    const r = findNewPages(root, info.routes, info.config, flag('base') ?? info.config.baseBranch);
    console.log(`Compared with ${r.base}: ${r.pages.length} new page(s), ${r.endpoints.length} new endpoint(s) that may send, book or charge`);
    for (const p of r.pages) console.log(`  page      ${p.path.padEnd(36)} ${(p.file ?? '').padEnd(48)} ${p.params.length ? `needs ${p.params.join(', ')}` : ''}${p.configured ? ' (set up)' : ''}`);
    for (const e of r.endpoints) console.log(`  endpoint  ${e.endpoint.padEnd(36)} ${e.file}`);
    if (r.pages.length || r.endpoints.length) console.log('Set them up in the app: Pages → New since the base branch');
    return;
  }
  if (cmd === 'run') return run(root);
  console.log('Usage:\n  qagent pages <project>\n  qagent new-pages <project> [--base origin/main]\n  qagent run <project> --env local --types smoke,regression --login browser|credentials|skip [--headed]');
};

main().catch((e) => {
  console.error((e as Error).message);
  process.exitCode = 1;
});
