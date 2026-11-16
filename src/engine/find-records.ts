import type { Page } from 'playwright-core';
import type { PlannedPage } from '../shared/types';
import { pageLinks } from './visit';

// The first data row of a table or grid; two cells or more, so "No data" rows are left alone
const ROW = 'tbody tr:visible:has(td + td), [role="row"]:visible:has([role="gridcell"])';
const CELL = 'td, [role="gridcell"]';
// Cells holding these do something else when clicked (delete, select, menus)
const INTERACTIVE = 'button, a, input, select, textarea, [role="button"], [role="checkbox"], [role="switch"], [role="menuitem"]';

interface Wanted {
  route: string;
  path: RegExp;
  hasPathParams: boolean;
  query: string[];
  /** Pages whose code opens it (lower case); empty when the code gave no answer */
  sources: Set<string>;
}

export interface FoundRecord {
  url: string;
  /** The page it was found on, and how */
  from: string;
  how: 'link' | 'first row';
}

/** A page still waiting for a record ID: no test data, but it has ID parameters to look for. */
export const needsRecord = (p: PlannedPage) => !p.url && !p.skip && !!p.params?.length;

const compile = (p: PlannedPage): Wanted => {
  const params = p.params ?? [];
  const pattern = p.route
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\/:[A-Za-z0-9_]+\?/g, '(?:/[^/]+)?')
    .replace(/:[A-Za-z0-9_]+/g, '[^/]+');
  return {
    route: p.route,
    path: new RegExp(`^${pattern}/?$`, 'i'),
    hasPathParams: params.some((x) => !x.startsWith('?')),
    query: params.filter((x) => x.startsWith('?')).map((x) => x.slice(1)),
    sources: new Set((p.recordFrom ?? []).map((s) => s.route.toLowerCase())),
  };
};

/**
 * Finds record IDs the way a user would: the app's own list pages lead to its
 * detail pages. The planner reads the project's code for which pages open which
 * (PlannedPage.recordFrom); on those pages, once checked, the run reads links,
 * then opens the first row of a table or grid and sees where the app goes. Only a
 * URL the app really opened is used. Read-only: the page's guard still blocks
 * every write.
 */
export class RecordFinder {
  private wanted: Wanted[];
  private found = new Map<string, FoundRecord>();
  private tried = new Set<string>();

  constructor(pages: PlannedPage[]) {
    const routes = new Map(pages.filter(needsRecord).map((p) => [p.route, compile(p)]));
    this.wanted = [...routes.values()];
  }

  /** Still looking for at least one record */
  get open() {
    return this.wanted.some((w) => !this.found.has(w.route));
  }

  get(route: string) {
    return this.found.get(route);
  }

  /**
   * Whether to open the first row on `route`: it is where the code opens a page
   * still waiting, or a waiting page has no source in the code (then any list may lead to it).
   */
  private worthOpening(route: string) {
    const r = route.toLowerCase();
    return this.wanted.some((w) => !this.found.has(w.route) && (!w.sources.size || w.sources.has(r)));
  }

  /** Pages the code says lead to a record still missing, best first, that have not been opened yet. */
  pending(pages: PlannedPage[]): { route: string; url: string }[] {
    const out = new Map<string, string>();
    for (const p of pages) {
      if (!needsRecord(p) || this.found.has(p.route)) continue;
      for (const s of p.recordFrom ?? []) {
        const url = s.url ?? this.found.get(s.route)?.url;
        if (url && !this.tried.has(s.route.toLowerCase()) && !out.has(s.route)) out.set(s.route, url);
      }
    }
    return [...out].map(([route, url]) => ({ route, url }));
  }

  /** A source page that could not be opened: no more waiting on it. */
  skip(route: string) {
    this.tried.add(route.toLowerCase());
  }

  /** Records a URL the app itself opened, when it is a page still waiting for an ID. */
  match(url: string, from: string, how: FoundRecord['how']) {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return null;
    }
    for (const w of this.wanted) {
      if (this.found.has(w.route) || !w.path.test(u.pathname)) continue;
      // Without path parameters, the bare path is the "new record" form: an ID must be in the query
      if (!w.hasPathParams && !w.query.some((q) => u.searchParams.get(q))) continue;
      u.hash = '';
      this.found.set(w.route, { url: u.toString(), from, how });
      return w.route;
    }
    return null;
  }

  /** Looks for records on a page that has finished its checks; may navigate the page away. */
  async collect(page: Page, from: string) {
    if (!this.open) return;
    const origin = new URL(page.url()).origin;
    for (const link of await pageLinks(page, origin)) this.match(link, from, 'link');
    const key = from.toLowerCase();
    if (!this.open || this.tried.has(key) || !this.worthOpening(from)) return;
    this.tried.add(key);

    const row = page.locator(ROW).first();
    if (!(await row.count().catch(() => 0))) return;
    const cell = row.locator(CELL).filter({ hasNot: page.locator(INTERACTIVE) }).first();
    const target = (await cell.count().catch(() => 0)) ? cell : row;
    const before = page.url();
    const popups: Page[] = [];
    const onPopup = (p: Page) => popups.push(p);
    page.on('popup', onPopup);
    try {
      await target.click({ timeout: 3000 });
      // The URL is enough: the page it leads to is tested later on its own
      await page.waitForURL((u) => u.toString() !== before, { timeout: 3000, waitUntil: 'commit' });
    } catch {
      // The row opened nothing, a dialog, or something that is not a page
    } finally {
      page.off('popup', onPopup);
    }
    if (page.url() !== before) this.match(page.url(), from, 'first row');
    for (const p of popups) {
      await p.waitForURL((u) => u.protocol !== 'about:', { timeout: 3000 }).catch(() => {});
      this.match(p.url(), from, 'first row');
      await p.close().catch(() => {});
    }
  }
}
