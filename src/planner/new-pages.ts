import path from 'path';
import { rel } from '../adapters/common';
import type { QAgentConfig } from '../shared/config';
import type { EndpointCandidate } from '../shared/ipc';
import type { RouteInfo } from '../shared/types';
import { addedLines, gitChanges } from './impact';
import { looksLikeSideEffect } from './side-effects';

export interface NewPage extends RouteInfo {
  /** Already set up: in the Smoke list, or with record-ID or skip settings */
  configured: boolean;
}

export interface NewPagesResult {
  base: string;
  pages: NewPage[];
  endpoints: EndpointCandidate[];
}

const ENDPOINT = /['"`]((?:https?:\/\/[^'"`\s]+?|\$\{[^}`]+\})?\/[A-Za-z0-9_\-/{}:$.]{2,120})['"`]/g;

/**
 * Pages and send/book/charge endpoints added since the base branch, the same
 * questions as OMS's e2e:add-page: a page is new when its file is new or its
 * path was added to a router file; an endpoint is new when a changed line adds it.
 */
export const findNewPages = (projectRoot: string, routes: RouteInfo[], config: QAgentConfig, preferredBase?: string): NewPagesResult => {
  const g = gitChanges(projectRoot, preferredBase);
  const added = new Map(g.changes.map((c) => [c, addedLines(g, c)]));
  const newFiles = new Set(g.changes.filter((c) => c.status === 'A').map((c) => c.abs));
  const allAdded = [...added.values()].flat();

  const pages = routes
    .filter((r) => (r.file && newFiles.has(path.resolve(g.root, r.file))) || allAdded.some((l) => l.includes(`'${r.path}'`) || l.includes(`"${r.path}"`) || l.includes(`\`${r.path}\``)))
    .map((r) => ({ ...r, configured: !!config.pages?.[r.path] || !!config.lists?.smoke?.includes(r.path) }));

  const blocked = (config.blockedEndpoints ?? []).map((b) => b.toLowerCase());
  const pagePaths = new Set(routes.map((r) => r.path.toLowerCase()));
  const endpoints = new Map<string, string>();
  for (const [c, lines] of added) {
    for (const line of lines) {
      for (const m of line.matchAll(ENDPOINT)) {
        const e = m[1].replace(/^https?:\/\/[^/]+/, '').replace(/^\$\{[^}]*\}/, '').replace(/\$\{[^}]*\}/g, ':param').replace(/\/+$/, '');
        if (!e || pagePaths.has(e.toLowerCase()) || blocked.some((b) => e.toLowerCase().includes(b)) || !looksLikeSideEffect(e)) continue;
        if (!endpoints.has(e)) endpoints.set(e, rel(g.root, c.abs));
      }
    }
  }
  return { base: g.base, pages, endpoints: [...endpoints].map(([endpoint, file]) => ({ endpoint, file })) };
};
