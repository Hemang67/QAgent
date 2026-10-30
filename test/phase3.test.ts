import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { PNG } from 'pngjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { routeMatcher } from '../src/engine/checks/links';
import { checkPerf } from '../src/engine/checks/perf';
import { approveBaselines, baselinePaths, checkVisual } from '../src/engine/checks/visual';
import { changeImpact } from '../src/planner/impact';
import { detectAdapter } from '../src/adapters';
import { DEFAULT_BUDGETS } from '../src/shared/config';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qagent-p3-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('broken links: known routes', () => {
  it('matches paths against route patterns, including parameters', () => {
    const known = routeMatcher(['/', '/orders', '/orders/:id', '/users/:id/edit', '/docs/:page?']);
    expect(known('/orders/42')).toBe(true);
    expect(known('/users/7/edit')).toBe(true);
    expect(known('/docs')).toBe(true);
    expect(known('/Orders/')).toBe(true);
    expect(known('/no-such-page')).toBe(false);
    expect(known('/orders/42/extra')).toBe(false);
  });
});

describe('performance budgets', () => {
  it('fails over the fail budget, warns over the others', () => {
    const p = checkPerf({ loadToReadyMs: 16000, lcpMs: 4500, apiCalls: 2, slowestApi: null }, [{ method: 'GET', url: '/api/a', ms: 3500 }, { method: 'GET', url: '/api/b', ms: 100 }], DEFAULT_BUDGETS);
    expect(p.map((x) => `${x.type}:${x.severity}`)).toEqual(['perf-ready-over-budget:error', 'perf-lcp-slow:warning', 'perf-api-slow:warning']);
    expect(checkPerf({ loadToReadyMs: 6000, lcpMs: null, apiCalls: 0, slowestApi: null }, [], DEFAULT_BUDGETS).map((x) => x.severity)).toEqual(['warning']);
    expect(checkPerf({ loadToReadyMs: 900, lcpMs: 800, apiCalls: 1, slowestApi: null }, [], DEFAULT_BUDGETS)).toEqual([]);
  });
});

describe('visual change', () => {
  const png = (w: number, h: number, paint?: (x: number, y: number) => boolean) => {
    const img = new PNG({ width: w, height: h });
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const on = paint?.(x, y);
        img.data[i] = on ? 255 : 20;
        img.data[i + 1] = on ? 0 : 20;
        img.data[i + 2] = 20;
        img.data[i + 3] = 255;
      }
    return PNG.sync.write(img);
  };
  // Only screenshot() and locator() are used by the check
  const fakePage = (shot: Buffer) => ({ screenshot: async () => shot, locator: () => ({}) }) as any;
  const v = { threshold: 0.01, mask: [], dir: path.join(tmp, 'baselines') };

  it('saves a baseline first, then passes an identical page', async () => {
    const first = await checkVisual(fakePage(png(100, 100)), 'dev', '/orders', v);
    expect(first[0].type).toBe('baseline-saved');
    expect(await checkVisual(fakePage(png(100, 100)), 'dev', '/orders', v)).toEqual([]);
  });

  it('fails a change over the threshold and keeps the new screenshot and a diff until approved', async () => {
    const changed = png(100, 100, (x, y) => x < 20 && y < 20); // 4 % of pixels
    const p = await checkVisual(fakePage(changed), 'dev', '/orders', v);
    expect(p[0]).toMatchObject({ type: 'visual-change', severity: 'error' });
    const f = baselinePaths(v.dir, 'dev', '/orders');
    expect(fs.existsSync(f.latest) && fs.existsSync(f.diff)).toBe(true);
    expect(approveBaselines(v.dir, 'dev')).toBe(1);
    expect(fs.existsSync(f.latest) || fs.existsSync(f.diff)).toBe(false);
    expect(await checkVisual(fakePage(changed), 'dev', '/orders', v)).toEqual([]);
  });

  it('tolerates changes under the threshold, and reports a size change', async () => {
    const tiny = png(100, 100, (x, y) => x < 20 && y < 20 && !(x < 2 && y < 2)); // 0.04 % differs from the approved image
    expect((await checkVisual(fakePage(tiny), 'dev', '/orders', v))[0]?.severity ?? 'none').not.toBe('error');
    expect((await checkVisual(fakePage(png(100, 140)), 'dev', '/orders', v))[0].type).toBe('visual-size-changed');
  });
});

