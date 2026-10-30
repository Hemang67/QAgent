import type { Locator, Page } from 'playwright-core';
import type { Readiness } from '../shared/types';
import type { PageMonitor } from './monitor';

// Elements that show a page has real content, across UI libraries
export const PRIMARY_CONTENT_SELECTOR = [
  'table',
  'form',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  'canvas',
  'iframe',
  'img',
  'svg',
  'video',
  'article',
  'section',
  'ul',
  'ol',
  '.card',
  '[role="tabpanel"]',
  '[role="grid"]',
  '[role="table"]',
  '[role="list"]',
].join(', ');

const EMPTY_TEXT = /^(no data found|no data available|no data|no records? found|no results? found|nothing to show|no items?|empty)\.?$/i;

// Error screens of common frameworks and servers, matched on the visible text
const ERROR_SCREEN = /Unexpected Application Error!|Application error: a client-side exception has occurred|Unhandled Runtime Error|Server Error in '\/' Application|Whoops, looks like something went wrong|Traceback \(most recent call last\)|Internal Server Error/i;

export interface ReadyResult {
  ready: boolean;
  waitedMs: number;
  visibleLoaders: number;
  inflight: { method: string; url: string; pendingMs: number }[];
}

const countVisibleLoaders = (page: Page, loaderSelector: string) =>
  page.evaluate((sel) => {
    const visible = (el: Element) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      const s = getComputedStyle(el as HTMLElement);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
    };
    let loaders = 0;
    try {
      loaders = [...document.querySelectorAll(sel)].filter(visible).length;
    } catch {
      // an invalid project selector must not stop the run
    }
    const loadingText = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,span,div')]
      .filter((el) => el.childElementCount === 0 && /^loading(\.{0,3}|…)$/i.test((el.textContent || '').trim()))
      .filter(visible).length;
    return loaders + loadingText;
  }, loaderSelector);

/**
 * Waits until the page is meaningfully loaded: something rendered, no API call
 * in flight for the quiet window, and no visible loader. Polls; never a fixed sleep.
 */
export const waitForReady = async (page: Page, monitor: PageMonitor, scope: Locator, r: Readiness, timeoutMs = r.readyTimeoutMs): Promise<ReadyResult> => {
  const start = Date.now();
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  let loaders = 0;
  while (Date.now() - start < timeoutMs) {
    const rendered = (await scope.count().catch(() => 0)) > 0;
    loaders = await countVisibleLoaders(page, r.loaderSelector).catch(() => 1);
    const quiet = monitor.inflightCount === 0 && monitor.msSinceLastActivity >= r.quietWindowMs;
    if (rendered && quiet && loaders === 0) return { ready: true, waitedMs: Date.now() - start, visibleLoaders: 0, inflight: [] };
    await page.waitForTimeout(150).catch(() => {});
  }
  return { ready: false, waitedMs: Date.now() - start, visibleLoaders: loaders, inflight: monitor.inflightUrls };
};

/** The first selector in the project's content list that exists on the page (priority order). */
export const contentRoot = async (page: Page, contentSelector: string) => {
  const sels = contentSelector.split(',').map((s) => s.trim()).filter(Boolean);
  for (const s of sels) {
    if ((await page.locator(s).count().catch(() => 0)) > 0) return page.locator(s).first();
  }
  return page.locator('body');
};

export interface ContentResult {
  textLength: number;
  heading: string | null;
  primaryElements: Record<string, number>;
  hasPrimary: boolean;
  errorScreen: string | null;
  tables: { rows: number; headerCells: number }[];
  emptyMessages: string[];
}

export const inspectContent = async (scope: Locator): Promise<ContentResult> =>
  scope.evaluate(
    (root, { primarySelector, emptySrc, errorSrc }) => {
      const emptyRe = new RegExp(emptySrc, 'i');
      const errorRe = new RegExp(errorSrc, 'i');
      const visible = (el: Element) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        const s = getComputedStyle(el as HTMLElement);
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
      };
      const counts: Record<string, number> = {};
      for (const sel of primarySelector.split(',').map((s) => s.trim())) {
        const n = [...root.querySelectorAll(sel)].filter(visible).length;
        if (n) counts[sel] = n;
      }
      const bodyText = (document.body?.innerText || '').trim();
      const errMatch = errorRe.exec(bodyText);
      const errorScreen = errMatch ? bodyText.slice(Math.max(0, errMatch.index - 40), errMatch.index + 400).trim() : null;
      const headingEl = [...root.querySelectorAll('h1,h2,h3,h4,h5,h6')].find((el) => visible(el) && (el.textContent || '').trim());
      const tables = [...root.querySelectorAll('table')].filter(visible).map((t) => ({
        rows: [...t.querySelectorAll('tbody tr')].filter((tr) => visible(tr) && !emptyRe.test((tr.textContent || '').trim())).length,
        headerCells: t.querySelectorAll('thead th').length,
      }));
      const emptyMessages = [...root.querySelectorAll('*')]
        .filter((el) => el.childElementCount === 0 && emptyRe.test((el.textContent || '').trim()) && visible(el))
        .map((el) => (el.textContent || '').trim());
      return {
        textLength: ((root as HTMLElement).innerText || '').trim().length,
        heading: headingEl ? (headingEl.textContent || '').trim().slice(0, 120) : null,
        primaryElements: counts,
        hasPrimary: Object.keys(counts).length > 0,
        errorScreen,
        tables,
        emptyMessages: [...new Set(emptyMessages)],
      };
    },
    { primarySelector: PRIMARY_CONTENT_SELECTOR, emptySrc: EMPTY_TEXT.source, errorSrc: ERROR_SCREEN.source },
  );

/** Dismisses alert/confirm/beforeunload without accepting anything. */
export const guardDialogs = (page: Page, sink: string[]) => {
  page.on('dialog', async (d) => {
    sink.push(`${d.type()}: ${d.message()}`);
    await d.dismiss().catch(() => {});
  });
};
