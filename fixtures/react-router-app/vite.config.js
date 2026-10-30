import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Mock API inside the dev server. Login: demo / demo.
const TOKEN = 'fixture-token';
const VIEWER = 'viewer-token';
const GUESTBOOK = [];
let loginAttempts = 0;
const COLORS = [{ id: 1, name: 'Red' }, { id: 2, name: 'Blue' }];
let nextColor = 3;
const ORDERS = [
  { id: 1, customer: 'Acme', status: 'open' },
  { id: 2, customer: 'Globex', status: 'closed' },
];

const json = (res, status, body) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
};

const readBody = (req) =>
  new Promise((resolve) => {
    let s = '';
    req.on('data', (c) => (s += c));
    req.on('end', () => resolve(s ? JSON.parse(s) : {}));
  });

const mockApi = {
  name: 'mock-api',
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      const url = new URL(req.url, 'http://x');
      // Planted flaws for the security scan
      if (url.pathname === '/.env') {
        res.setHeader('Content-Type', 'text/plain');
        return res.end('DB_HOST=localhost\nAPI_SECRET=fixture-fake-env-value\n');
      }
      if (url.pathname === '/lab/echo') {
        res.setHeader('Content-Type', 'text/html');
        return res.end(`<h1>Echo</h1><p>${url.searchParams.get('q')}</p>`);
      }
      if (url.pathname === '/lab/db') {
        res.setHeader('Content-Type', 'text/html');
        return res.end((url.searchParams.get('id') ?? '').includes("'") ? '<p>You have an error in your SQL syntax near line 1</p>' : '<p>Record 1</p>');
      }
      if (url.pathname === '/go') {
        res.statusCode = 302;
        res.setHeader('Location', url.searchParams.get('next') ?? '/');
        return res.end();
      }
      if (url.pathname === '/api/open-orders') return json(res, 200, ORDERS);
      if (url.pathname === '/api/test/state') return json(res, 200, { guestbook: GUESTBOOK.length, loginAttempts });
      if (!url.pathname.startsWith('/api/')) return next();
      if (url.pathname === '/api/login' && req.method === 'POST') {
        const b = await readBody(req);
        loginAttempts++;
        if (b.username === 'viewer' && b.password === 'viewer') return json(res, 200, { token: VIEWER });
        return b.username === 'demo' && b.password === 'demo' ? json(res, 200, { token: TOKEN }) : json(res, 401, { error: 'bad login' });
      }
      if (![`Bearer ${TOKEN}`, `Bearer ${VIEWER}`].includes(req.headers.authorization)) return json(res, 401, { error: 'no session' });
      if (url.pathname === '/api/guestbook' && req.method === 'GET') return json(res, 200, GUESTBOOK);
      if (url.pathname === '/api/guestbook' && req.method === 'POST') {
        GUESTBOOK.push((await readBody(req)).message);
        return json(res, 201, {});
      }
      if (url.pathname === '/api/orders') {
        const status = url.searchParams.get('status');
        return json(res, 200, status ? ORDERS.filter((o) => o.status === status) : ORDERS);
      }
      const one = /^\/api\/orders\/(\d+)$/.exec(url.pathname);
      if (one) return json(res, 200, ORDERS.find((o) => o.id === Number(one[1])) ?? null);
      if (url.pathname === '/api/customers') return json(res, 200, [{ id: 7, name: 'Acme' }]);
      if (url.pathname === '/api/broken') return json(res, 500, { error: 'boom' });
      if (url.pathname === '/api/hang') return; // never answers
      if (url.pathname === '/api/slow') return void setTimeout(() => json(res, 200, ORDERS), 3500);
      if (url.pathname === '/api/search' && req.method === 'POST') return json(res, 200, ORDERS);
      if (url.pathname === '/api/audit' && req.method === 'POST') return json(res, 200, { ok: true });
      if (url.pathname === '/api/email/send') return json(res, 200, { sent: true });
      // Test hook: back to the two starting colours
      if (url.pathname === '/api/test/reset' && req.method === 'POST') {
        GUESTBOOK.length = 0;
        loginAttempts = 0;
        COLORS.splice(0, COLORS.length, { id: 1, name: 'Red' }, { id: 2, name: 'Blue' });
        nextColor = 3;
        return json(res, 200, { ok: true });
      }
      if (url.pathname === '/api/colors' && req.method === 'GET') return json(res, 200, COLORS);
      if (url.pathname === '/api/colors' && req.method === 'POST') {
        const c = { id: nextColor++, name: (await readBody(req)).name };
        COLORS.push(c);
        return json(res, 201, c);
      }
      const color = /^\/api\/colors\/(\d+)$/.exec(url.pathname);
      if (color && req.method === 'PUT') {
        const c = COLORS.find((x) => x.id === Number(color[1]));
        if (c) c.name = (await readBody(req)).name;
        return json(res, c ? 200 : 404, c ?? {});
      }
      if (color && req.method === 'DELETE') {
        const i = COLORS.findIndex((x) => x.id === Number(color[1]));
        if (i >= 0) COLORS.splice(i, 1);
        return json(res, i >= 0 ? 200 : 404, {});
      }
      return json(res, 404, { error: 'not found' });
    });
  },
};

export default defineConfig({
  plugins: [react(), mockApi],
  server: { port: 5179, strictPort: true },
});
