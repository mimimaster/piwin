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
import type {
  BrowserControllerPush,
  BrowserInputEvent,
  BrowserSnapshotNode,
  HostPush,
  WebElementPickResult,
} from '@piwin/contracts';
import { BROWSER_USER_HAS_CONTROL } from '@piwin/contracts';
import { createExclusiveQueue } from './mutex.js';
import type { RunExclusive } from './mutex.js';
import { createFrameLoop } from './frames.js';
import type { FrameLoop } from './frames.js';
import { injectFinder, pickElementAt } from './pick.js';
import { parseAriaSnapshot } from './snapshot.js';
import {
  createBrowserController,
  type BrowserControllerState,
} from './controller.js';
import { startScreencast, type ScreencastHandle } from './screencast.js';
import { dispatchBrowserInput, isMouseMoveOnly } from './input.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type BrowserFramePush = Extract<HostPush, { type: 'browser/frame' }>;
export type BrowserStatePush = Extract<HostPush, { type: 'browser/state' }>;
export type BrowserConsolePush = Extract<HostPush, { type: 'browser/console' }>;
export type BrowserNetworkPush = Extract<HostPush, { type: 'browser/network' }>;
export type BrowserControllerEvent = BrowserControllerPush;
export type BrowserSessionEvent =
  | BrowserFramePush
  | BrowserStatePush
  | BrowserConsolePush
  | BrowserNetworkPush
  | BrowserControllerEvent;

export type BrowserActor = 'agent' | 'user';

export type BrowserOpOptions = { signal?: AbortSignal; actor?: BrowserActor };

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
  /**
   * Acquire the desktop mirror lease. This launches Chromium lazily and starts
   * bounded frame streaming, but does not change the lifetime of this service
   * object.
   */
  start(leaseId?: string): Promise<BrowserSessionState>;
  /**
   * Release one desktop mirror lease. Releasing the final lease also releases
   * the current Chromium process. The service remains reusable so a later
   * panel open or agent tool can relaunch.
   */
  stop(leaseId?: string): Promise<void>;
  navigate(url: string, options?: BrowserOpOptions): Promise<void>;
  snapshot(options?: { signal?: AbortSignal }): Promise<BrowserSnapshotNode[]>;
  click(target: string, options?: BrowserOpOptions): Promise<void>;
  type(target: string, text: string, options?: BrowserOpOptions): Promise<void>;
  fillForm(fields: Record<string, string>, options?: BrowserOpOptions): Promise<void>;
  scroll(delta: { x?: number; y?: number }, options?: BrowserOpOptions): Promise<void>;
  screenshot(path?: string, options?: { signal?: AbortSignal }): Promise<ScreenshotResult>;
  back(options?: BrowserOpOptions): Promise<void>;
  forward(options?: BrowserOpOptions): Promise<void>;
  find(text: string, options?: { signal?: AbortSignal }): Promise<{ count: number }>;
  wait(ms: number, options?: { signal?: AbortSignal }): Promise<void>;
  pickElementAt(
    x: number,
    y: number,
    options?: { signal?: AbortSignal; screenshotPath?: string },
  ): Promise<WebElementPickResult>;
  dispatchInput(events: BrowserInputEvent[], options?: { signal?: AbortSignal }): Promise<void>;
  takeOver(): Promise<BrowserControllerState>;
  giveBack(): Promise<BrowserControllerState>;
  lock(owner: BrowserActor): Promise<BrowserControllerState>;
  unlock(owner: BrowserActor): Promise<BrowserControllerState>;
  releaseAgentControl(): Promise<void>;
  controllerState(): BrowserControllerState;
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

export class BrowserUserHasControlError extends BrowserSessionError {
  override name: string = 'BrowserUserHasControlError';
  readonly code = BROWSER_USER_HAS_CONTROL;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const HTTP_URL_RE = /^https?:\/\//i;
/** Playwright aria refs look like `e5`; anything else is treated as a CSS selector. */
const ARIA_REF_RE = /^e\d+$/i;
const MAX_MIRROR_LEASE_ID_CHARS = 128;
const MAX_RELEASED_MIRROR_LEASES = 256;
const MAX_INPUT_EVENTS = 64;

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
      method: response.request().method(),
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
  const controller = createBrowserController();

  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let launchPromise: Promise<Page> | undefined;
  let legacyMirrorLeaseActive = false;
  const activeMirrorLeaseIds = new Set<string>();
  const releasedMirrorLeaseIds = new Set<string>();
  let closed = false;
  let consoleAttached = false;
  let screencastHandle: ScreencastHandle | undefined;

  const state: BrowserSessionState = {};

