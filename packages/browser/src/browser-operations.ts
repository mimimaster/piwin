/**
 * Page-level browser operations. Callers serialize these through the session
 * mutex; this module does not own Chromium lifetime or the exclusive queue.
 */
import { existsSync, statSync } from 'node:fs';
import type { Page } from 'playwright-core';
import type { BrowserInputEvent, BrowserSnapshotNode, BrowserViewportMode, WebElementPickResult } from '@piwin/contracts';
import { parseAriaSnapshot } from './snapshot.js';
import { pickElementAt } from './pick.js';
import { dispatchBrowserInput } from './input.js';
import { clampBrowserViewport, resolveBrowserViewport } from './viewport.js';
import { BROWSER_SCREENSHOT_QUALITY } from './screencast-size.js';
import {
  AbortOperationError,
  BrowserSessionError,
  BrowserStaleTargetError,
  NavigateError,
} from './browser-errors.js';
import type { BrowserActor, BrowserOpOptions, ScreenshotResult } from './browser-session.js';

const HTTP_URL_RE = /^https?:\/\//i;
const FILE_URL_RE = /^file:\/\//i;
/** Playwright aria refs look like `e5`; anything else is treated as a CSS selector. */
const ARIA_REF_RE = /^e\d+$/i;

/** Product default for Playwright locator actions (click / type / fill). */
export const BROWSER_ACTION_TIMEOUT_MS = 8_000;
/** Product default for page.goto. */
export const BROWSER_NAVIGATION_TIMEOUT_MS = 15_000;
/** Product default for wait_for condition polling. */
export const BROWSER_WAIT_FOR_DEFAULT_TIMEOUT_MS = 10_000;
/** Hard cap for wait_for timeout (caller values are clamped). */
export const BROWSER_WAIT_FOR_MAX_TIMEOUT_MS = 60_000;
const BROWSER_WAIT_FOR_POLL_MS = 100;
const BROWSER_KEY_MAX_CHARS = 64;
const KEY_MODIFIERS = new Set(['Alt', 'Control', 'Ctrl', 'ControlOrMeta', 'Meta', 'Shift', 'CmdOrCtrl']);
const NAMED_KEYS = new Set([
  'Accept',
  'Alt',
  'AltGraph',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'Backspace',
  'CapsLock',
  'Clear',
  'ContextMenu',
  'Control',
  'Ctrl',
  'Delete',
  'End',
  'Enter',
  'Esc',
  'Escape',
  'Help',
  'Home',
  'Insert',
  'Meta',
  'NumLock',
  'PageDown',
  'PageUp',
  'Pause',
  'PrintScreen',
  'ScrollLock',
  'Shift',
  'Space',
  'Tab',
]);

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new AbortOperationError('operation aborted');
}

export function assertHttpUrl(url: string): void {
  assertNavigableUrl(url);
}

/**
 * Agent tools stay on http(s). User-initiated panel navigation may also open
 * a local `file:` HTML page in the workbench Chromium.
 */
export function assertNavigableUrl(url: string, options?: { allowFile?: boolean }): void {
  const trimmed = url.trim();
  if (trimmed === '') {
    throw new NavigateError('navigate requires a non-empty URL');
  }
  if (HTTP_URL_RE.test(trimmed)) {
    return;
  }
  if (options?.allowFile === true && FILE_URL_RE.test(trimmed)) {
    return;
  }
  throw new NavigateError(
    options?.allowFile === true
      ? `navigate only supports http(s) or file URLs, got: ${url}`
      : `navigate only supports http(s) URLs, got: ${url}`,
  );
}

export function toLocator(target: string): string {
  return ARIA_REF_RE.test(target) ? `aria-ref=${target}` : target;
}

export type BrowserReloadOptions = BrowserOpOptions & {
  expectedUrl?: string;
  expectedPageId?: string;
};

export type BrowserWaitForCondition = {
  text?: string;
  url?: string;
  selector?: string;
  visible?: boolean;
};

export type BrowserWaitForOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type BrowserOperationsDeps = {
  getPage: () => Promise<Page>;
  peekPage: () => Page | undefined;
  pageId: () => string | undefined;
  emitState: () => Promise<void>;
  requestFrame: () => Promise<void>;
  restartMirror?: () => Promise<void>;
  assertActor: (actor: BrowserActor, reason: string, runId?: string) => void;
  maxDimension: number;
};

