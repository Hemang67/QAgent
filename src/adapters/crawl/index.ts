import fs from 'fs';
import path from 'path';
import type { Adapter } from '../types';
import { devScript, npmRun } from '../common';

/**
 * Fallback for anything unrecognised. Pages are found at run time by the
 * engine's crawler (same-domain links from the home page), so `routes` is empty.
 */
export const crawl: Adapter = {
  id: 'crawl',
  label: 'Other (crawl the running site)',
  detect: () => true,
  startCommand(root) {
    const script = devScript(root);
    if (script) return { command: npmRun(script), url: 'http://localhost:3000' };
    if (fs.existsSync(path.join(root, 'index.html'))) return { command: 'npx --yes http-server -p 8080 -c-1 .', url: 'http://localhost:8080' };
    return null;
  },
  environments: () => ({}),
  routes: () => [],
};