  async function getPage(): Promise<Page> {
    // After `close()`, every operation must fail fast rather than silently
    // relaunching a fresh browser.
    if (closed) throw new BrowserSessionClosedError('browser session is closed');
    if (page !== undefined) return page;
    if (launchPromise !== undefined) return launchPromise;
    const pendingLaunch = launch();
    launchPromise = pendingLaunch;
    try {
      return await pendingLaunch;
    } catch (error) {
      // A failed initialization must not poison this reusable service with a
      // permanently rejected promise. `launch()` has already closed any
      // context it created, so a later panel/tool operation may retry.
      if (launchPromise === pendingLaunch) launchPromise = undefined;
      throw error;
    }
  }

  async function launch(): Promise<Page> {
    // Ensure the persistent profile directory exists so Chromium can use it.
    if (!existsSync(profileDir)) {
      mkdirSync(profileDir, { recursive: true });
    }

    const viewport = {
      width: Math.min(requestedViewport.width, maxDimension),
      height: Math.min(requestedViewport.height, maxDimension),
    };
    let launched: BrowserContext;
    try {
      // Persistent profile keeps cookies/session across launches; the returned
      // context owns the single Chromium instance for this profile dir.
      launched = await chromium.launchPersistentContext(profileDir, {
        headless,
        viewport,
        ...(options.userAgent !== undefined ? { userAgent: options.userAgent } : {}),
      });
    } catch (error) {
      // Playwright throws when the executable is missing; surface an actionable
      // install hint instead of a raw launch error.
      throw new BrowserUnavailableError(
        'headless Chromium could not be launched. Install it with: ' +
          'pnpm --dir apps/desktop e2e:install',
        { cause: error },
      );
    }
    try {
      // Persistent Chromium starts with one about:blank page. Reuse it rather
      // than creating a second renderer for every browser-panel lifetime.
      await injectFinder(launched);
      const initializedPage = launched.pages()[0] ?? (await launched.newPage());

      browser = launched.browser() ?? undefined;
      context = launched;
      page = initializedPage;

      initializedPage.on('framenavigated', () => {
        void emitState();
      });
      initializedPage.on('load', () => {
        void emitState();
        void frameLoop.requestFrame();
      });

      if (captureConsoleAndNetwork) {
        attachConsoleAndNetworkListeners(initializedPage, launched, subscribers);
        consoleAttached = true;
      }

      return initializedPage;
    } catch (error) {
      // Runtime initialization is transactional. A context that launched but
      // failed Finder injection/page setup must not survive until a later
      // panel cleanup that may never arrive.
      try {
        await launched.close();
      } catch (closeError) {
        throw new AggregateError(
          [error, closeError],
          'browser runtime initialization and cleanup both failed',
        );
      }
      throw error;
    }
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

  function emitController(reason?: string): void {
    const snapshot = controller.snapshot();
    const event: BrowserControllerPush = {
      type: 'browser/controller',
      owner: snapshot.owner,
      ts: Date.now(),
      ...(snapshot.agentWantsLock ? { agentWantsLock: true } : {}),
      ...(reason !== undefined ? { reason } : {}),
    };
    for (const listener of subscribers) listener(event);
  }

  function assertActor(actor: BrowserActor, reason: string): void {
    const result = controller.acquire(actor);
    if (!result.ok) {
      if (result.code === BROWSER_USER_HAS_CONTROL) {
        throw new BrowserUserHasControlError(
          'The user has the browser. Wait or ask them to give it back.',
        );
      }
      throw new BrowserSessionError('The agent is using the browser.');
    }
    if (result.changed) emitController(reason);
  }

  function ensureConsoleCapture(activePage: Page, activeContext: BrowserContext): void {
    if (consoleAttached) return;
    attachConsoleAndNetworkListeners(activePage, activeContext, subscribers);
    consoleAttached = true;
  }

  async function stopScreencast(): Promise<void> {
    const handle = screencastHandle;
    screencastHandle = undefined;
    if (handle !== undefined) await handle.stop();
  }

  async function startMirrorFrames(activePage: Page): Promise<void> {
    if (screencastHandle !== undefined) return;
    try {
      screencastHandle = await startScreencast(activePage, {
        maxDimension,
        emit: (frame) => {
          if (!hasActiveMirrorLease()) return;
          const event: BrowserFramePush = { type: 'browser/frame', ...frame };
          for (const listener of subscribers) listener(event);
        },
      });
      frameLoop.stop();
    } catch {
      screencastHandle = undefined;
      if (subscribers.size > 0) frameLoop.start();
    }
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
    // HostRuntime keeps one event subscriber for the service lifetime so tool
    // state can still be forwarded. That subscriber must not itself keep the
    // frame timer or Chromium alive while the desktop panel is closed.
    hasSubscriber: () => hasActiveMirrorLease() && subscribers.size > 0,
    intervalMs: Math.round(1000 / maxFps),
    emit: (frame) => {
      const event: BrowserFramePush = { type: 'browser/frame', ...frame };
      for (const listener of subscribers) listener(event);
    },
  });

