import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { detectAdapter } from '../src/adapters';
import { envUrlsFromDotEnv, readDotEnv } from '../src/adapters/common';

const FIXTURES = path.resolve(__dirname, '..', 'fixtures');
const tmpDirs: string[] = [];

/** A throwaway project from a map of relative path → file content. */
const project = (files: Record<string, string>) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qagent-test-'));
  tmpDirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  return dir;
};

afterAll(() => tmpDirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

const routesOf = (root: string) => detectAdapter(root).routes(root);

describe('React Router adapter', () => {
  it('reads the fixture: constants, lazy pages, nesting, params, catch-all ignored', () => {
    const root = path.join(FIXTURES, 'react-router-app');
    const routes = routesOf(root);
    const byPath = Object.fromEntries(routes.map((r) => [r.path, r]));
    expect(detectAdapter(root).id).toBe('react-router');
    expect(Object.keys(byPath)).toEqual(
      ['/', '/admin', '/audit', '/colors', '/crash', '/customer', '/dashboard', '/guestbook', '/hang', '/links', '/login', '/logout', '/orders', '/orders/:orderId', '/reports', '/search', '/sec', '/settings/profile', '/slow', '/stuck', '/wide'],
    );
    expect(byPath['/reports'].file).toBe('src/pages/Reports.jsx'); // React.lazy import
    expect(byPath['/orders/:orderId'].params).toEqual(['orderId']);
    expect(byPath['/customer'].params).toEqual(['?customerId']);
  });

  it('reads nested <Route> JSX and resolves tsconfig baseUrl imports', () => {
    const root = project({
      'package.json': JSON.stringify({ dependencies: { 'react-router-dom': '6' } }),
      'tsconfig.json': JSON.stringify({ compilerOptions: { baseUrl: 'src' } }),
      'src/App.tsx': `
        import { Routes, Route } from 'react-router-dom';
        import Shell from 'components/Shell';
        import Users from 'pages/Users';
        import UserEdit from 'pages/UserEdit';
        const P = { users: '/users' } as const;
        export default () => (
          <Routes>
            <Route path="/" element={<Shell />}>
              <Route path={P.users} element={<Users />}>
                <Route path=":userId/edit" element={<Guard><UserEdit /></Guard>} />
              </Route>
              <Route path="*" element={<p>404</p>} />
            </Route>
          </Routes>
        );`,
      'src/components/Shell.tsx': 'export default () => null;',
      'src/pages/Users.tsx': 'export default () => null;',
      'src/pages/UserEdit.tsx': 'export default () => null;',
    });
    const routes = routesOf(root);
    expect(routes.map((r) => r.path)).toEqual(['/', '/users', '/users/:userId/edit']);
    // The page inside a guard component is preferred over the guard
    expect(routes.find((r) => r.path === '/users/:userId/edit')?.file).toBe('src/pages/UserEdit.tsx');
  });

  it('only treats ID-like query parameters as required', () => {
    const root = project({
      'package.json': JSON.stringify({ dependencies: { 'react-router-dom': '6' } }),
      'src/main.jsx': `import P from './pages/P';\ncreateBrowserRouter([{ path: '/p', element: <P /> }]);`,
      'src/pages/P.jsx': `const a = searchParams.get('tab'); const b = searchParams.get('invoiceId'); const c = params.get('id');`,
    });
    expect(routesOf(root)[0].params).toEqual(['?invoiceId', '?id']);
  });
});

describe('Next.js adapter', () => {
  it('reads app and pages routers: groups, private folders, dynamic segments', () => {
    const root = path.join(FIXTURES, 'nextjs-app');
    expect(detectAdapter(root).id).toBe('nextjs');
    const routes = routesOf(root);
    expect(routes.map((r) => r.path)).toEqual(['/', '/about', '/admin', '/broken', '/dashboard', '/invoice', '/legacy', '/login', '/logout', '/products/:id']);
    expect(routes.find((r) => r.path === '/about')?.file).toBe('app/(marketing)/about/page.jsx');
    expect(routes.find((r) => r.path === '/invoice')?.params).toEqual(['?invoiceId']);
  });

  it('handles catch-all and optional catch-all segments, and skips API and special pages', () => {
    const root = project({
      'package.json': JSON.stringify({ dependencies: { next: '15' } }),
      'pages/_app.tsx': '',
      'pages/api/x.ts': '',
      'pages/docs/[...slug].tsx': '',
      'pages/blog/[[...slug]].tsx': '',
      'pages/index.tsx': '',
      'src/app/@modal/page.tsx': '',
    });
    expect(routesOf(root).map((r) => r.path)).toEqual(['/', '/blog', '/docs/:slug']);
  });
});

describe('environment files', () => {
  it('parses `KEY = "value";` as some projects write it', () => {
    const root = project({ '.env.test': 'REACT_APP_BASE_URL = "https://test.example.com/";\n# comment\nexport FOO=bar' });
    expect(readDotEnv(path.join(root, '.env.test'))).toEqual({ REACT_APP_BASE_URL: 'https://test.example.com/', FOO: 'bar' });
  });

  it('maps files to environments and tells the site from the API', () => {
    const root = project({
      '.env.local': 'VITE_BASE_URL=http://localhost:5173\nVITE_API_URL=http://localhost:5000/api',
      '.env.development': 'VITE_APP_URL=https://dev.example.com\nVITE_SIGNALR_URL=https://dev.example.com/hub',
      '.env.production': 'NEXT_PUBLIC_SITE_URL=https://example.com\nNEXT_PUBLIC_API_URL=https://api.example.com/v1',
      '.env.example': 'VITE_BASE_URL=https://ignored.example.com',
    });
    expect(envUrlsFromDotEnv(root)).toEqual({
      local: { url: 'http://localhost:5173', apiUrl: 'http://localhost:5000', from: '.env.local' },
      dev: { url: 'https://dev.example.com', from: '.env.development' },
      live: { url: 'https://example.com', apiUrl: 'https://api.example.com', from: '.env.production' },
    });
  });
});

describe('fallback', () => {
  it('uses the crawler for unknown projects', () => {
    const root = project({ 'README.md': 'A site served by something QAgent does not know' });
    expect(detectAdapter(root).id).toBe('crawl');
    expect(routesOf(root)).toEqual([]);
  });
});
