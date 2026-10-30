/**
 * Decides which requests the browser may send. Pure functions, so the safety
 * rules are unit-tested without a browser.
 *
 *  1. Blocked endpoints (email, ship, charge…) never go out, in any test type.
 *  2. Read-only runs let through only GET, HEAD and OPTIONS, plus GraphQL
 *     queries (never mutations) and calls the project lists in readOnlyAllow.
 */

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const globToRegex = (glob: string) =>
  new RegExp('^' + glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$', 'i');

/** `/api/email/send` matches any URL whose path contains it (case-insensitive). */
export const matchesBlocked = (pathname: string, patterns: string[]) =>
  patterns.some((p) => (p.includes('*') ? globToRegex(p).test(pathname) : pathname.toLowerCase().includes(p.toLowerCase())));

/** `POST /api/orders/search` or `POST /api/*\/search`: method and path both match. */
export const matchesAllow = (method: string, pathname: string, rules: string[]) =>
  rules.some((r) => {
    const m = /^([A-Z]+)\s+(\S+)$/.exec(r.trim());
    if (!m || m[1] !== method) return false;
    return m[2].includes('*') ? globToRegex(m[2]).test(pathname) : pathname.toLowerCase() === m[2].toLowerCase();
  });

/** True for a GraphQL POST whose operations are all queries (no mutation or subscription). */
export const isGraphqlQuery = (pathname: string, body: string | null) => {
  if (!body || !/graphql/i.test(pathname)) return false;
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return false;
  }
  const ops = Array.isArray(payload) ? payload : [payload];
  return (
    ops.length > 0 &&
    ops.every((op: any) => {
      if (typeof op?.query !== 'string') return false; // persisted queries: unknown, keep blocked
      const doc = op.query.replace(/#[^\n]*/g, '');
      return !/\b(mutation|subscription)\b\s*[\w({@]/.test(doc);
    })
  );
};

export type Decision = { allow: true } | { allow: false; reason: string };

export const decide = (
  method: string,
  url: string,
  body: string | null,
  opts: { readOnly: boolean; blocked: string[]; allow: string[] },
): Decision => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { allow: true };
  }
  // data:, blob: and similar never reach a server
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { allow: true };
  const pathname = parsed.pathname;
  if (matchesBlocked(pathname, opts.blocked)) return { allow: false, reason: 'Blocked endpoint (side effect outside the app) — never called' };
  if (!opts.readOnly || READ_METHODS.has(method)) return { allow: true };
  if (method === 'POST' && isGraphqlQuery(pathname, body)) return { allow: true };
  if (matchesAllow(method, pathname, opts.allow)) return { allow: true };
  return { allow: false, reason: `${method} blocked: this test type is read-only` };
};
