import path from 'path';
import { describe, expect, it } from 'vitest';
import { buildPlan, inspectProject, planPage } from '../src/planner/plan';
import type { RouteInfo } from '../src/shared/types';

const route = (p: string, params: string[]): RouteInfo => ({ path: p, params, source: 'router' });

describe('planning a page', () => {
  it('fills path and query IDs from test data, using the configured key', () => {
    const p = planPage(route('/orders/:id', ['id', '?tab']), 'https://app.example.com', { pages: { '/orders/:id': { params: { id: 'orderId' } } } }, { orderId: 42, tab: 'items' }, 'dev');
    expect(p.url).toBe('https://app.example.com/orders/42?tab=items');
  });

  it('leaves a page unverified, with the file to edit, when an ID is missing', () => {
    const p = planPage(route('/customer', ['?customerId']), 'https://app.example.com', {}, {}, 'test');
    expect(p.url).toBeNull();
    expect(p.missing).toContain('customerId');
    expect(p.missing).toContain('.qagent/test-data.test.json');
  });

  it('keeps configured skips', () => {
    const p = planPage(route('/admin/reindex', []), 'https://app.example.com', { pages: { '/admin/reindex': { skip: 'Long job' } } }, {}, 'dev');
    expect(p.skip).toBe('Long job');
  });
});

describe('building a run plan', () => {
  const info = inspectProject(path.resolve(__dirname, '..', 'fixtures', 'react-router-app'));

  it('refuses CRUD on Live', () => {
    const live = { ...info, urls: { ...info.urls, live: { url: 'https://app.example.com' } } };
    expect(() => buildPlan(live, { envs: ['live'], types: ['crud'], logins: {} })).toThrow();
  });

  it('refuses environments without a URL', () => {
    expect(() => buildPlan(info, { envs: ['live'], types: ['smoke'], logins: {} })).toThrow(/No URL for live/);
  });

  it('plans one job per environment × type and leaves the login page out', () => {
    const plan = buildPlan(info, { envs: ['local'], types: ['smoke', 'regression'], logins: { local: { mode: 'skip' } } });
    expect(plan.jobs.map((j) => j.type)).toEqual(['smoke', 'regression']);
    expect(plan.jobs[1].pages.some((p) => p.route === '/login')).toBe(false);
    expect(plan.readOnlyAllow).toEqual(['POST /api/search']);
    expect(plan.logins.local).toMatchObject({ mode: 'skip', loginPath: '/login', loggedInPath: '/dashboard' });
  });

  it('never writes credentials anywhere but the plan object itself', () => {
    const plan = buildPlan(info, { envs: ['local'], types: ['smoke'], logins: { local: { mode: 'credentials', username: 'u', password: 'p' } } });
    expect(plan.logins.local?.password).toBe('p');
    expect(plan.fallbackDir).toContain(path.join('.qagent', 'results'));
  });
});
