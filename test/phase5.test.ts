import { execFileSync, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { detectAdapter } from '../src/adapters';
import { findNewPages } from '../src/planner/new-pages';
import { installReminder, reminderStatus } from '../src/planner/reminder';

const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'qagent-p5-'));
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' }).toString();
const write = (rel: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
  fs.writeFileSync(path.join(repo, rel), text);
};
afterAll(() => fs.rmSync(repo, { recursive: true, force: true }));

beforeAll(() => {
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 'Test');
  write('package.json', JSON.stringify({ dependencies: { 'react-router-dom': '6' } }));
  write('src/router.jsx', "import A from './pages/A';\nexport const router = createBrowserRouter([\n  { path: '/a', element: <A /> },\n]);\n");
  write('src/pages/A.jsx', 'export default () => null;\n');
  write('src/api.js', "export const list = () => get('/api/orders');\n");
  git('add', '.');
  git('commit', '-q', '-m', 'base');
  git('checkout', '-q', '-b', 'feature');
});

describe('add new pages', () => {
  it('finds new pages (new file or new route) and new send/book/charge calls only', () => {
    write('src/pages/Returns.jsx', "export default () => { const id = searchParams.get('returnId'); return null; };\n");
    write('src/pages/B.jsx', 'export default () => null;\n');
    const r = fs.readFileSync(path.join(repo, 'src/router.jsx'), 'utf8');
    write('src/router.jsx', r.replace("import A from './pages/A';", "import A from './pages/A';\nimport B from './pages/B';\nimport Returns from './pages/Returns';").replace("  { path: '/a', element: <A /> },", "  { path: '/a', element: <A /> },\n  { path: '/b', element: <B /> },\n  { path: '/returns', element: <Returns /> },"));
    fs.appendFileSync(path.join(repo, 'src/api.js'), "export const label = (id) => post(`${API}/returns/${id}/SendReturnLabelEmail`);\nexport const history = () => get('/api/returns/history');\n");
    const found = findNewPages(repo, detectAdapter(repo).routes(repo), { lists: { smoke: ['/b'] } }, 'main');
    expect(found.pages.map((p) => [p.path, p.params, p.configured])).toEqual([
      ['/b', [], true],
      ['/returns', ['?returnId'], false],
    ]);
    expect(found.endpoints.map((e) => e.endpoint)).toEqual(['/returns/:param/SendReturnLabelEmail']);
    // Already blocked endpoints are not asked about again
    expect(findNewPages(repo, detectAdapter(repo).routes(repo), { blockedEndpoints: ['SendReturnLabelEmail'] }, 'main').endpoints).toEqual([]);
  });
});

describe('commit reminder', () => {
  it('installs into this clone and prints a hint on a commit that adds a page, without blocking it', () => {
    expect(reminderStatus(repo).state).toBe('not-installed');
    expect(installReminder(repo).state).toBe('installed');
    expect(reminderStatus(repo).state).toBe('installed');
    git('add', '.');
    const commit = spawnSync('git', ['commit', '-m', 'returns page'], { cwd: repo, encoding: 'utf8' });
    expect(commit.status).toBe(0);
    const out = commit.stdout + commit.stderr;
    expect(out).toContain('QAgent reminder');
    expect(out).toContain('src/pages/Returns.jsx');
    expect(out).toMatch(/SendReturnLabelEmail/);
  });

  it('stays quiet on ordinary commits', () => {
    write('src/pages/A.jsx', 'export default () => <p>changed</p>;\n');
    git('add', '.');
    const commit = spawnSync('git', ['commit', '-m', 'tweak'], { cwd: repo, encoding: 'utf8' });
    expect(commit.status).toBe(0);
    expect(commit.stdout + commit.stderr).not.toContain('QAgent reminder');
  });

  it('never changes an existing pre-commit hook', () => {
    const hook = path.join(repo, '.git', 'hooks', 'pre-commit');
    fs.writeFileSync(hook, '#!/bin/sh\nnpx lint-staged\n');
    const s = installReminder(repo);
    expect(s.state).toBe('other-hook');
    expect(fs.readFileSync(hook, 'utf8')).toBe('#!/bin/sh\nnpx lint-staged\n');
  });
});
