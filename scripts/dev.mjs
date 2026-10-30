// npm run dev: UI with hot reload (Vite), main/preload/engine rebuilt on save,
// Electron restarted when the main process or preload changes.
import { spawn } from 'child_process';
import { createRequire } from 'module';
import { context } from 'esbuild';
import { createServer } from 'vite';
import { entries } from './build.mjs';

const electronPath = createRequire(import.meta.url)('electron');
const server = await createServer({ configFile: 'vite.config.mts' });
await server.listen();
const url = server.resolvedUrls.local[0];

let app = null;
const restart = () => {
  if (app) {
    app.removeAllListeners('exit');
    app.kill();
  }
  // Hosts such as VS Code set ELECTRON_RUN_AS_NODE; Electron would then start as plain Node
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  app = spawn(electronPath, ['.', ...process.argv.slice(2)], { stdio: 'inherit', env: { ...env, VITE_DEV_SERVER_URL: url } });
  app.on('exit', () => process.exit(0));
};

let timer = null;
const restartSoon = { name: 'restart', setup: (b) => b.onEnd(() => (clearTimeout(timer), (timer = setTimeout(restart, 200)))) };
for (const e of entries) {
  const watchesApp = e.outfile.endsWith('main.js') || e.outfile.endsWith('preload.js');
  const ctx = await context({ ...e, plugins: watchesApp ? [restartSoon] : [] });
  await ctx.watch();
}
console.log(`UI on ${url}; Electron restarts when the main process changes`);