export type BrowserOperations = {
  navigate(url: string, options?: BrowserOpOptions): Promise<void>;
  snapshot(): Promise<BrowserSnapshotNode[]>;
  click(target: string, options?: BrowserOpOptions): Promise<void>;
  hover(target: string, options?: BrowserOpOptions): Promise<void>;
  selectOption(
    target: string,
    values: string | string[],
    options?: BrowserOpOptions,
  ): Promise<void>;
  setChecked(target: string, checked: boolean, options?: BrowserOpOptions): Promise<void>;
  uploadFiles(target: string, files: string[], options?: BrowserOpOptions): Promise<void>;
  type(target: string, text: string, options?: BrowserOpOptions): Promise<void>;
  fillForm(fields: Record<string, string>, options?: BrowserOpOptions): Promise<void>;
  scroll(delta: { x?: number; y?: number }, options?: BrowserOpOptions): Promise<void>;
  screenshot(path?: string): Promise<ScreenshotResult>;
  back(options?: BrowserOpOptions): Promise<void>;
  forward(options?: BrowserOpOptions): Promise<void>;
  find(text: string): Promise<{ count: number }>;
  wait(ms: number, signal?: AbortSignal): Promise<void>;
  waitFor(condition: BrowserWaitForCondition, options?: BrowserWaitForOptions): Promise<void>;
  reload(options?: BrowserReloadOptions): Promise<void>;
  pressKey(key: string, options?: BrowserOpOptions): Promise<void>;
  queryViewport(): { width: number; height: number } | undefined;
  pickElementAt(x: number, y: number, screenshotPath?: string): Promise<WebElementPickResult>;
  dispatchEvents(events: BrowserInputEvent[], signal?: AbortSignal): Promise<void>;
  setViewport(size: { width: number; height: number }, mode?: BrowserViewportMode): Promise<{ width: number; height: number }>;
};

/** Enter/Tab/Escape, named keys, chords like Control+l. Rejects empty/whitespace. */
export function isValidBrowserKey(key: string): boolean {
  if (key.length === 0 || key.length > BROWSER_KEY_MAX_CHARS) return false;
  if (/\s/.test(key)) return false;
  if (key.length === 1) return true;
  const parts = key.split('+');
  if (parts.some((part) => part.length === 0)) return false;
  const last = parts[parts.length - 1];
  if (last === undefined) return false;
  const modifiers = parts.slice(0, -1);
  if (modifiers.some((modifier) => !KEY_MODIFIERS.has(modifier))) return false;
  if (NAMED_KEYS.has(last)) return true;
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(last)) return true;
  if (/^Key[A-Z]$/.test(last) || /^Digit[0-9]$/.test(last)) return true;
  return last.length === 1;
}

export function clampBrowserWaitForTimeout(value: unknown): number | undefined {
  if (value === undefined) return BROWSER_WAIT_FOR_DEFAULT_TIMEOUT_MS;
  const timeoutMs = Number(value);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) return undefined;
  return Math.min(timeoutMs, BROWSER_WAIT_FOR_MAX_TIMEOUT_MS);
}

