import AxeBuilder from '@axe-core/playwright';
import type { Page } from 'playwright-core';
import type { Problem } from '../../shared/types';

/**
 * WCAG 2.1 AA with axe-core on the page's content area. Critical and serious
 * violations fail the page; moderate and minor ones are warnings.
 */
export const checkA11y = async (page: Page, contentSelector: string): Promise<Problem[]> => {
  const builder = new AxeBuilder({ page: page as any }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']);
  if (contentSelector !== 'body') builder.include(contentSelector);
  const result = await builder.analyze();
  return result.violations.map((v) => {
    const severe = v.impact === 'critical' || v.impact === 'serious';
    const where = v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(', ');
    return {
      type: `a11y-${v.impact ?? 'unknown'}`,
      severity: severe ? 'error' : 'warning',
      detail: `${v.id}: ${v.help} — ${v.nodes.length} element(s): ${where}. How to fix: ${v.helpUrl}`,
    };
  });
};
