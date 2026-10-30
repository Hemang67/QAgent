import type { Page } from 'playwright-core';
import type { Problem } from '../../shared/types';

export const WIDTHS = [
  { name: 'Phone', width: 390, height: 844 },
  { name: 'Tablet', width: 820, height: 1180 },
];

interface LayoutIssues {
  scrollWidth: number;
  cutOff: string[];
  overlaps: string[];
}

/** Sideways scrolling, content cut off at the right edge, and interactive elements on top of each other. */
const inspectLayout = (page: Page) =>
  page.evaluate((): LayoutIssues => {
    const vw = document.documentElement.clientWidth;
    const visible = (el: Element) => {
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
    };
    // Inside a horizontal scroller (wide tables in a scroll box) is fine
    const inScroller = (el: Element) => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const o = getComputedStyle(p).overflowX;
        if (o === 'auto' || o === 'scroll' || o === 'hidden') return true;
      }
      return false;
    };
    const label = (el: Element) => {
      const id = el.id ? `#${el.id}` : '';
      const cls = typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/)[0]}` : '';
      const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30);
      return `${el.tagName.toLowerCase()}${id}${cls}${text ? ` "${text}"` : ''}`;
    };
    const cutOff: string[] = [];
    for (const el of document.querySelectorAll('body *')) {
      if (cutOff.length >= 5) break;
      if (!visible(el) || el.childElementCount > 0 || inScroller(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.right > vw + 2 && r.left < vw) cutOff.push(label(el));
    }
    const interactive = [...document.querySelectorAll('a, button, input, select, textarea, [role="button"]')].filter(visible).slice(0, 300);
    const overlaps: string[] = [];
    for (let i = 0; i < interactive.length && overlaps.length < 5; i++) {
      const a = interactive[i].getBoundingClientRect();
      for (let j = i + 1; j < interactive.length; j++) {
        const x = interactive[j];
        if (interactive[i].contains(x) || x.contains(interactive[i])) continue;
        const b = x.getBoundingClientRect();
        const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        // Over half of the smaller element covered
        if (w > 0 && h > 0 && w * h > 0.5 * Math.min(a.width * a.height, b.width * b.height)) {
          overlaps.push(`${label(interactive[i])} and ${label(x)}`);
          break;
        }
      }
    }
    return { scrollWidth: document.documentElement.scrollWidth - vw, cutOff, overlaps };
  });

/**
 * Reopens the page at phone and tablet widths (GET only, like any visit) and
 * reports layout problems per width. Sideways scrolling and cut-off content fail.
 */
export const checkResponsive = async (page: Page, waitReady: () => Promise<unknown>, timeoutMs: number): Promise<Problem[]> => {
  const problems: Problem[] = [];
  const original = page.viewportSize();
  try {
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w.width, height: w.height });
      await page.reload({ waitUntil: 'domcontentloaded', timeout: timeoutMs });
      await waitReady();
      const l = await inspectLayout(page);
      const at = `${w.name} ${w.width}px`;
      if (l.scrollWidth > 2) problems.push({ type: 'responsive-sideways-scroll', severity: 'error', detail: `${at}: the page scrolls sideways by ${l.scrollWidth}px` });
      if (l.cutOff.length) problems.push({ type: 'responsive-cut-off', severity: 'error', detail: `${at}: content past the right edge: ${l.cutOff.join('; ')}` });
      if (l.overlaps.length) problems.push({ type: 'responsive-overlap', severity: 'warning', detail: `${at}: overlapping controls: ${l.overlaps.join('; ')}` });
    }
  } finally {
    if (original) await page.setViewportSize(original).catch(() => {});
  }
  return problems;
};
