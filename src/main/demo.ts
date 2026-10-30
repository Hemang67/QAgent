import fs from 'fs';
import http from 'http';
import path from 'path';
import { app } from 'electron';

// The bundled demo shop the tour tests: copied to the app's data folder (so QAgent can
// write its settings and results next to it) and served on a free local port.
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };

let server: http.Server | null = null;
let url = '';

const source = () => (app.isPackaged ? path.join(process.resourcesPath, 'demo', 'site') : path.join(__dirname, '..', 'demo', 'site'));

const serve = (root: string) =>
  new Promise<string>((resolve, reject) => {
    server = http.createServer((req, res) => {
      const p = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
      const file = path.join(root, p === '/' ? 'index.html' : p);
      // Only files inside the demo folder
      if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        return res.end('<h1>Not found</h1>');
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const a = server!.address();
      resolve(`http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`);
    });
  });

/** A fresh copy of the demo project, served locally; returns its folder. */
export const startDemo = async () => {
  const root = path.join(app.getPath('userData'), 'demo-shop');
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  for (const f of fs.readdirSync(source())) fs.copyFileSync(path.join(source(), f), path.join(root, f));
  if (!server) url = await serve(root);
  const config = {
    framework: 'static',
    local: { url },
    login: { path: '/login' },
    lists: { smoke: [] },
    readiness: { readyTimeoutMs: 10000 },
  };
  fs.writeFileSync(path.join(root, '.qagent.json'), JSON.stringify(config, null, 2) + '\n');
  return root;
};

export const stopDemo = () => server?.close();