  function subscribe(listener: (event: BrowserSessionEvent) => void): () => void {
    subscribers.add(listener);
    // Subscription is deliberately passive. HostRuntime subscribes while
    // composing tools; launching here would make Chromium resident before the
    // browser panel or an agent tool has actually requested it.
    if (hasActiveMirrorLease() && page !== undefined) {
      if (screencastHandle === undefined) {
        frameLoop.start();
        void frameLoop.requestFrame();
      }
      void emitState();
    }
    return () => {
      subscribers.delete(listener);
      if (subscribers.size === 0) frameLoop.stop();
    };
  }

  function hasActiveMirrorLease(): boolean {
    return legacyMirrorLeaseActive || activeMirrorLeaseIds.size > 0;
  }

  function validateMirrorLeaseId(leaseId: string | undefined): string | undefined {
    if (leaseId === undefined) return undefined;
    if (leaseId.length === 0 || leaseId.length > MAX_MIRROR_LEASE_ID_CHARS) {
      throw new RangeError('browser mirror lease id is invalid');
    }
    return leaseId;
  }

  function rememberReleasedMirrorLease(leaseId: string): void {
    releasedMirrorLeaseIds.delete(leaseId);
    releasedMirrorLeaseIds.add(leaseId);
    while (releasedMirrorLeaseIds.size > MAX_RELEASED_MIRROR_LEASES) {
      const oldestLeaseId = releasedMirrorLeaseIds.values().next().value;
      if (typeof oldestLeaseId !== 'string') break;
      releasedMirrorLeaseIds.delete(oldestLeaseId);
    }
  }

  /**
   * Release only the current Playwright runtime. Keeping this separate from
   * permanent `close()` lets already-registered agent tools relaunch after the
   * desktop mirror has been closed.
   */
  async function releaseRuntime(): Promise<void> {
    const pendingLaunch = launchPromise;
    if (pendingLaunch !== undefined) {
      try {
        await pendingLaunch;
      } catch {
        // Launch failed before a process became usable; clear the rejected
        // promise so a later start/tool call can retry.
      }
    }

    await stopScreencast();

    const activeContext = context;
    const activeBrowser = browser;
    page = undefined;
    context = undefined;
    browser = undefined;
    launchPromise = undefined;
    consoleAttached = false;

    let contextCloseError: unknown;
    if (activeContext !== undefined) {
      try {
        // A persistent BrowserContext owns its Chromium process. Closing the
        // context is Playwright's authoritative shutdown path and waits for
        // the child process to exit.
        await activeContext.close();
        return;
      } catch (error) {
        contextCloseError = error;
      }
    }
    if (activeBrowser !== undefined) {
      // Fallback for partially initialized contexts or a failed context close.
      await activeBrowser.close();
      return;
    }
    if (contextCloseError instanceof Error) {
      throw contextCloseError;
    }
  }