export function createBrowserOperations(deps: BrowserOperationsDeps): BrowserOperations {
  const { getPage, peekPage, pageId, emitState, requestFrame, assertActor, maxDimension } = deps;

  async function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new AbortOperationError('operation aborted');
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timer);
        reject(new AbortOperationError('operation aborted'));
      };
      const timer = setTimeout(() => {
        // Remove the listener on the normal path so a reused signal does
        // not accumulate stale listeners after the wait has resolved.
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  return {
    navigate: async (url, options) => {
      assertNavigableUrl(url, { allowFile: options?.actor === 'user' });
      throwIfAborted(options?.signal);
      assertActor(
        options?.actor ?? 'agent',
        options?.actor === 'user' ? 'user-write' : 'agent-write',
        options?.runId,
      );
      const activePage = await getPage();
      throwIfAborted(options?.signal);
      await activePage.goto(url, {
        timeout: BROWSER_NAVIGATION_TIMEOUT_MS,
        waitUntil: 'domcontentloaded',
      });
      await emitState();
      await requestFrame();
    },

    snapshot: async () => {
      const activePage = await getPage();
      const yamlText = await activePage.locator('html').ariaSnapshot({ mode: 'ai', boxes: true });
      return parseAriaSnapshot(yamlText);
    },

    click: async (target, options) => {
      throwIfAborted(options?.signal);
      assertActor(options?.actor ?? 'agent', 'agent-write', options?.runId);
      const activePage = await getPage();
      throwIfAborted(options?.signal);
      // Do not pass force:true — overlay intercept must stay an actionability failure.
      await activePage.locator(toLocator(target)).click({ timeout: BROWSER_ACTION_TIMEOUT_MS });
    },

    hover: async (target, options) => {
      throwIfAborted(options?.signal);
      assertActor(options?.actor ?? 'agent', 'agent-write', options?.runId);
      const activePage = await getPage();
      throwIfAborted(options?.signal);
      await activePage.locator(toLocator(target)).hover({ timeout: BROWSER_ACTION_TIMEOUT_MS });
    },

    selectOption: async (target, values, options) => {
      throwIfAborted(options?.signal);
      assertActor(options?.actor ?? 'agent', 'agent-write', options?.runId);
      const activePage = await getPage();
      throwIfAborted(options?.signal);
      await activePage
        .locator(toLocator(target))
        .selectOption(values, { timeout: BROWSER_ACTION_TIMEOUT_MS });
    },

    setChecked: async (target, checked, options) => {
      throwIfAborted(options?.signal);
      assertActor(options?.actor ?? 'agent', 'agent-write', options?.runId);
      const activePage = await getPage();
      throwIfAborted(options?.signal);
      await activePage
        .locator(toLocator(target))
        .setChecked(checked, { timeout: BROWSER_ACTION_TIMEOUT_MS });
    },

    uploadFiles: async (target, files, options) => {
      throwIfAborted(options?.signal);
      assertActor(options?.actor ?? 'agent', 'agent-write', options?.runId);
      if (files.length === 0) {
        throw new BrowserSessionError('upload requires at least one file path');
      }
      for (const file of files) {
        if (!existsSync(file) || !statSync(file).isFile()) {
          throw new BrowserSessionError(`upload file is not readable: ${file}`);
        }
      }
      const activePage = await getPage();
      throwIfAborted(options?.signal);
      await activePage
        .locator(toLocator(target))
        .setInputFiles(files, { timeout: BROWSER_ACTION_TIMEOUT_MS });
    },

    type: async (target, text, options) => {
      throwIfAborted(options?.signal);
      assertActor(options?.actor ?? 'agent', 'agent-write', options?.runId);
      const activePage = await getPage();
      throwIfAborted(options?.signal);
      await activePage.locator(toLocator(target)).click({ timeout: BROWSER_ACTION_TIMEOUT_MS });
      throwIfAborted(options?.signal);
      await activePage.keyboard.type(text);
    },

    fillForm: async (fields, options) => {
      throwIfAborted(options?.signal);
      assertActor(options?.actor ?? 'agent', 'agent-write', options?.runId);
      const activePage = await getPage();
      for (const [target, value] of Object.entries(fields)) {
        throwIfAborted(options?.signal);
        await activePage
          .locator(toLocator(target))
          .fill(value, { timeout: BROWSER_ACTION_TIMEOUT_MS });
      }
    },

    scroll: async (delta, options) => {
      assertActor(options?.actor ?? 'agent', 'agent-write', options?.runId);
      const activePage = await getPage();
      await activePage.mouse.wheel(delta.x ?? 0, delta.y ?? 0);
    },

    screenshot: async (path) => {
      const activePage = await getPage();
      const buffer = await activePage.screenshot({
        type: 'jpeg',
        quality: BROWSER_SCREENSHOT_QUALITY,
      });
      const viewport = activePage.viewportSize() ?? { width: maxDimension, height: maxDimension };
      const result: ScreenshotResult = {
        dataUrl: `data:image/jpeg;base64,${buffer.toString('base64')}`,
        width: viewport.width,
        height: viewport.height,
      };
      if (path !== undefined) {
        const { mkdir, writeFile } = await import('node:fs/promises');
        const { dirname } = await import('node:path');
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, buffer);
        result.path = path;
      }
      return result;
    },

    back: async (options) => {
      assertActor(
        options?.actor ?? 'agent',
        options?.actor === 'user' ? 'user-write' : 'agent-write',
        options?.runId,
      );
      const activePage = await getPage();
      await activePage.goBack();
      await emitState();
    },

    forward: async (options) => {
      assertActor(
        options?.actor ?? 'agent',
        options?.actor === 'user' ? 'user-write' : 'agent-write',
        options?.runId,
      );
      const activePage = await getPage();
      await activePage.goForward();
      await emitState();
    },

    find: async (text) => {
      const activePage = await getPage();
      const count = await activePage.getByText(text, { exact: false }).count();
      return { count };
    },

    wait: (ms, signal) => abortableSleep(ms, signal),

    waitFor: async (condition, options) => {
      const resolved = resolveWaitForCondition(condition);
      const timeoutMs =
        clampBrowserWaitForTimeout(options?.timeoutMs) ?? BROWSER_WAIT_FOR_DEFAULT_TIMEOUT_MS;
      const deadline = Date.now() + timeoutMs;
      const startPageId = pageId();
      const startedPage = peekPage();
      if (startedPage === undefined) {
        throw new BrowserSessionError('wait_for requires an open page');
      }
      const startUrl = resolved.kind === 'url' ? undefined : await readPageUrl(startedPage);

      for (;;) {
        throwIfAborted(options?.signal);
        const activePage = peekPage();
        if (activePage === undefined) {
          throw new BrowserStaleTargetError('page is gone', { pageStateLost: true });
        }
        if (pageId() !== startPageId) {
          throw new BrowserStaleTargetError('page identity changed', { pageStateLost: true });
        }
        const urlBefore = await readPageUrl(activePage);
        const met = await waitForConditionMet(activePage, resolved);
        const pageAfter = peekPage();
        if (pageAfter === undefined || pageId() !== startPageId) {
          throw new BrowserStaleTargetError('page identity changed', { pageStateLost: true });
        }
        const urlAfter = await readPageUrl(pageAfter);
        if (startUrl !== undefined && (urlBefore !== startUrl || urlAfter !== startUrl)) {
          throw new BrowserStaleTargetError('page navigated during wait_for', {
            pageStateLost: false,
          });
        }
        if (met) return;
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          throw new BrowserSessionError(`wait_for timed out after ${timeoutMs}ms`);
        }
        await abortableSleep(Math.min(BROWSER_WAIT_FOR_POLL_MS, remaining), options?.signal);
      }
    },

    reload: async (options) => {
      throwIfAborted(options?.signal);
      assertActor(
        options?.actor ?? 'agent',
        options?.actor === 'user' ? 'user-write' : 'agent-write',
        options?.runId,
      );
      if (peekPage() === undefined) {
        throw new NavigateError('reload requires an open page');
      }
      const activePage = await getPage();
      throwIfAborted(options?.signal);
      const currentUrl = (await readPageUrl(activePage)).trim();
      if (currentUrl === '') {
        throw new NavigateError('reload requires a current page URL');
      }
      const currentPageId = pageId();
      if (options?.expectedUrl !== undefined && options.expectedUrl !== currentUrl) {
        throw new BrowserStaleTargetError('page URL changed after permission', {
          pageStateLost: false,
        });
      }
      if (options?.expectedPageId !== undefined && options.expectedPageId !== currentPageId) {
        throw new BrowserStaleTargetError('page identity changed after permission', {
          pageStateLost: true,
        });
      }
      assertNavigableUrl(currentUrl, { allowFile: options?.actor === 'user' });
      await activePage.goto(currentUrl, {
        timeout: BROWSER_NAVIGATION_TIMEOUT_MS,
        waitUntil: 'domcontentloaded',
      });
      await emitState();
      await requestFrame();
    },

    pressKey: async (key, options) => {
      const trimmed = key.trim();
      if (!isValidBrowserKey(trimmed)) {
        throw new BrowserSessionError('press_key requires a valid key name');
      }
      throwIfAborted(options?.signal);
      assertActor(options?.actor ?? 'agent', 'agent-write', options?.runId);
      const activePage = await getPage();
      throwIfAborted(options?.signal);
      await activePage.keyboard.press(trimmed);
    },

    queryViewport: () => {
      const activePage = peekPage();
      if (activePage === undefined) return undefined;
      return activePage.viewportSize() ?? undefined;
    },

    pickElementAt: async (x, y, screenshotPath) => {
      assertActor('user', 'user-write');
      const activePage = await getPage();
      const picked = await pickElementAt(activePage, x, y);
      const result: WebElementPickResult = {
        url: activePage.url(),
        selector: picked.selector,
        text: picked.text,
        boundingRect: picked.boundingRect,
        ...(picked.ref !== undefined ? { ref: picked.ref } : {}),
        ...(picked.html !== undefined ? { html: picked.html } : {}),
      };
      if (screenshotPath !== undefined) {
        const { mkdir, writeFile } = await import('node:fs/promises');
        const { dirname } = await import('node:path');
        await mkdir(dirname(screenshotPath), { recursive: true });
        await writeFile(
          screenshotPath,
          await activePage.screenshot({
            type: 'jpeg',
            quality: BROWSER_SCREENSHOT_QUALITY,
            clip: { ...picked.boundingRect },
          }),
        );
        result.screenshotPath = screenshotPath;
      }
      return result;
    },

    dispatchEvents: async (events, signal) => {
      throwIfAborted(signal);
      const activePage = await getPage();
      for (const event of events) {
        throwIfAborted(signal);
        await dispatchBrowserInput(activePage, [event]);
      }
    },

    setViewport: async (size, mode) => {
      const next =
        mode === 'follow'
          ? resolveBrowserViewport({
              mode: 'follow',
              panelWidth: size.width,
              panelHeight: size.height,
            })
          : clampBrowserViewport(size.width, size.height, maxDimension);
      if (!next) {
        return { width: 0, height: 0 };
      }
      const activePage = await getPage();
      const current = activePage.viewportSize();
      if (current && current.width === next.width && current.height === next.height) {
        return next;
      }
      await activePage.setViewportSize(next);
      if (deps.restartMirror) await deps.restartMirror();
      await requestFrame();
      return next;
    },
  };
}

