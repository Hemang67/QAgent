import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { validateConfig } from '../src/main/project';
import { findSideEffectEndpoints, looksLikeSideEffect } from '../src/planner/side-effects';

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

describe('side-effect endpoints offered in setup', () => {
  it('flags actions that email, ship, book or charge', () => {
    for (const e of ['/api/email/send', '/SendTrackingReport', '/api/ups/ship', '/api/payments/charge', '/api/orders/:id/refund', '/api/shipments/:id/book', '/api/invoices/:param/void'])
      expect(looksLikeSideEffect(e), e).toBe(true);
  });

  it('ignores reads, assets and words that only start like an action', () => {
    for (const e of ['/api/payments/history', '/api/getShippingRates', '/api/orders', '/img/label.png', '/api/emails/list', '/dashboard', '/LabelDetails', '/api/shipment', '/booking'])
      expect(looksLikeSideEffect(e), e).toBe(false);
  });

  it('finds endpoints in code, skipping pages and ones already blocked', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qagent-se-'));
    dirs.push(root);
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(
      path.join(root, 'src', 'api.ts'),
      "export const a = () => post('/api/email/send');\nexport const b = () => post(`${base}/api/orders/${id}/refund`);\nconst c = '/api/ups/ship';\nconst page = '/shipping';",
    );
    const found = findSideEffectEndpoints(root, ['/shipping'], ['/api/ups/ship']).map((f) => f.endpoint);
    expect(found).toEqual(['/api/email/send', '/api/orders/:param/refund']);
  });
});

describe('.qagent.json validation', () => {
  it('accepts a full, valid config', () => {
    const fixture = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'fixtures', 'react-router-app', '.qagent.json'), 'utf8'));
    expect(validateConfig(fixture)).toEqual({ ok: true, errors: [] });
  });

  it('reports wrong types, unknown keys, bad URLs and bad allow rules', () => {
    const r = validateConfig({ workers: 'three', colour: 'blue', environments: { dev: { url: 'not a url' } }, readOnlyAllow: ['search'] });
    expect(r.ok).toBe(false);
    const text = r.errors.join('\n');
    expect(text).toMatch(/\/workers must be integer/);
    expect(text).toMatch(/additional properties: colour/);
    expect(text).toMatch(/\/environments\/dev\/url must match format "uri"/);
    expect(text).toMatch(/\/readOnlyAllow\/0 must match pattern/);
  });
});
