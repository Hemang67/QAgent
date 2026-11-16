import type { Frame, Locator, Page } from 'playwright-core';
import { RISKY_CONTROL, type PlannedPage } from '../shared/types';
import { pageLinks } from './visit';

// The first data row of a table or grid; two cells or more, so "No data" rows are left alone
const ROW = 'tbody tr:visible:has(td + td), [role="row"]:visible:has([role="gridcell"])';
const CELL = 'td, [role="gridcell"]';
// Cells holding these do something else when clicked (delete, select, menus)
const INTERACTIVE = 'button, a, input, select, textarea, [role="button"], [role="checkbox"], [role="switch"], [role="menuitem"]';
// Controls that may open a page
const CONTROL = 'button, a[href], [role="button"], [role="link"], [role="menuitem"]';
// Clicks per list page: the control the code names, the row, then other safe controls
const MAX_ATTEMPTS = 4;

interface Wanted {
  route: string;
  path: RegExp;
  hasPathParams: boolean;
  query: string[];
  /** Pages whose code opens it (lower case) → labels of the control that does; empty when the code gave no answer */
  sources: Map<string, string[]>;
}

export interface FoundRecord {
  url: string;
  /** The page it was found on, and what was opened there ("a link", "the first row", "\"Permissions\" in the first row") */
  from: string;
  how: string;
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
    sources: new Map((p.recordFrom ?? []).map((s) => [s.route.toLowerCase(), s.labels ?? []])),
  };
};

/**
 * Finds record IDs the way a user would: the app's own list pages lead to its
 * detail pages. The planner reads the project's code for which pages open which
 * (PlannedPage.recordFrom); on those pages, once checked, the run reads links,
 * then opens the first record of a table or grid and sees where the app goes. Only a
 * URL the app really opened is used. Read-only: the page's guard still blocks
 * every write.
 */
export class RecordFinder {
  private wanted: Wanted[];
  private found = new Map<string, FoundRecord>();
  private tried = new Set<string>();
  /** What happened on each list page where the first record was tried */
  private notes = new Map<string, string>();

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

  /**
   * Looks for records on a page that has finished its checks; may navigate the page away.
   * In the first row of its table it clicks, in order: the control the code names
   * ("Permissions"), the row itself, then (where the code says this page opens a
   * record) other controls with a safe label. Never a control in RISKY_CONTROL.
   */
  async collect(page: Page, from: string) {
    if (!this.open) return;
    const origin = new URL(page.url()).origin;
    for (const link of await pageLinks(page, origin)) this.match(link, from, 'a link');
    const key = from.toLowerCase();
    if (!this.open || this.tried.has(key) || !this.waitingOn(key)) return;
    this.tried.add(key);

    const home = page.url();
    const firstRow = () => page.locator(ROW).first();
    if (!(await firstRow().count().catch(() => 0))) return void this.notes.set(key, 'no rows in its table');

    const labels = this.labelsFor(key);
    const attempts: { what: string; target: () => Promise<Locator | null> }[] = [
      ...labels.map((l) => ({ what: `"${l}" in the first row`, target: async () => byLabel(firstRow(), l) })),
      {
        what: 'the first row',
        target: async () => {
          const cell = firstRow().locator(CELL).filter({ hasNot: page.locator(INTERACTIVE) }).first();
          return (await cell.count().catch(() => 0)) ? cell : firstRow();
        },
      },
    ];
    if (this.isSource(key)) {
      const names: string[] = await firstRow()
        .locator(CONTROL)
        .evaluateAll((els) => els.map((e) => (e.getAttribute('aria-label') || e.getAttribute('title') || e.textContent || '').replace(/\s+/g, ' ').trim()))
        .catch(() => []);
      for (const n of new Set(names)) {
        if (n && n.length <= 40 && !RISKY_CONTROL.test(n) && !labels.some((l) => l.toLowerCase() === n.toLowerCase())) {
          attempts.push({ what: `"${n}" in the first row`, target: async () => byLabel(firstRow(), n) });
        }
      }
    }

    const outcomes: string[] = [];
    for (const a of attempts.slice(0, MAX_ATTEMPTS)) {
      if (!this.waitingOn(key)) break;
      if (page.url() !== home && !(await restore(page, home, firstRow))) {
        outcomes.push('could not open the list again');
        break;
      }
      const target = await a.target();
      if (!target || !(await target.count().catch(() => 0))) {
        outcomes.push(`no ${a.what}`);
        continue;
      }
      if (await target.isDisabled().catch(() => false)) {
        outcomes.push(`${a.what} is disabled (the account may not have permission)`);
        continue;
      }
      const urls = await clickAndWatch(page, target);
      if (!urls) outcomes.push(`could not click ${a.what}`);
      else if (!urls.length) outcomes.push(`${a.what} opened nothing`);
      else if (!urls.some((u) => this.match(u, from, a.what))) outcomes.push(`${a.what} opened ${new URL(urls[urls.length - 1]).pathname}`);
      else outcomes.push(`found a record through ${a.what}`);
    }
    this.notes.set(key, outcomes.join('; '));
  }

