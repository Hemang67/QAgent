import fs from 'fs';
import path from 'path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import type { Page } from 'playwright-core';
import type { EnvName, Problem, VisualSettings } from '../../shared/types';

/** File-safe name for a page: /orders/:id?tab=1 → orders_id_tab-1 */
export const slug = (route: string) => route.replace(/^\/+/, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'home';

export const baselinePaths = (dir: string, env: EnvName, route: string) => {
  const base = path.join(dir, env, slug(route));
  return { baseline: `${base}.png`, latest: `${base}.new.png`, diff: `${base}.diff.png` };
};

/**
 * Compares a screenshot of the page with its approved baseline. The first run
 * saves the baseline. A change over the threshold fails the page and keeps the
 * new screenshot and a diff image next to the baseline until it is approved.
 */
export const checkVisual = async (page: Page, env: EnvName, route: string, v: VisualSettings): Promise<Problem[]> => {
  const files = baselinePaths(v.dir, env, route);
  fs.mkdirSync(path.dirname(files.baseline), { recursive: true });
  const shot = await page.screenshot({
    fullPage: true,
    animations: 'disabled',
    caret: 'hide',
    mask: v.mask.map((m) => page.locator(m)),
    timeout: 30_000,
  });

  if (!fs.existsSync(files.baseline)) {
    fs.writeFileSync(files.baseline, shot);
    return [{ type: 'baseline-saved', severity: 'info', detail: `First screenshot saved as the baseline (${path.basename(files.baseline)})` }];
  }

  const before = PNG.sync.read(fs.readFileSync(files.baseline));
  const now = PNG.sync.read(shot);
  if (before.width !== now.width || before.height !== now.height) {
    fs.writeFileSync(files.latest, shot);
    fs.rmSync(files.diff, { force: true });
    return [{ type: 'visual-size-changed', severity: 'error', detail: `The page is ${now.width}×${now.height}px, the baseline ${before.width}×${before.height}px. Approve the new screenshot if this is intended.` }];
  }
  const diff = new PNG({ width: now.width, height: now.height });
  const changed = pixelmatch(before.data, now.data, diff.data, now.width, now.height, { threshold: 0.1 });
  const share = changed / (now.width * now.height);
  if (share <= v.threshold) {
    fs.rmSync(files.latest, { force: true });
    fs.rmSync(files.diff, { force: true });
    return share > 0 ? [{ type: 'visual-minor-change', severity: 'info', detail: `${(share * 100).toFixed(2)}% of pixels changed (allowed ${(v.threshold * 100).toFixed(2)}%)` }] : [];
  }
  fs.writeFileSync(files.latest, shot);
  fs.writeFileSync(files.diff, PNG.sync.write(diff));
  return [{ type: 'visual-change', severity: 'error', detail: `${(share * 100).toFixed(2)}% of pixels changed (allowed ${(v.threshold * 100).toFixed(2)}%). Diff: ${path.relative(path.dirname(v.dir), files.diff)}` }];
};

/** Accepts the latest screenshots as the new baselines; returns how many were approved. */
export const approveBaselines = (dir: string, env?: EnvName) => {
  let n = 0;
  const envs = env ? [env] : fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  for (const e of envs) {
    const d = path.join(dir, e);
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d).filter((x) => x.endsWith('.new.png'))) {
      fs.renameSync(path.join(d, f), path.join(d, f.replace(/\.new\.png$/, '.png')));
      fs.rmSync(path.join(d, f.replace(/\.new\.png$/, '.diff.png')), { force: true });
      n++;
    }
  }
  return n;
};

/** Screenshots waiting for approval, across environments. */
export const countPending = (dir: string) => {
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).reduce((n, e) => {
    const d = path.join(dir, e);
    return n + (fs.statSync(d).isDirectory() ? fs.readdirSync(d).filter((f) => f.endsWith('.new.png')).length : 0);
  }, 0);
};
