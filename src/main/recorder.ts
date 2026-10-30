import { chromium, type Browser, type Page } from 'playwright-core';
import { findBrowser } from '../planner/plan';
import type { FlowStep } from '../shared/types';

export type RecordKind = 'flow' | 'crud';
export type CrudPhase = 'create' | 'edit' | 'delete';

export interface RecordResult {
  ok: boolean;
  error?: string;
  /** Path where recording started (the CRUD list page) */
  startPath?: string;
  steps?: FlowStep[];
  phases?: Record<CrudPhase, FlowStep[]>;
}

interface State {
  kind: RecordKind;
  recording: boolean;
  checkNext: boolean;
  phase: CrudPhase;
  count: number;
}

// Runs in every page of the recording window: a fixed QAgent bar (shadow DOM, so the
// app's styles cannot touch it) and listeners that turn actions into steps.
const PAGE_SCRIPT = () => {
  const w = window as any;
  if (w.__qagentRecorder) return;
  w.__qagentRecorder = true;
  const q = (s: string) => JSON.stringify(s);
  const clean = (s: string) => s.trim().replace(/\s+/g, ' ').slice(0, 60);
  const stableId = (id: string) => id && !/\d{3,}|^:|[a-f0-9]{8,}/i.test(id);
  const selector = (el: Element): string => {
    for (const a of ['data-testid', 'data-test', 'data-cy', 'data-qa']) {
      const v = el.getAttribute(a);
      if (v) return `[${a}=${q(v)}]`;
    }
    const tag = el.tagName.toLowerCase();
    if (['input', 'textarea', 'select'].includes(tag)) {
      const name = el.getAttribute('name');
      if (name) return `${tag}[name=${q(name)}]`;
      if (stableId(el.id)) return `#${CSS.escape(el.id)}`;
      const aria = el.getAttribute('aria-label');
      if (aria) return `${tag}[aria-label=${q(aria)}]`;
      const ph = el.getAttribute('placeholder');
      if (ph) return `${tag}[placeholder=${q(ph)}]`;
    }
    const type = (el as HTMLInputElement).type;
    const role = el.getAttribute('role') || (tag === 'a' ? 'link' : tag === 'button' || (tag === 'input' && ['submit', 'button'].includes(type)) ? 'button' : '');
    const label = clean(el.getAttribute('aria-label') || (el as HTMLElement).innerText || (el as HTMLInputElement).value || '');
    if (role && label) return `role=${role}[name=${q(label)}]`;
    if (stableId(el.id)) return `#${CSS.escape(el.id)}`;
    if (label) return `text=${q(label)}`;
    // Last resort: a short CSS path
    const parts: string[] = [];
    for (let e: Element | null = el; e && e !== document.body && parts.length < 4; e = e.parentElement) {
      const sib = e.parentElement ? [...e.parentElement.children].filter((c) => c.tagName === e!.tagName) : [];
      parts.unshift(sib.length > 1 ? `${e.tagName.toLowerCase()}:nth-of-type(${sib.indexOf(e) + 1})` : e.tagName.toLowerCase());
    }
    return parts.join(' > ');
  };

  const send = (step: unknown) => w.__qagentStep?.(step);
  const inBar = (e: Event) => e.composedPath().some((n) => (n as Element).id === 'qagent-recorder-bar');
  let state: { recording: boolean; checkNext: boolean; kind: string; phase: string; count: number } = { recording: false, checkNext: false, kind: 'flow', phase: 'create', count: 0 };

  document.addEventListener(
    'click',
    (e) => {
      if (inBar(e) || !state.recording) return;
      const t = e.target as Element;
      const el = t.closest('a,button,[role="button"],[role="tab"],[role="menuitem"],[role="option"],input,label,summary,select,textarea,li,td,th,[onclick]') || t;
      if (state.checkNext) {
        e.preventDefault();
        e.stopPropagation();
        const text = clean((el as HTMLElement).innerText || '');
        if (text) send({ expectText: text });
        w.__qagentCmd?.('check-done');
        return;
      }
      const tag = el.tagName.toLowerCase();
      const type = (el as HTMLInputElement).type;
      if (tag === 'input' && (type === 'checkbox' || type === 'radio')) send({ check: selector(el) });
      else if (tag === 'select' || (tag === 'input' && !['submit', 'button', 'reset', 'image'].includes(type)) || tag === 'textarea') return;
      else send({ click: selector(el) });
    },
    true,
  );
  document.addEventListener(
    'change',
    (e) => {
      if (inBar(e) || !state.recording) return;
      const el = e.target as HTMLInputElement | HTMLSelectElement;
      if (el.tagName === 'SELECT') send({ select: selector(el), value: (el as HTMLSelectElement).selectedOptions[0]?.text ?? el.value });
      else if (!['checkbox', 'radio', 'file'].includes((el as HTMLInputElement).type)) send({ fill: selector(el), value: el.value });
    },
    true,
  );
  document.addEventListener(
    'keydown',
    (e) => {
      if (inBar(e) || !state.recording || e.key !== 'Enter') return;
      const el = e.target as HTMLInputElement;
      if (el.tagName !== 'INPUT') return;
      send({ fill: selector(el), value: el.value });
      send({ press: selector(el), key: 'Enter' });
    },
    true,
  );

  const render = async () => {
    state = (await w.__qagentState?.()) ?? state;
    let host = document.getElementById('qagent-recorder-bar');
    if (!host) {
      host = document.createElement('div');
      host.id = 'qagent-recorder-bar';
      host.style.cssText = 'position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:2147483647;';
      host.attachShadow({ mode: 'open' });
      document.documentElement.appendChild(host);
    }
    const crud = state.kind === 'crud';
    const next = state.phase === 'create' ? 'Create done → Edit' : state.phase === 'edit' ? 'Edit done → Delete' : '';
    host.shadowRoot!.innerHTML = `
      <style>
        .bar{display:flex;gap:8px;align-items:center;padding:8px 12px;background:#05080fee;border:1px solid #00e5ff;border-radius:6px;box-shadow:0 0 18px #00e5ff66;font:12px/1.2 Consolas,monospace;color:#d8f3ff;letter-spacing:.06em}
        b{color:#00e5ff;font-weight:700} .rec{width:9px;height:9px;border-radius:50%;background:${state.recording ? '#ff3864' : '#555'};box-shadow:0 0 8px ${state.recording ? '#ff3864' : 'transparent'}}
        button{font:inherit;color:#d8f3ff;background:#00e5ff14;border:1px solid #00e5ff88;border-radius:4px;padding:5px 10px;cursor:pointer;text-transform:uppercase}
        button.primary{background:#00e5ff;color:#001218;border-color:#00e5ff} button.on{background:#ffb02033;border-color:#ffb020;color:#ffb020}
      </style>
      <div class="bar"><span class="rec"></span><b>QAGENT</b>
        <span>${state.recording ? `${crud ? state.phase.toUpperCase() + ' · ' : ''}${state.count} steps` : 'Log in if needed, then press Record'}</span>
        ${state.recording ? `<button data-cmd="check" class="${state.checkNext ? 'on' : ''}">${state.checkNext ? 'Click the text to expect…' : 'Add check'}</button>` : '<button data-cmd="start" class="primary">● Record</button>'}
        ${state.recording && crud && next ? `<button data-cmd="next">${next}</button>` : ''}
        ${state.recording && crud && state.phase === 'edit' ? '<button data-cmd="skip-edit">No edit</button>' : ''}
        <button data-cmd="finish" class="${state.recording ? 'primary' : ''}">${state.recording ? 'Finish' : 'Cancel'}</button>
      </div>`;
    host.shadowRoot!.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => w.__qagentCmd?.(b.dataset.cmd)));
  };
  w.__qagentRender = render;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render);
  else render();
};