describe('change-impact', () => {
  const repo = path.join(tmp, 'repo');
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' }).toString();
  const write = (rel: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    fs.writeFileSync(path.join(repo, rel), text);
  };
  const impact = () => {
    const routes = detectAdapter(repo).routes(repo);
    const r = changeImpact(repo, routes, 'main');
    return r.routes === 'all' ? 'all' : [...r.routes].sort();
  };

  beforeAll(() => {
    fs.mkdirSync(repo, { recursive: true });
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 'Test');
    write('package.json', JSON.stringify({ dependencies: { 'react-router-dom': '6' } }));
    write('src/routes.js', "export const R = { a: '/a', b: '/b', c: '/c' };\n");
    write('src/router.jsx', "import { R } from './routes';\nimport A from './pages/A';\nimport B from './pages/B';\nimport C from './pages/C';\nexport const router = createBrowserRouter([\n  { path: R.a, element: <A /> },\n  { path: R.b, element: <B /> },\n  { path: R.c, element: <C /> },\n]);\n");
    write('src/format.js', "export const money = (n) => `$${n}`;\n");
    write('src/Table.jsx', "import { money } from './format';\nexport default () => money(1);\n");
    write('src/pages/A.jsx', "import Table from '../Table';\nexport default () => <Table />;\n");
    write('src/pages/B.jsx', "import { money } from '../format';\nexport default () => money(2);\n");
    write('src/pages/C.jsx', 'export default () => null;\n');
    git('add', '.');
    git('commit', '-q', '-m', 'base');
    git('checkout', '-q', '-b', 'feature');
  });

  const reset = () => {
    git('checkout', '-q', '--', '.');
    git('clean', '-fdq');
  };

  it('a page file → that page', () => {
    write('src/pages/C.jsx', 'export default () => <p>changed</p>;\n');
    expect(impact()).toEqual(['/c']);
    reset();
  });

  it('an edited shared file → every page importing it, directly or not', () => {
    write('src/format.js', "export const money = (n) => `USD ${n}`;\n");
    expect(impact()).toEqual(['/a', '/b']);
    reset();
  });

  it('a shared file that only gained an export → only pages using the new name', () => {
    fs.appendFileSync(path.join(repo, 'src/format.js'), 'export const percent = (n) => `${n}%`;\n');
    write('src/pages/C.jsx', "import { percent } from '../format';\nexport default () => percent(1);\n");
    // C uses the new name (and changed itself); A and B use only the old one
    expect(impact()).toEqual(['/c']);
    reset();
  });

  it('only new routes added → only the new pages', () => {
    fs.appendFileSync(path.join(repo, 'src/routes.js'), "export const R2 = { d: '/d' };\n");
    write('src/pages/D.jsx', 'export default () => null;\n');
    const router = fs.readFileSync(path.join(repo, 'src/router.jsx'), 'utf8');
    write('src/router.jsx', router.replace("import C from './pages/C';", "import C from './pages/C';\nimport D from './pages/D';").replace('  { path: R.c, element: <C /> },', "  { path: R.c, element: <C /> },\n  { path: '/d', element: <D /> },"));
    expect(impact()).toEqual(['/d']);
    reset();
  });

  it('package.json or the app shell → every page', () => {
    write('package.json', JSON.stringify({ dependencies: { 'react-router-dom': '6', lodash: '4' } }));
    expect(impact()).toBe('all');
    reset();
  });

  it('nothing changed → no pages', () => {
    expect(impact()).toEqual([]);
  });

  it('server code: a page\'s own file → its pages; any other server file → every page', () => {
    const flask = path.join(tmp, 'flask');
    const g = (...args: string[]) => execFileSync('git', args, { cwd: flask, stdio: 'pipe' }).toString();
    fs.mkdirSync(flask, { recursive: true });
    g('init', '-q', '-b', 'main');
    g('config', 'user.email', 't@example.com');
    g('config', 'user.name', 'Test');
    fs.writeFileSync(path.join(flask, 'requirements.txt'), 'flask\n');
    fs.writeFileSync(path.join(flask, 'app.py'), "from shop import admin\n@app.route('/')\ndef home(): pass\n");
    fs.mkdirSync(path.join(flask, 'shop'));
    fs.writeFileSync(path.join(flask, 'shop', 'admin.py'), "bp = Blueprint('a', __name__, url_prefix='/admin')\n@bp.route('/users')\ndef users(): pass\n");
    fs.writeFileSync(path.join(flask, 'shop', 'models.py'), 'class Order: pass\n');
    g('add', '.');
    g('commit', '-q', '-m', 'base');
    const run = () => {
      const r = changeImpact(flask, detectAdapter(flask).routes(flask), 'main');
      return r.routes === 'all' ? 'all' : [...r.routes].sort();
    };
    fs.appendFileSync(path.join(flask, 'shop', 'admin.py'), '# tweak\n');
    expect(run()).toEqual(['/admin/users']);
    g('checkout', '-q', '--', '.');
    fs.appendFileSync(path.join(flask, 'shop', 'models.py'), 'class Invoice: pass\n');
    expect(run()).toBe('all');
    g('checkout', '-q', '--', '.');
    fs.writeFileSync(path.join(flask, 'requirements.txt'), 'flask\nrequests\n');
    expect(run()).toBe('all');
  });

  it('a missing base branch is explained', () => {
    expect(() => changeImpact(repo, [], 'origin/nope')).not.toThrow(); // falls back to main
    git('branch', '-m', 'main', 'trunk');
    expect(() => changeImpact(repo, [], 'origin/nope')).toThrow(/run git fetch/);
    git('branch', '-m', 'trunk', 'main');
  });
});
