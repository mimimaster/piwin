/**
 * Playwright-driven browser session service (ADR 0020 §2). Owns one headless
 * Chromium and exposes the agent tool surface (navigate/click/type/…), element
 * pick, and a throttled screenshot frame stream for the desktop mirror panel.
 *
 * The page is a single shared resource: every operation serializes through a
 * promise-chain mutex ("browser bus") so agent calls and picks never interleave
 * against a mid-navigation page. Chromium launches lazily on first use and fails
 * fast with an actionable error when the binary is missing.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Browser, BrowserContext, Page } from 'playwright-core';
import { chromium } from 'playwright-core';
import type { BrowserSnapshotNode, HostPush, WebElementPickResult } from '@piwin/contracts';
import { createExclusiveQueue } from './mutex.js';
import type { RunExclusive } from './mutex.js';
import { createFrameLoop } from './frames.js';
import type { FrameLoop } from './frames.js';
import { injectFinder, pickElementAt } from './pick.js';
import { parseAriaSnapshot } from './snapshot.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type BrowserFramePush = Extract<HostPush, { type: 'browser/frame' }>;
export type BrowserStatePush = Extract<HostPush, { type: 'browser/state' }>;
export type BrowserConsolePush = Extract<HostPush, { type: 'browser/console' }>;
export type BrowserNetworkPush = Extract<HostPush, { type: 'browser/network' }>;
export type BrowserSessionEvent =
  | BrowserFramePush
  | BrowserStatePush
  | BrowserConsolePush
  | BrowserNetworkPush;

export type BrowserSessionOptions = {
  /** Default true. When false the browser runs headed (useful for debugging). */
  headless?: boolean;
  /** Requested viewport in CSS px; each dimension is capped to `maxDimension`. */
  viewport?: { width: number; height: number };
  /** Cap for the largest frame/viewport dimension (~1280). */
  maxDimension?: number;
  /** Frame stream ceiling in fps (default 4). */
  maxFps?: number;
  userAgent?: string;
  /**
   * Persistent browser profile directory. When provided, Chromium uses this
   * directory as its user-data dir so cookies, localStorage, and IndexedDB
   * survive across launches. Default: `~/.piwin/browser-profile`.
   */
  profileDir?: string;
  /** When true (default false), capture console logs and network requests as HostPush events. */
  captureConsoleAndNetwork?: boolean;
};

export type BrowserSessionState = { url?: string; title?: string };

export type ScreenshotResult = {
  dataUrl: string;
  width: number;
  height: number;
  path?: string;
};

export type BrowserSession = {
  navigate(url: string, options?: { signal?: AbortSignal }): Promise<void>;
  snapshot(options?: { signal?: AbortSignal }): Promise<BrowserSnapshotNode[]>;
  click(target: string, options?: { signal?: AbortSignal }): Promise<void>;
  type(target: string, text: string, options?: { signal?: AbortSignal }): Promise<void>;
  fillForm(fields: Record<string, string>, options?: { signal?: AbortSignal }): Promise<void>;
  scroll(delta: { x?: number; y?: number }, options?: { signal?: AbortSignal }): Promise<void>;
  screenshot(path?: string, options?: { signal?: AbortSignal }): Promise<ScreenshotResult>;
  back(options?: { signal?: AbortSignal }): Promise<void>;
  forward(options?: { signal?: AbortSignal }): Promise<void>;
  find(text: string, options?: { signal?: AbortSignal }): Promise<{ count: number }>;
  wait(ms: number, options?: { signal?: AbortSignal }): Promise<void>;
  pickElementAt(
    x: number,
    y: number,
    options?: { signal?: AbortSignal; screenshotPath?: string },
  ): Promise<WebElementPickResult>;
  runExclusive: RunExclusive;
  subscribe(listener: (event: BrowserSessionEvent) => void): () => void;
  currentState(): BrowserSessionState;
  close(): Promise<void>;
};

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class BrowserSessionError extends Error {
  override name: string = 'BrowserSessionError';
}

