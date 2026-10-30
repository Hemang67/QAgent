import type { Browser, BrowserContext, Page } from 'playwright-core';
import type { LoginPlan } from '../shared/types';
import type { Session } from './session';

export interface LoginState {
  ok: boolean;
  mode: LoginPlan['mode'];
  detail: string;
  /** Playwright storage state file inside the session folder */
  storageFile?: string;
  /** sessionStorage of the site origin; storage state files do not cover it, so it stays in memory */
  sessionStorage?: Record<string, string>;
  appAccount: string;
  durationMs: number;
}

const BROWSER_LOGIN_TIMEOUT = 5 * 60_000;
const FORM_LOGIN_TIMEOUT = 60_000;

const samePath = (a: string, b: string) => a.replace(/\/+$/, '').toLowerCase() === b.replace(/\/+$/, '').toLowerCase();

// Messages login forms show for a wrong password or a locked account
const LOGIN_ERROR = /invalid|incorrect|wrong|failed|denied|not (?:match|recogni[sz]ed|found|valid)|locked|try again|unauthori[sz]ed/i;

/** Visible short text on the login page that reads like a login error, if any. */
const loginError = (page: Page) =>
  page
    .evaluate((src) => {
      const re = new RegExp(src, 'i');
      for (const el of document.querySelectorAll('[role="alert"], .error, .alert, .invalid-feedback, p, span, small, div, li')) {
        if (el.childElementCount > 0) continue;
        const text = (el.textContent || '').trim();
        const r = (el as HTMLElement).getBoundingClientRect();
        if (text.length > 3 && text.length < 200 && r.width > 0 && r.height > 0 && re.test(text)) return text;
      }
      return null;
    }, LOGIN_ERROR.source)
    .catch(() => null);

/**
 * Waits until the URL means "logged in": the configured path, or any page other
 * than the login page. With `failFast` (typed credentials), an error message on
 * the login page ends the wait early instead of after the full timeout.
 */
const waitForLoggedIn = async (page: Page, plan: LoginPlan, timeout: number, failFast = false) => {
  const started = Date.now();
  const deadline = started + timeout;
  let leftAt = 0;
  while (Date.now() < deadline) {
    if (page.isClosed()) throw new Error('The login window was closed');
    if (failFast && Date.now() - started > 2000 && samePath(new URL(page.url()).pathname, plan.loginPath)) {
      const err = await loginError(page);
      if (err) throw new Error(`The login page said: "${err}"`);
    }
    const p = new URL(page.url()).pathname;
    if (plan.loggedInPath) {
      if (samePath(p, plan.loggedInPath)) return;
    } else if (!samePath(p, plan.loginPath)) {
      // Without a configured path, stay off the login page for 2 s to rule out bounces
      leftAt ||= Date.now();
      if (Date.now() - leftAt > 2000) return;
    } else {
      leftAt = 0;
    }
    await page.waitForTimeout(300).catch(() => {});
  }
  throw new Error(plan.loggedInPath ? `Did not reach ${plan.loggedInPath} after logging in` : 'Still on the login page');
};

