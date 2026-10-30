import fs from 'fs';
import path from 'path';
import { CODE_EXT, listFiles, rel } from '../adapters/common';
import { SIDE_EFFECT_WORDS } from '../shared/config';
import type { EndpointCandidate } from '../shared/ipc';

// Endpoints named like these only read
const READ_WORDS = new Set(['get', 'list', 'fetch', 'load', 'search', 'find', 'read', 'view', 'preview', 'download', 'status', 'history', 'details', 'detail', 'lookup', 'count']);
const ASSET = /\.(png|jpe?g|gif|svg|webp|ico|css|js|tsx?|jsx|json|html?|woff2?|ttf|map)$/i;

const words = (segment: string) =>
  segment
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s\-_.]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());

/** True for a path whose last meaningful segment names an action with an effect outside the app. */
export const looksLikeSideEffect = (endpoint: string) => {
  const segments = endpoint.split(/[/?]/).filter((s) => s && !s.startsWith(':') && !s.startsWith('{') && !s.startsWith('$'));
  const last = segments[segments.length - 1];
  if (!last || ASSET.test(last)) return false;
  const w = segments.flatMap(words);
  if (words(last).some((x) => READ_WORDS.has(x))) return false;
  // Whole words only: "ship" and "ships", not "shipDate" or "shipment"
  return w.some((x) => SIDE_EFFECT_WORDS.some((s) => x === s || x === `${s}s` || x === `${s}es`));
};

/**
 * API paths in the project's code that may email, ship, book or charge.
 * Setup offers them as endpoints to block; the user decides.
 */
export const findSideEffectEndpoints = (root: string, routes: string[], alreadyBlocked: string[]): EndpointCandidate[] => {
  const srcDir = fs.existsSync(path.join(root, 'src')) ? path.join(root, 'src') : root;
  const pages = new Set(routes.map((r) => r.toLowerCase()));
  const blocked = alreadyBlocked.map((b) => b.toLowerCase());
  const found = new Map<string, string>();
  for (const file of listFiles(srcDir, CODE_EXT)) {
    let text: string;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    if (text.length > 500_000) continue; // generated bundles
    // '/api/x', 'https://host/api/x', and template strings that start with a base: `${API}/x/${id}`
    for (const m of text.matchAll(/['"`]((?:https?:\/\/[^'"`\s]+?|\$\{[^}`]+\})?\/[A-Za-z0-9_\-/{}:$.]{2,120})['"`]/g)) {
      const raw = m[1].replace(/^https?:\/\/[^/]+/, '').replace(/^\$\{[^}]*\}/, '').replace(/\$\{[^}]*\}/g, ':param');
      const endpoint = raw.replace(/\/+$/, '');
      if (!endpoint || pages.has(endpoint.toLowerCase()) || found.has(endpoint)) continue;
      if (blocked.some((b) => endpoint.toLowerCase().includes(b))) continue;
      if (looksLikeSideEffect(endpoint)) found.set(endpoint, rel(root, file));
    }
  }
  return [...found.entries()].map(([endpoint, file]) => ({ endpoint, file })).sort((a, b) => a.endpoint.localeCompare(b.endpoint));
};
