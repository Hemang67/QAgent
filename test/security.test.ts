import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { isFullScan, looksBlocked, rateFor, SafeClient, ScanBlocked } from '../src/engine/security/client';
import { checkSecrets, mask } from '../src/engine/security/project';
import { BUILD_ASSET } from '../src/engine/security/passive';
import { buildPlan, inspectProject } from '../src/planner/plan';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qagent-sec-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const fake = (status: number, headers: Record<string, string> = {}, body = 'ok') => {
  const calls: string[] = [];
  const request = { get: async (url: string) => (calls.push(url), { status: () => status, headers: () => headers, text: async () => body }) };
  return { request: request as any, calls };
};
const OWN = ['https://app.example.com'];

describe('safe client', () => {
  it('never sends requests to other domains or blocked endpoints', async () => {
    const f = fake(200);
    const c = new SafeClient(f.request, OWN, ['/api/email/send'], 1000);
    expect(await c.get('https://other.example.org/x')).toBeNull();
    expect(await c.get('https://app.example.com/api/email/send')).toBeNull();
    expect(f.calls).toEqual([]);
    expect(await c.get('https://app.example.com/ok')).not.toBeNull();
    expect(f.calls).toHaveLength(1);
  });

  it('stops every later request after the first sign of a firewall', async () => {
    const f = fake(429);
    const c = new SafeClient(f.request, OWN, [], 1000);
    await expect(c.get('https://app.example.com/a')).rejects.toBeInstanceOf(ScanBlocked);
    await expect(c.get('https://app.example.com/b')).rejects.toBeInstanceOf(ScanBlocked);
    expect(f.calls).toHaveLength(1);
  });

  it('spaces requests out', async () => {
    const c = new SafeClient(fake(200).request, OWN, [], 20);
    const t = Date.now();
    for (let i = 0; i < 3; i++) await c.get('https://app.example.com/x');
    expect(Date.now() - t).toBeGreaterThanOrEqual(90);
  });

  it('tells a firewall from an ordinary denied page', () => {
    expect(looksBlocked(429, {}, '')).toBe(true);
    expect(looksBlocked(403, { 'cf-mitigated': 'challenge' }, '')).toBe(true);
    expect(looksBlocked(403, {}, 'Attack detected')).toBe(true);
    expect(looksBlocked(403, {}, 'You may not open this page')).toBe(false);
    expect(looksBlocked(404, {}, 'captcha')).toBe(false);
  });

  it('is gentlest on Live, and full scans are Local and Dev only', () => {
    expect(rateFor('live')).toBe(2);
    expect(['local', 'dev', 'test', 'live'].filter((e) => isFullScan(e as any))).toEqual(['local', 'dev']);
  });
});

describe('secrets in code', () => {
  it('finds keys, masks values, skips placeholders and environment lookups', async () => {
    const root = path.join(dir, 'p');
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'a.js'), `const password = "hunter2-real-value";\nconst token = "ghp_${'a'.repeat(36)}";`);
    fs.writeFileSync(path.join(root, 'src', 'b.js'), 'const password = "your-password-here";\nconst apiKey = process.env.KEY;\nconst secret = "${SECRET_VALUE}";');
    fs.writeFileSync(path.join(root, '.env'), 'API_SECRET=real-env-value-1\nAPP_NAME=shop\nDB_PASSWORD=changeme\n');
    const found = await checkSecrets(root);
    expect(found.map((f) => f.url).sort()).toEqual(['.env:1', 'src/a.js:1', 'src/a.js:2']);
    expect(JSON.stringify(found)).not.toMatch(/hunter2-real-value|real-env-value-1|aaaaaaaaaa/);
    expect(mask('abcdefghijkl')).toBe('abcd********');
  });
});

describe('planning the scan', () => {
  const info = inspectProject(path.resolve(__dirname, '..', 'fixtures', 'react-router-app'));
  const live = { ...info, urls: { ...info.urls, live: { url: 'https://app.example.com' } } };

  it('refuses Live without LIVE SECURITY typed', () => {
    expect(() => buildPlan(live, { envs: ['live'], types: ['security'], logins: {} })).toThrow(/LIVE SECURITY/);
    expect(() => buildPlan(live, { envs: ['live'], types: ['security'], logins: {}, confirmLiveSecurity: 'LIVE' })).toThrow(/LIVE SECURITY/);
    expect(buildPlan(live, { envs: ['live'], types: ['security'], logins: {}, confirmLiveSecurity: 'LIVE SECURITY' }).jobs).toHaveLength(1);
  });
});

describe('logged-out access', () => {
  it('does not treat framework and build files as app data', () => {
    for (const p of ['/_next/static/development/_devPagesManifest.json', '/_next/static/webpack/abc.webpack.hot-update.json', '/@vite/client', '/node_modules/.vite/deps/react.js', '/assets/index-abc.js', '/manifest.json'])
      expect(BUILD_ASSET.test(p), p).toBe(true);
    for (const p of ['/api/items', '/api/orders/1', '/graphql', '/data/manifests']) expect(BUILD_ASSET.test(p), p).toBe(false);
  });
});