/** Fills the first visible password field and the text field just before it, then presses Enter. */
export const fillLoginForm = async (page: Page, username: string, password: string) => {
  const pwd = page.locator('input[type="password"]:visible').first();
  await pwd.waitFor({ state: 'visible', timeout: 30_000 });
  const userIndex = await page.evaluate(() => {
    const inputs = [...document.querySelectorAll('input')].filter((i) => {
      const r = i.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    const pwdAt = inputs.findIndex((i) => i.type === 'password');
    for (let i = pwdAt - 1; i >= 0; i--) if (['text', 'email', 'tel', ''].includes(inputs[i].type)) return i;
    return -1;
  });
  if (userIndex < 0) throw new Error('No username field found before the password field');
  await page.locator('input:visible').nth(userIndex).fill(username);
  await pwd.fill(password);
  await pwd.press('Enter');
};

const captureSessionStorage = (page: Page) =>
  page.evaluate(() => Object.fromEntries(Object.entries(sessionStorage))).catch(() => ({}) as Record<string, string>);

const readAccount = async (page: Page, plan: LoginPlan) => {
  if (plan.username) return plan.username;
  if (!plan.accountSelector) return '';
  return ((await page.locator(plan.accountSelector).first().innerText({ timeout: 5000 }).catch(() => '')) || '').trim().slice(0, 80);
};

/**
 * Logs in once per environment, before any test type runs. Requests are not
 * blocked here: the login form itself usually POSTs.
 */
export const login = async (
  plan: LoginPlan,
  baseUrl: string,
  session: Session,
  key: string,
  launch: (headless: boolean) => Promise<Browser>,
): Promise<LoginState> => {
  const started = Date.now();
  const base = { mode: plan.mode, appAccount: '', durationMs: 0 };
  if (plan.mode === 'skip') return { ...base, ok: false, detail: 'Login skipped' };

  const browser = await launch(plan.mode === 'credentials');
  try {
    // A fresh profile each time: nothing is remembered between runs
    const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: plan.mode === 'browser' ? null : undefined });
    const page = await context.newPage();
    await page.goto(new URL(plan.loginPath, baseUrl).toString(), { waitUntil: 'domcontentloaded', timeout: 60_000 });
    if (plan.mode === 'credentials') {
      // Fill only once scripts have run: before hydration the browser would submit the form
      // natively, as a GET that puts the password in the URL
      await page.waitForLoadState('load', { timeout: 60_000 }).catch(() => {});
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
      await fillLoginForm(page, plan.username ?? '', plan.password ?? '');
      await waitForLoggedIn(page, plan, FORM_LOGIN_TIMEOUT, true);
    } else {
      await page.bringToFront().catch(() => {});
      await waitForLoggedIn(page, plan, BROWSER_LOGIN_TIMEOUT);
    }
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    const storageFile = session.file(`${key}.json`);
    await context.storageState({ path: storageFile });
    const sessionStorage = await captureSessionStorage(page);
    const appAccount = await readAccount(page, plan);
    return { ...base, ok: true, detail: `Logged in (${plan.mode === 'browser' ? 'in the browser window' : 'username and password'})`, storageFile, sessionStorage, appAccount, durationMs: Date.now() - started };
  } catch (e) {
    return { ...base, ok: false, detail: `Login failed: ${(e as Error).message.split('\n')[0]}`, durationMs: Date.now() - started };
  } finally {
    await browser.close().catch(() => {});
  }
};

/** Restores sessionStorage on the site origin in every new page of the context. */
export const applySessionStorage = async (context: BrowserContext, origin: string, items: Record<string, string> | undefined) => {
  if (!items || !Object.keys(items).length) return;
  await context.addInitScript(
    ({ origin, items }) => {
      if (location.origin !== origin) return;
      for (const [k, v] of Object.entries(items)) if (sessionStorage.getItem(k) === null) sessionStorage.setItem(k, v);
    },
    { origin, items },
  );
};

/**
 * Ends the session on the server when the project has a logout URL. Runs in its
 * own context without request blocking, because logout is often a POST.
 */
export const logout = async (browser: Browser, state: LoginState, plan: LoginPlan, baseUrl: string): Promise<string> => {
  if (!state.ok || !state.storageFile) return '';
  if (!plan.logoutPath) return 'No logout URL set: the session was deleted locally only';
  const context = await browser.newContext({ storageState: state.storageFile, ignoreHTTPSErrors: true });
  try {
    await applySessionStorage(context, new URL(baseUrl).origin, state.sessionStorage);
    const page = await context.newPage();
    await page.goto(new URL(plan.logoutPath, baseUrl).toString(), { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    return `Logged out (${plan.logoutPath})`;
  } catch (e) {
    return `Logout failed: ${(e as Error).message.split('\n')[0]}`;
  } finally {
    await context.close().catch(() => {});
  }
};