  /** What happened on `route` when its first record was tried, for the report. */
  note(route: string) {
    return this.notes.get(route.toLowerCase());
  }

  /** Labels the code gives for the control on `key` that opens a page still waiting */
  private labelsFor(key: string) {
    return [...new Set(this.wanted.filter((w) => !this.found.has(w.route)).flatMap((w) => w.sources.get(key) ?? []))];
  }

  /** The code says `key` opens a page still waiting */
  private isSource(key: string) {
    return this.wanted.some((w) => !this.found.has(w.route) && w.sources.has(key));
  }

  /**
   * Something still waits for a record that `key` might give: the code says it opens a
   * page still waiting, or a waiting page has no source in the code (any list may lead to it).
   */
  private waitingOn(key: string) {
    return this.wanted.some((w) => !this.found.has(w.route) && (!w.sources.size || w.sources.has(key)));
  }
}

/** A control in `row` whose text, title or aria-label is `label`. */
const byLabel = (row: Locator, label: string) => {
  const exact = new RegExp(`^\\s*${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i');
  const attr = JSON.stringify(label);
  return row.locator(CONTROL).filter({ hasText: exact }).or(row.locator(`[title=${attr} i], [aria-label=${attr} i]`)).first();
};

/** Back to the list after a click opened another page; false when its rows do not come back. */
const restore = async (page: Page, home: string, firstRow: () => Locator) => {
  try {
    await page.goto(home, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    await firstRow().waitFor({ state: 'visible', timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
};

/**
 * Clicks and returns every URL the app opened (null when the click did not happen).
 * Every navigation counts, not only the last: a button's own navigation can be
 * followed at once by its row's.
 */
const clickAndWatch = async (page: Page, target: Locator): Promise<string[] | null> => {
  const before = page.url();
  const seen: string[] = [];
  const popups: Page[] = [];
  const onNav = (f: Frame) => f === page.mainFrame() && f.url() !== before && seen.push(f.url());
  const onPopup = (p: Page) => popups.push(p);
  page.on('framenavigated', onNav);
  page.on('popup', onPopup);
  try {
    try {
      await target.click({ timeout: 3000 });
    } catch {
      return null;
    }
    // The URL is enough: the page it leads to is tested later on its own
    await page.waitForURL((u) => u.toString() !== before, { timeout: 3000, waitUntil: 'commit' }).catch(() => {});
    await page.waitForTimeout(300);
  } finally {
    page.off('framenavigated', onNav);
    page.off('popup', onPopup);
  }
  if (page.url() !== before && !seen.includes(page.url())) seen.push(page.url());
  for (const p of popups) {
    await p.waitForURL((u) => u.protocol !== 'about:', { timeout: 3000 }).catch(() => {});
    seen.push(p.url());
    await p.close().catch(() => {});
  }
  // Nothing opened: close a dialog the click may have shown
  if (!seen.length) await page.keyboard.press('Escape').catch(() => {});
  return seen;
};
