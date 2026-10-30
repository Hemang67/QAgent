import { describe, expect, it } from 'vitest';
import { decide, isGraphqlQuery, matchesAllow, matchesBlocked } from '../src/engine/guard';

const readOnly = { readOnly: true, blocked: ['/api/email/send', '/api/*/ship'], allow: ['POST /api/orders/search'] };
const writes = { ...readOnly, readOnly: false };

describe('safety guard', () => {
  it('lets read methods through in read-only runs', () => {
    for (const m of ['GET', 'HEAD', 'OPTIONS']) expect(decide(m, 'https://app.example.com/api/orders', null, readOnly).allow).toBe(true);
  });

  it('blocks every write method in read-only runs', () => {
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) expect(decide(m, 'https://app.example.com/api/orders', '{}', readOnly).allow).toBe(false);
  });

  it('blocks side-effect endpoints in every test type, GET included', () => {
    expect(decide('GET', 'https://app.example.com/API/Email/Send?to=x', null, readOnly).allow).toBe(false);
    expect(decide('POST', 'https://app.example.com/api/email/send', '{}', writes).allow).toBe(false);
    expect(decide('POST', 'https://app.example.com/api/ups/ship', '{}', writes).allow).toBe(false);
  });

  it('allows writes outside blocked endpoints when the type writes (CRUD)', () => {
    expect(decide('POST', 'https://app.example.com/api/colors', '{}', writes).allow).toBe(true);
  });

  it('allows listed read-only POST calls, matching method and exact path', () => {
    expect(decide('POST', 'https://app.example.com/api/orders/search', '{}', readOnly).allow).toBe(true);
    expect(decide('PUT', 'https://app.example.com/api/orders/search', '{}', readOnly).allow).toBe(false);
    expect(decide('POST', 'https://app.example.com/api/orders/search/delete', '{}', readOnly).allow).toBe(false);
    expect(matchesAllow('POST', '/api/customers/search', ['POST /api/*/search'])).toBe(true);
  });

  it('allows GraphQL queries but never mutations or subscriptions', () => {
    const q = (query: string) => JSON.stringify({ query });
    expect(isGraphqlQuery('/graphql', q('query Orders { orders { id } }'))).toBe(true);
    expect(isGraphqlQuery('/graphql', q('{ orders { id } }'))).toBe(true);
    expect(isGraphqlQuery('/graphql', q('mutation DeleteOrder { deleteOrder(id: 1) }'))).toBe(false);
    expect(isGraphqlQuery('/graphql', q('subscription S { orderAdded { id } }'))).toBe(false);
    // One mutation in a batch blocks the whole request
    expect(isGraphqlQuery('/graphql', JSON.stringify([{ query: '{ a }' }, { query: 'mutation { b }' }]))).toBe(false);
    // Persisted queries carry no text to check
    expect(isGraphqlQuery('/graphql', JSON.stringify({ extensions: { persistedQuery: { sha256Hash: 'x' } } }))).toBe(false);
    expect(isGraphqlQuery('/api/orders', q('{ a }'))).toBe(false);
    expect(decide('POST', 'https://app.example.com/graphql', q('{ orders { id } }'), readOnly).allow).toBe(true);
    expect(decide('POST', 'https://app.example.com/graphql', q('mutation { x }'), readOnly).allow).toBe(false);
  });

  it('matches blocked paths case-insensitively by substring or glob', () => {
    expect(matchesBlocked('/v2/api/email/send', ['/api/email/send'])).toBe(true);
    expect(matchesBlocked('/api/fedex/ship', ['/api/*/ship'])).toBe(true);
    expect(matchesBlocked('/api/orders', ['/api/email/send'])).toBe(false);
  });

  it('never blocks non-network URLs', () => {
    expect(decide('POST', 'data:text/plain,hi', null, readOnly).allow).toBe(true);
  });
});