export class NavigateError extends BrowserSessionError {
  override name: string = 'NavigateError';
}

export class BrowserUnavailableError extends BrowserSessionError {
  override name: string = 'BrowserUnavailableError';
}

export class AbortOperationError extends BrowserSessionError {
  override name: string = 'AbortOperationError';
}

export class BrowserSessionClosedError extends BrowserSessionError {
  override name: string = 'BrowserSessionClosedError';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const HTTP_URL_RE = /^https?:\/\//i;
/** Playwright aria refs look like `e5`; anything else is treated as a CSS selector. */
const ARIA_REF_RE = /^e\d+$/i;

export function assertHttpUrl(url: string): void {
  const trimmed = url.trim();
  if (trimmed === '') {
    throw new NavigateError('navigate requires a non-empty URL');
  }
  if (!HTTP_URL_RE.test(trimmed)) {
    throw new NavigateError(`navigate only supports http(s) URLs, got: ${url}`);
  }
}

function toLocator(target: string): string {
  return ARIA_REF_RE.test(target) ? `aria-ref=${target}` : target;
}

// ---------------------------------------------------------------------------
// Console & network capture helpers
// ---------------------------------------------------------------------------

/** Max text length for a console message before truncation. */
const MAX_CONSOLE_TEXT_LENGTH = 2000;

/** Truncate long console text to avoid unbounded push payloads. */
function truncateText(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Map Playwright console message types to push levels. */
function consoleLevel(type: string): 'log' | 'warning' | 'error' {
  if (type === 'error') return 'error';
  if (type === 'warning') return 'warning';
  return 'log';
}

/**
 * Attach console and network listeners to the page/context. Each event is
 * forwarded to subscribers as a `browser/console` or `browser/network` HostPush.
 * Network timing is measured from request start to response received.
 */
function attachConsoleAndNetworkListeners(
  page: Page,
  context: BrowserContext,
  subscribers: Set<(event: BrowserSessionEvent) => void>,
): void {
  page.on('console', (msg) => {
    const ts = Date.now();
    const text = truncateText(msg.text(), MAX_CONSOLE_TEXT_LENGTH);
    const event: BrowserConsolePush = {
      type: 'browser/console',
      level: consoleLevel(msg.type()),
      text,
      url: page.url(),
      ts,
    };
    for (const listener of subscribers) listener(event);
  });

  page.on('pageerror', (err) => {
    const ts = Date.now();
    const event: BrowserConsolePush = {
      type: 'browser/console',
      level: 'error',
      text: truncateText(err.message, MAX_CONSOLE_TEXT_LENGTH),
      url: page.url(),
      ts,
    };
    for (const listener of subscribers) listener(event);
  });

  const requestStartTimes = new Map<string, number>();

  context.on('request', (request) => {
    requestStartTimes.set(request.url() + request.method(), Date.now());
  });

  context.on('response', (response) => {
    const ts = Date.now();
    const key = response.url() + response.request().method();
    const startTime = requestStartTimes.get(key);
    requestStartTimes.delete(key);
    const duration = startTime !== undefined ? ts - startTime : 0;
    const event: BrowserNetworkPush = {
      type: 'browser/network',
      method: response.request().method,
      url: response.url(),
      status: response.status(),
      resourceType: response.request().resourceType(),
      duration,
      ts,
    };
    for (const listener of subscribers) listener(event);
  });
}

// ---------------------------------------------------------------------------
// Session factory
// ---------------------------------------------------------------------------

export function createBrowserSession(options: BrowserSessionOptions = {}): BrowserSession {
  const maxDimension = options.maxDimension ?? 1280;
  const requestedViewport = options.viewport ?? { width: 1280, height: 800 };
  const headless = options.headless ?? true;
  const maxFps = options.maxFps ?? 4;
  const profileDir = options.profileDir ?? join(homedir(), '.piwin', 'browser-profile');
  const captureConsoleAndNetwork = options.captureConsoleAndNetwork ?? false;

  const { runExclusive } = createExclusiveQueue();
  const subscribers = new Set<(event: BrowserSessionEvent) => void>();

  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let launchPromise: Promise<Page> | undefined;
  let closed = false;

  const state: BrowserSessionState = {};

  async function getPage(): Promise<Page> {
    // After `close()`, every operation must fail fast rather than silently
    // relaunching a fresh browser.
    if (closed) throw new BrowserSessionClosedError('browser session is closed');
    if (page !== undefined) return page;
    if (launchPromise !== undefined) return launchPromise;
    launchPromise = launch();
    return launchPromise;
  }

  async function launch(): Promise<Page> {
    // Ensure the persistent profile directory exists so Chromium can use it.
    if (!existsSync(profileDir)) {
      mkdirSync(profileDir, { recursive: true });
    }

    let launched: Browser;
    try {
      launched = await chromium.launch({ headless, userDataDir: profileDir });
    } catch (error) {
      // Playwright throws when the executable is missing; surface an actionable
      // install hint instead of a raw launch error.
      throw new BrowserUnavailableError(
        'headless Chromium could not be launched. Install it with: ' +
          'pnpm --dir apps/desktop e2e:install',
        { cause: error },
      );
    }
    browser = launched;
    const viewport = {
      width: Math.min(requestedViewport.width, maxDimension),
      height: Math.min(requestedViewport.height, maxDimension),
    };
    context = await launched.newContext({
      viewport,
      ...(options.userAgent !== undefined ? { userAgent: options.userAgent } : {}),
    });
    // Context-level init script so @medv/finder is present on every page and
    // navigation (including the initial about:blank document).
    await injectFinder(context);
    page = await context.newPage();

    page.on('framenavigated', () => {
      void emitState();
    });
    page.on('load', () => {
      void emitState();
      void frameLoop.requestFrame();
    });

    if (captureConsoleAndNetwork) {
      attachConsoleAndNetworkListeners(page, context, subscribers);
    }

    return page;
  }

  function emitState(): Promise<void> {
    if (page === undefined) return Promise.resolve();
    return Promise.all([page.url(), page.title()])
      .then(([url, title]) => {
        if (url !== '') state.url = url;
        state.title = title;
        const ts = Date.now();
        for (const listener of subscribers) {
          listener({
            type: 'browser/state',
            ...(state.url !== undefined ? { url: state.url } : {}),
            title: state.title,
            ts,
          });
        }
      })
      .catch(() => {
        // URL/title read failed (e.g. during navigation teardown); keep last state.
      });
  }

  const frameLoop: FrameLoop = createFrameLoop({
    capture: async () => {
      const activePage = await getPage();
      const buffer = await activePage.screenshot({ type: 'jpeg', quality: 70 });
      const viewport = activePage.viewportSize() ?? { width: maxDimension, height: maxDimension };
      return {
        dataUrl: `data:image/jpeg;base64,${buffer.toString('base64')}`,
        width: viewport.width,
        height: viewport.height,
      };
    },
    hasSubscriber: () => subscribers.size > 0,
    intervalMs: Math.round(1000 / maxFps),
    emit: (frame) => {
      const event: BrowserFramePush = { type: 'browser/frame', ...frame };
      for (const listener of subscribers) listener(event);
    },
  });

  function subscribe(listener: (event: BrowserSessionEvent) => void): () => void {
    subscribers.add(listener);
    if (subscribers.size === 1) frameLoop.start();
    void pushInitialState();
    return () => {
      subscribers.delete(listener);
      if (subscribers.size === 0) frameLoop.stop();
    };
  }

  /** Launches (if needed) so the first state push and frame reflect a real page. */
  async function pushInitialState(): Promise<void> {
    try {
      await getPage();
    } catch {
      // Launch failures surface on the first real operation, not here.
    }
    await emitState();
    await frameLoop.requestFrame();
  }

  function withAbort<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(new AbortOperationError('operation aborted'));
    return runExclusive(operation);
  }

  return {
    navigate: (url, options) =>
      withAbort(async () => {
        assertHttpUrl(url);
        const activePage = await getPage();
        await activePage.goto(url);
        await emitState();
        await frameLoop.requestFrame();
      }, options?.signal),

    snapshot: (options) =>
      withAbort(async () => {
        const activePage = await getPage();
        const yamlText = await activePage.locator('html').ariaSnapshot({ mode: 'ai', boxes: true });
        return parseAriaSnapshot(yamlText);
      }, options?.signal),

    click: (target, options) =>
      withAbort(async () => {
        const activePage = await getPage();
        await activePage.locator(toLocator(target)).click();
      }, options?.signal),

    type: (target, text, options) =>
      withAbort(async () => {
        const activePage = await getPage();
        await activePage.locator(toLocator(target)).click();
        await activePage.keyboard.type(text);
      }, options?.signal),

    fillForm: (fields, options) =>
      withAbort(async () => {
        const activePage = await getPage();
        for (const [target, value] of Object.entries(fields)) {
          await activePage.locator(toLocator(target)).fill(value);
        }
      }, options?.signal),

    scroll: (delta, options) =>
      withAbort(async () => {
        const activePage = await getPage();
        await activePage.mouse.wheel(delta.x ?? 0, delta.y ?? 0);
      }, options?.signal),

    screenshot: (path, options) =>
      withAbort(async () => {
        const activePage = await getPage();
        const buffer = await activePage.screenshot({ type: 'jpeg', quality: 70 });
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
      }, options?.signal),

    back: (options) =>
      withAbort(async () => {
        const activePage = await getPage();
        await activePage.goBack();
        await emitState();
      }, options?.signal),

    forward: (options) =>
      withAbort(async () => {
        const activePage = await getPage();
        await activePage.goForward();
        await emitState();
      }, options?.signal),

    find: (text, options) =>
      withAbort(async () => {
        const activePage = await getPage();
        const count = await activePage.getByText(text, { exact: false }).count();
        return { count };
      }, options?.signal),

    wait: (ms, options) =>
      withAbort(async () => {
        const signal = options?.signal;
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
      }, options?.signal),

    pickElementAt: (x, y, options) =>
      withAbort(async () => {
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
        if (options?.screenshotPath !== undefined) {
          const { mkdir, writeFile } = await import('node:fs/promises');
          const { dirname } = await import('node:path');
          await mkdir(dirname(options.screenshotPath), { recursive: true });
          await writeFile(
            options.screenshotPath,
            await activePage.screenshot({
              type: 'jpeg',
              quality: 70,
              clip: { ...picked.boundingRect },
            }),
          );
          result.screenshotPath = options.screenshotPath;
        }
        return result;
      }, options?.signal),

    runExclusive,

    subscribe,

    currentState: () => ({ ...state }),

    close: () =>
      runExclusive(async () => {
        if (closed) return;
        closed = true;
        frameLoop.stop();
        subscribers.clear();
        // A launch kicked off by subscribe()/pushInitialState() runs outside
        // the mutex and may still be in flight when close() lands. Wait for it
        // so the spawned Chromium child is always closed — otherwise the child
        // is orphaned and its stdio pipes keep the host's event loop alive.
        if (launchPromise !== undefined) {
          try {
            await launchPromise;
          } catch {
            // Launch failed (e.g. missing binary); there is no browser to close.
          }
        }
        if (browser !== undefined) {
          await browser.close();
          browser = undefined;
          context = undefined;
          page = undefined;
          launchPromise = undefined;
        }
      }),
  };
}
