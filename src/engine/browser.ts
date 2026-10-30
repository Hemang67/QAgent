import { chromium, type Browser } from 'playwright-core';
import type { RunPlan } from '../shared/types';

/** Launches the browser chosen by the planner (an installed Chrome/Edge, or downloaded Chromium). */
export const launcher = (plan: RunPlan) => (headless: boolean): Promise<Browser> =>
  chromium.launch({
    headless,
    channel: plan.browser.channel,
    executablePath: plan.browser.executablePath,
    // Login windows open maximised; test runs never show a window
    args: headless ? [] : ['--start-maximized'],
  });
