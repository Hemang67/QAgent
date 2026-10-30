import fs from 'fs';
import path from 'path';
import type { Adapter } from '../types';
import { listFiles, packageJson, rel } from '../common';

/** A folder of HTML files with no framework: every .html file is a page. */
export const staticSite: Adapter = {
  id: 'static',
  label: 'Plain HTML',
  detect: (root) => fs.existsSync(path.join(root, 'index.html')) && !packageJson(root)?.dependencies,
  startCommand: () => ({ command: 'npx --yes http-server -p 8080 -c-1 .', url: 'http://localhost:8080' }),
  environments: () => ({}),
  routes: (root) =>
    listFiles(root, ['.html', '.htm'])
      .map((f) => {
        const r = rel(root, f);
        const p = '/' + r.replace(/(^|\/)index\.html?$/, '$1');
        return { path: p.length > 1 ? p.replace(/\/$/, '') || '/' : '/', file: r, params: [], source: 'filesystem' as const };
      })
      .sort((a, b) => a.path.localeCompare(b.path)),
};
