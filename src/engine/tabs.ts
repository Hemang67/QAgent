import type { Locator, Page } from 'playwright-core';
import type { Readiness } from '../shared/types';
import { assessView } from './assess';
import type { PageMonitor } from './monitor';
import { inspectContent, waitForReady } from './readiness';
import type { PageRecord } from './records';

let tagSeq = 0;

/**
 * Tags and returns the tablists that belong directly to `scope`: those whose
 * nearest enclosing tabpanel is the scope itself (or none, at page level).
 * Nested tablists are reached by recursing into each tab's panel.
 */
const directTablists = (scope: Locator, isPageLevel: boolean): Promise<string[]> =>
  scope.evaluate(
    (root, { isPageLevel, seqStart }) => {
      let seq = seqStart;
      const visible = (el: Element) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const ids: string[] = [];
      for (const tl of root.querySelectorAll('[role="tablist"]')) {
        const pane = tl.parentElement?.closest('[role="tabpanel"]');
        const owned = isPageLevel ? !pane || !root.contains(pane) : pane === root;
        if (!owned || !visible(tl)) continue;
        if (!tl.getAttribute('data-qagent-tablist')) tl.setAttribute('data-qagent-tablist', `tl-${seq++}`);
        ids.push(tl.getAttribute('data-qagent-tablist')!);
      }
      return ids;
    },
    { isPageLevel, seqStart: (tagSeq += 1000) },
  );

const tabLabel = async (tab: Locator, index: number) => {
  const text = ((await tab.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
  return text || (await tab.getAttribute('aria-label').catch(() => null)) || `tab #${index + 1}`;
};

/** Opens every tab (nested up to maxTabDepth) and judges each one like a page. */
export const exploreTabs = async (
  page: Page,
  monitor: PageMonitor,
  scope: Locator,
  route: string,
  r: Readiness,
  parentPath: string[] = [],
  depth = 1,
): Promise<PageRecord[]> => {
  const results: PageRecord[] = [];
  if (depth > r.maxTabDepth) return results;

  for (const tlId of await directTablists(scope, depth === 1).catch(() => [] as string[])) {
    const tablist = page.locator(`[data-qagent-tablist="${tlId}"]`);
    const tabCount = await tablist.locator('[role="tab"]').count();

    for (let i = 0; i < tabCount; i++) {
      const tab = tablist.locator('[role="tab"]').nth(i);
      if (!(await tab.isVisible().catch(() => false))) continue;
      const tabPath = [...parentPath, await tabLabel(tab, i)];
      const started = Date.now();
      const row = (o: Partial<PageRecord>): PageRecord => ({
        route,
        kind: 'tab',
        tabPath: tabPath.join(' > '),
        url: page.url(),
        result: 'passed',
        classification: 'ok',
        problems: [],
        consoleErrors: 0,
        failedApi: 0,
        durationMs: Date.now() - started,
        ...o,
      });

      const disabled = (await tab.getAttribute('aria-disabled')) === 'true' || (await tab.isDisabled().catch(() => false));
      if (disabled) {
        results.push(row({ result: 'skipped', classification: 'tab-disabled', problems: [{ type: 'tab-disabled', severity: 'info', detail: 'Tab is disabled for this record or user' }] }));
        continue;
      }

      const mark = monitor.mark();
      let activated = true;
      try {
        await tab.click({ timeout: 10_000 });
        const handle = await tab.elementHandle();
        await page.waitForFunction((el) => el?.getAttribute('aria-selected') === 'true' || !!el?.classList.contains('active'), handle, { timeout: 10_000 });
      } catch {
        activated = false;
      }

      const paneId = await tab.getAttribute('aria-controls').catch(() => null);
      const pane = paneId ? page.locator(`[id="${paneId}"]`) : scope;
      const ready = await waitForReady(page, monitor, pane, r);
      const content = await inspectContent(pane).catch(() => inspectContent(scope));
      const events = monitor.since(mark);
      const a = assessView({ ready, content, console: events.console, network: events.network, apiRequests: events.apiRequests, blocked: events.blocked, documentStatus: null });
      if (!activated) {
        a.problems.push({ type: 'tab-not-activated', severity: 'error', detail: 'Tab did not become selected after a click' });
        a.result = 'failed';
        a.classification = 'tab-not-activated';
      }
      if (paneId && activated && !(await pane.isVisible().catch(() => false))) {
        a.problems.push({ type: 'tab-pane-hidden', severity: 'error', detail: `Panel #${paneId} not visible after the tab was selected` });
        a.result = 'failed';
        if (a.classification === 'ok' || a.classification === 'passed-with-warnings') a.classification = 'tab-pane-hidden';
      }
      results.push(
        row({
          url: page.url(),
          result: a.result,
          classification: a.classification,
          problems: a.problems,
          consoleErrors: events.console.filter((c) => c.severity === 'error').length,
          failedApi: events.network.filter((n) => n.severity === 'error').length,
          durationMs: Date.now() - started,
        }),
      );

      if (paneId && activated) results.push(...(await exploreTabs(page, monitor, pane, route, r, tabPath, depth + 1)));
    }
  }
  return results;
};