/** CRUD names: what the user typed for the record becomes {{name}} / {{newName}}. */
const placeholders = (s: string) => s.replace(/QAGENT-EDITED/gi, '{{newName}}').replace(/QAGENT/g, '{{name}}');

const sameTarget = (a: FlowStep, b: FlowStep) => 'fill' in a && 'fill' in b && a.fill === b.fill;

/**
 * Opens a browser window where the user performs a journey; returns the steps.
 * Nothing is blocked here: the user is really using the site.
 */
export const record = async (
  baseUrl: string,
  startPath: string,
  kind: RecordKind,
  // Tests drive the window like a user would, headless
  test?: { headless: boolean; drive: (page: Page) => Promise<void> },
): Promise<RecordResult> => {
  const b = findBrowser();
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: test?.headless ?? false, channel: b.channel, executablePath: b.executablePath, args: ['--start-maximized'] });
    const context = await browser.newContext({ viewport: null, ignoreHTTPSErrors: true });
    const state: State = { kind, recording: false, checkNext: false, phase: 'create', count: 0 };
    const phases: Record<CrudPhase, FlowStep[]> = { create: [], edit: [], delete: [] };
    let start = startPath;
    let done: (r: RecordResult) => void = () => {};
    const finished = new Promise<RecordResult>((r) => (done = r));
    const pages = new Set<Page>();
    const rerender = () => Promise.all([...pages].map((p) => p.evaluate(() => (window as any).__qagentRender?.()).catch(() => {})));

    await context.exposeBinding('__qagentState', () => state);
    await context.exposeBinding('__qagentStep', (_src, step: FlowStep) => {
      if (!state.recording) return;
      const s = kind === 'crud' ? (JSON.parse(placeholders(JSON.stringify(step))) as FlowStep) : step;
      const list = phases[state.phase];
      // Typing then pressing Enter reports the field twice: keep the last value
      if (list.length && sameTarget(list[list.length - 1], s)) list[list.length - 1] = s;
      else list.push(s);
      state.count = list.length;
      rerender();
    });
    await context.exposeBinding('__qagentCmd', async ({ page }, cmd: string) => {
      if (cmd === 'start') {
        state.recording = true;
        const u = new URL(page.url());
        start = u.pathname + u.search;
        if (kind === 'flow') phases.create.push({ goto: start });
        state.count = phases.create.length;
      } else if (cmd === 'check') state.checkNext = !state.checkNext;
      else if (cmd === 'check-done') state.checkNext = false;
      else if (cmd === 'next' || cmd === 'skip-edit') {
        state.phase = state.phase === 'create' ? 'edit' : 'delete';
        if (cmd === 'skip-edit') state.phase = 'delete';
        state.count = phases[state.phase].length;
      } else if (cmd === 'finish') {
        done(state.recording ? { ok: true, startPath: start, steps: phases.create, phases } : { ok: false, error: 'Recording cancelled' });
        return;
      }
      await rerender();
    });
    await context.addInitScript(PAGE_SCRIPT);
    context.on('page', (p) => {
      pages.add(p);
      // Playwright would dismiss confirm() dialogs on its own; accept them as the user means to (the runner does the same)
      p.on('dialog', (d) => d.accept().catch(() => {}));
      p.on('close', () => pages.delete(p));
    });
    const page = await context.newPage();
    browser.on('disconnected', () => done(state.recording ? { ok: true, startPath: start, steps: phases.create, phases } : { ok: false, error: 'The recording window was closed' }));
    await page.goto(new URL(startPath, baseUrl).toString(), { waitUntil: 'domcontentloaded', timeout: 60_000 });
    test?.drive(page).catch((e) => done({ ok: false, error: `Test drive failed: ${(e as Error).message}` }));
    const result = await finished;
    if (result.ok && kind === 'crud' && (!result.phases!.create.length || !result.phases!.delete.length)) {
      return { ok: false, error: 'A CRUD screen needs both a Create and a Delete part' };
    }
    if (result.ok && kind === 'flow' && result.steps!.length < 2) return { ok: false, error: 'No steps were recorded' };
    return result;
  } catch (e) {
    return { ok: false, error: (e as Error).message.split('\n')[0] };
  } finally {
    await browser?.close().catch(() => {});
  }
};
