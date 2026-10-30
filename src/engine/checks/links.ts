import type { APIRequestContext, Page } from 'playwright-core';
import type { Problem } from '../../shared/types';
import type { NetworkEvent } from '../monitor';
import { LOGOUT_PATH } from '../visit';

const MAX_LINKS_PER_PAGE = 100;

/** Link status shared by every page of one run, so each URL is fetched once. */
export class LinkCache {
  private status = new Map<string, Promise<number | string>>();

  constructor(private request: APIRequestContext) {}

  /** HTTP status of a GET (read-only), or the network error text. */
  check(url: string) {
    let s = this.status.get(url);
    if (!s) {
      s = this.request
        .get(url, { maxRedirects: 5, timeout: 15_000, failOnStatusCode: false })
        .then((r) => r.status())
        .catch((e: Error) => e.message.split('\n')[0]);
      this.status.set(url, s);
    }
    return s;
  }
}

/** `/orders/:id` → a regex matching `/orders/42`. */
export const routeMatcher = (patterns: string[]) => {
  const res = patterns.map((p) => new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\/:[A-Za-z0-9_]+\?/g, '(?:/[^/]+)?').replace(/:[A-Za-z0-9_]+/g, '[^/]+') + '/?$', 'i'));
  return (pathname: string) => res.some((r) => r.test(pathname));
};

/**
 * Broken links (same domain only), missing images, failed scripts and styles,
 * and http resources on an https page.
 */
export const checkLinks = async (page: Page, cache: LinkCache, network: NetworkEvent[], knownRoute: ((p: string) => boolean) | null): Promise<Problem[]> => {
  const problems: Problem[] = [];
  const origin = new URL(page.url()).origin;

  // Own-domain assets that failed to load (scripts, styles, images, fonts)
  for (const n of network) {
    if (!n.category.startsWith('resource-')) continue;
    problems.push({ type: 'broken-asset', severity: 'error', detail: `${n.method} ${n.url} → ${n.status ?? n.failure}` });
  }

  const found = await page.evaluate(() => ({
    links: [...document.querySelectorAll('a[href]')].map((a) => (a as HTMLAnchorElement).href),
    images: [...document.images].filter((i) => i.complete && i.naturalWidth === 0 && i.currentSrc).map((i) => i.currentSrc),
    resources: performance.getEntriesByType('resource').map((r) => r.name),
  }));

  for (const src of new Set(found.images)) problems.push({ type: 'broken-image', severity: 'error', detail: `Image did not load: ${src}` });
  if (origin.startsWith('https:')) {
    for (const r of new Set(found.resources.filter((u) => u.startsWith('http:')))) problems.push({ type: 'mixed-content', severity: 'error', detail: `Loaded over http on an https page: ${r}` });
  }

  const links = [...new Set(found.links)]
    .map((h) => {
      try {
        const u = new URL(h);
        u.hash = '';
        return u;
      } catch {
        return null;
      }
    })
    .filter((u): u is URL => !!u && u.origin === origin && !LOGOUT_PATH.test(u.pathname))
    .slice(0, MAX_LINKS_PER_PAGE);

  await Promise.all(
    links.map(async (u) => {
      const status = await cache.check(u.toString());
      if (typeof status === 'string') problems.push({ type: 'broken-link', severity: 'error', detail: `${u.pathname}${u.search} → ${status}` });
      else if (status >= 400) problems.push({ type: 'broken-link', severity: 'error', detail: `${u.pathname}${u.search} → HTTP ${status}` });
      // Single-page apps answer 200 for every path: a link to no known route is a likely client-side 404
      else if (knownRoute && !knownRoute(u.pathname)) problems.push({ type: 'link-unknown-route', severity: 'warning', detail: `${u.pathname} matches no page in the code` });
    }),
  );
  return problems;
};
