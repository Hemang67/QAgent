// Builds everything into dist/:
//   main.js     Electron main process        preload.js  window bridge
//   engine.js   test engine (separate process) cli.js     dev/CI command line
//   ui/         the window (Vite)
// playwright-core and exceljs stay external: they load their own files at runtime.
import fs from 'fs';
import { build } from 'esbuild';
import { build as viteBuild } from 'vite';

const node = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: true,
  external: ['electron', 'electron-updater', 'playwright-core', 'exceljs', '@axe-core/playwright'],
  logLevel: 'warning',
};

export const entries = [
  { entryPoints: ['src/main/main.ts'], outfile: 'dist/main.js' },
  { entryPoints: ['src/preload/preload.ts'], outfile: 'dist/preload.js' },
  { entryPoints: ['src/engine/main.ts'], outfile: 'dist/engine.js' },
  { entryPoints: ['src/cli.ts'], outfile: 'dist/cli.js' },
].map((e) => ({ ...node, ...e }));

if (process.argv[1].endsWith('build.mjs')) {
  await Promise.all(entries.map((e) => build(e)));
  if (!process.argv.includes('--no-ui')) await viteBuild({ configFile: 'vite.config.mts', logLevel: 'warn' });
  // "What's new" reads the release notes from inside the app
  fs.copyFileSync('CHANGELOG.md', 'dist/CHANGELOG.md');
  console.log('Built dist/ (main, preload, engine, cli, ui)');
}