  function withAbort<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(new AbortOperationError('operation aborted'));
    return runExclusive(operation);
  }

  return {
    start: (leaseId) =>
      runExclusive(async () => {
        if (closed) throw new BrowserSessionClosedError('browser session is closed');
        const normalizedLeaseId = validateMirrorLeaseId(leaseId);
        if (normalizedLeaseId !== undefined && releasedMirrorLeaseIds.has(normalizedLeaseId)) {
          // A cleanup that overtook its setup owns the final intent. Lease ids
          // are one-shot, so a delayed/retried start must not resurrect a panel
          // that has already unmounted.
          return { ...state };
        }
        if (normalizedLeaseId === undefined) {
          legacyMirrorLeaseActive = true;
        } else {
          activeMirrorLeaseIds.add(normalizedLeaseId);
        }
        await getPage();
        if (page !== undefined && context !== undefined) {
          ensureConsoleCapture(page, context);
        }
        if (page !== undefined) await startMirrorFrames(page);
        if (subscribers.size > 0 && screencastHandle === undefined) frameLoop.start();
        await emitState();
        if (screencastHandle === undefined) await frameLoop.requestFrame();
        emitController('mirror-start');
        return { ...state };
      }),

    stop: (leaseId) =>
      runExclusive(async () => {
        if (closed) return;
        const normalizedLeaseId = validateMirrorLeaseId(leaseId);
        if (normalizedLeaseId === undefined) {
          legacyMirrorLeaseActive = false;
        } else {
          activeMirrorLeaseIds.delete(normalizedLeaseId);
          rememberReleasedMirrorLease(normalizedLeaseId);
        }
        if (hasActiveMirrorLease()) return;
        // Closing the workbench must not leave a sticky user lock; agent tools
        // relaunch Chromium from the same session. Agent ownership is unchanged.
        const previous = controller.snapshot();
        const next = controller.giveBack();
        if (previous.owner !== next.owner) emitController('mirror-stop');
        frameLoop.stop();
        await stopScreencast();
        await releaseRuntime();
        delete state.url;
        delete state.title;
      }),

    navigate: (url, options) =>
      withAbort(async () => {
        assertActor(options?.actor ?? 'agent', options?.actor === 'user' ? 'user-write' : 'agent-write');
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
        assertActor(options?.actor ?? 'agent', 'agent-write');
        const activePage = await getPage();
        await activePage.locator(toLocator(target)).click();
      }, options?.signal),

    type: (target, text, options) =>
      withAbort(async () => {
        assertActor(options?.actor ?? 'agent', 'agent-write');
        const activePage = await getPage();
        await activePage.locator(toLocator(target)).click();
        await activePage.keyboard.type(text);
      }, options?.signal),

    fillForm: (fields, options) =>
      withAbort(async () => {
        assertActor(options?.actor ?? 'agent', 'agent-write');
        const activePage = await getPage();
        for (const [target, value] of Object.entries(fields)) {
          await activePage.locator(toLocator(target)).fill(value);
        }
      }, options?.signal),

    scroll: (delta, options) =>
      withAbort(async () => {
        assertActor(options?.actor ?? 'agent', 'agent-write');
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
        assertActor(options?.actor ?? 'agent', options?.actor === 'user' ? 'user-write' : 'agent-write');
        const activePage = await getPage();
        await activePage.goBack();
        await emitState();
      }, options?.signal),

    forward: (options) =>
      withAbort(async () => {
        assertActor(options?.actor ?? 'agent', options?.actor === 'user' ? 'user-write' : 'agent-write');
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

    dispatchInput: (events, options) => {
      if (events.length > MAX_INPUT_EVENTS) {
        return Promise.reject(new BrowserSessionError('browser input batch is too large'));
      }
      if (events.length === 0) return Promise.resolve();
      const moveOnly = isMouseMoveOnly(events);
      const operate = async (): Promise<void> => {
        if (moveOnly) {
          // Hover must not promote idle → user (that lock has no timeout).
          if (controller.snapshot().owner === 'agent') {
            throw new BrowserSessionError('The agent is using the browser.');
          }
        } else {
          assertActor('user', 'user-write');
        }
        const activePage = await getPage();
        await dispatchBrowserInput(activePage, events);
      };
      if (moveOnly) return operate();
      return withAbort(operate, options?.signal);
    },

    takeOver: async () => {
      const previous = controller.snapshot();
      const next = controller.takeOver();
      if (previous.owner !== next.owner) emitController('take-over');
      return next;
    },

    giveBack: async () => {
      const previous = controller.snapshot();
      const next = controller.giveBack();
      if (previous.owner !== next.owner) emitController('give-back');
      return next;
    },

    lock: async (owner) => {
      if (owner === 'user') {
        const previous = controller.snapshot();
        const next = controller.takeOver();
        if (previous.owner !== next.owner) emitController('take-over');
        return next;
      }
      assertActor('agent', 'agent-lock');
      return controller.snapshot();
    },

    unlock: async (owner) => {
      if (owner === 'user') {
        const previous = controller.snapshot();
        const next = controller.giveBack();
        if (previous.owner !== next.owner) emitController('give-back');
        return next;
      }
      const previous = controller.snapshot();
      const next = controller.releaseAgentControl();
      if (previous.owner !== next.owner || previous.agentWantsLock !== next.agentWantsLock) {
        emitController('agent-unlock');
      }
      return next;
    },

    releaseAgentControl: async () => {
      const previous = controller.snapshot();
      const next = controller.releaseAgentControl();
      if (previous.owner !== next.owner || previous.agentWantsLock !== next.agentWantsLock) {
        emitController('run-terminal');
      }
    },

    controllerState: () => controller.snapshot(),

    runExclusive,

    subscribe,

    currentState: () => ({ ...state }),

    close: () =>
      runExclusive(async () => {
        if (closed) return;
        closed = true;
        legacyMirrorLeaseActive = false;
        activeMirrorLeaseIds.clear();
        releasedMirrorLeaseIds.clear();
        frameLoop.stop();
        subscribers.clear();
        await releaseRuntime();
        delete state.url;
        delete state.title;
      }),
  };
}