type ResolvedWaitForCondition =
  | { kind: 'text'; text: string; visible: boolean }
  | { kind: 'url'; url: string }
  | { kind: 'selector'; selector: string; visible: boolean };

function resolveWaitForCondition(condition: BrowserWaitForCondition): ResolvedWaitForCondition {
  const text =
    typeof condition.text === 'string' && condition.text.length > 0 ? condition.text : undefined;
  const url =
    typeof condition.url === 'string' && condition.url.length > 0 ? condition.url : undefined;
  const selector =
    typeof condition.selector === 'string' && condition.selector.length > 0
      ? condition.selector
      : undefined;
  const count =
    Number(text !== undefined) + Number(url !== undefined) + Number(selector !== undefined);
  if (count !== 1) {
    throw new BrowserSessionError('wait_for requires exactly one of text, url, or selector');
  }
  if (url !== undefined) {
    if (condition.visible !== undefined) {
      throw new BrowserSessionError('wait_for url cannot be combined with visible');
    }
    return { kind: 'url', url };
  }
  const visible = condition.visible ?? true;
  if (text !== undefined) return { kind: 'text', text, visible };
  if (selector === undefined) {
    throw new BrowserSessionError('wait_for requires exactly one of text, url, or selector');
  }
  return { kind: 'selector', selector, visible };
}

async function waitForConditionMet(page: Page, condition: ResolvedWaitForCondition): Promise<boolean> {
  if (condition.kind === 'url') {
    return urlMatches(await readPageUrl(page), condition.url);
  }
  if (condition.kind === 'text') {
    const count = await page.getByText(condition.text, { exact: false }).count();
    return condition.visible ? count > 0 : count === 0;
  }
  const visible = await page.locator(condition.selector).isVisible();
  return condition.visible ? visible : !visible;
}

async function readPageUrl(page: Page): Promise<string> {
  return Promise.resolve(page.url());
}

function urlMatches(current: string, expected: string): boolean {
  if (current === expected) return true;
  try {
    return new URL(current).href === new URL(expected).href;
  } catch {
    return current.includes(expected);
  }
}
