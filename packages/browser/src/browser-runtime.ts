/**
 * Chromium process, persistent context, page, and mirror-lease lifetime.
 * Launch is lazy. Failures are recovered by layer (page vs context/browser);
 * `close()`/`markClosed()` never relaunches. CDP screencast detach is not
 * process death — only page/context/browser lifecycle events are.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Browser, BrowserContext, Page } from 'playwright-core';
import { chromium } from 'playwright-core';
import type { BrowserLifecycle } from '@piwin/contracts';
import { injectFinder } from './pick.js';
import {
  BrowserRuntimeGoneError,
  BrowserSessionClosedError,
  BrowserSessionError,
  BrowserUnavailableError,
  isDeadBrowserError,
} from './browser-errors.js';
import { classifyBrowserLaunchError, getBrowserInstallStatus } from './install-status.js';
import {
  assertLoopbackCdpEndpoint,
  defaultConnectOverCdp,
  type BrowserConnectOverCdp,
  type BrowserOwnership,
} from './browser-cdp.js';
import {
  createBrowserObserver,
  type BrowserConsoleEntry,
  type BrowserDownloadRef,
  type BrowserNetworkEntry,
} from './browser-observe.js';
import {
  createBrowserPageRegistry,
  requireTab,
  type BrowserDialogInfo,
  type BrowserPageKind,
  type BrowserTabInfo,
} from './browser-pages.js';
import type { BrowserSessionEvent } from './browser-session.js';
import { assertNavigableUrl } from './browser-operations.js';

const MAX_MIRROR_LEASE_ID_CHARS = 128;
const MAX_RELEASED_MIRROR_LEASES = 256;
const DEFAULT_LAUNCH_TIMEOUT_MS = 15_000;

export type BrowserPersistentLaunchOptions = {
  headless: boolean;
  viewport: { width: number; height: number };
  deviceScaleFactor?: number;
  userAgent?: string;
};

export type BrowserLaunchPersistentContext = (
  userDataDir: string,
  options: BrowserPersistentLaunchOptions,
) => Promise<BrowserContext>;

export type BrowserRuntimeOptions = {
  headless: boolean;
  profileDir: string;
  userAgent?: string;
  requestedViewport: { width: number; height: number };
  maxDimension: number;
  /** Host-owned launch only. Attached CDP keeps the remote page DPR. */
  deviceScaleFactor?: number;
  captureConsoleAndNetwork: boolean;
  /** Test seam / bound; product default is 15s. */
  launchTimeoutMs?: number;
  launchPersistentContext?: BrowserLaunchPersistentContext;
  /** Explicit loopback CDP endpoint; Playwright connectOverCDP. */
  cdpEndpoint?: string;
  /** Test seam for attach. */
  connectOverCdp?: BrowserConnectOverCdp;
  /** Test seam for dialog auto-dismiss. */
  dialogTimeoutMs?: number;
};

export type BrowserRuntimeHooks = {
  emitState: () => Promise<void>;
  requestFrame: () => Promise<void>;
  stopScreencast: () => Promise<void>;
};

export type BrowserRuntime = {
  isClosed(): boolean;
  assertOpen(): void;
  getPage(): Promise<Page>;
  peekPage(): Page | undefined;
  peekContext(): BrowserContext | undefined;
  hasActiveMirrorLease(): boolean;
  mirrorLeaseCount(): number;
  hasMirrorLease(leaseId: string): boolean;
  /** Returns false when a tombstoned lease must not resurrect the mirror. */
  acquireMirrorLease(leaseId?: string): boolean;
  /** Returns true when the caller should tear the runtime down. */
  releaseMirrorLease(leaseId?: string): boolean;
  clearLeases(): void;
  markClosed(): void;
  ensureConsoleCapture(page: Page, context: BrowserContext): void;
  releaseRuntime(): Promise<void>;
  generation(): number;
  pageId(): string | undefined;
  lifecycle(): BrowserLifecycle;
  pageStateLost(): boolean;
  recoveryCount(): number;
  ownership(): BrowserOwnership;
  ensureConnected(): Promise<void>;
  listTabs(): Promise<BrowserTabInfo[]>;
  /** Bound pages only; does not launch or attach. */
  listBoundTabs(): Promise<BrowserTabInfo[]>;
  newTab(url?: string): Promise<BrowserTabInfo>;
  selectTab(pageId: string): Promise<BrowserTabInfo>;
  closeTab(pageId: string): Promise<void>;
  handleDialog(action: 'accept' | 'dismiss', promptText?: string): Promise<BrowserDialogInfo>;
  pendingDialog(): BrowserDialogInfo | undefined;
  queryConsole(limit?: number): BrowserConsoleEntry[];
  queryNetwork(limit?: number): BrowserNetworkEntry[];
  queryDownloads(limit?: number): BrowserDownloadRef[];
};

export function createBrowserRuntime(
  options: BrowserRuntimeOptions,
  hooks: BrowserRuntimeHooks,
  subscribers: Set<(event: BrowserSessionEvent) => void>,
): BrowserRuntime {
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let launchPromise: Promise<Page> | undefined;
  let recoveryPromise: Promise<Page> | undefined;
  let legacyMirrorLeaseActive = false;
  const activeMirrorLeaseIds = new Set<string>();
  const releasedMirrorLeaseIds = new Set<string>();
  let closed = false;
  let releasing = false;
  let consoleCaptureEnabled = options.captureConsoleAndNetwork;
  let consolePage: Page | undefined;
  let networkContext: BrowserContext | undefined;
  let lifecycle: BrowserLifecycle = 'stopped';
  let generation = 0;
  let pageSeq = 0;
  let pageId: string | undefined;
  let pageStateLost = false;
  let recoveryCount = 0;
  let bindEpoch = 0;
  const launchTimeoutMs = options.launchTimeoutMs ?? DEFAULT_LAUNCH_TIMEOUT_MS;
  const launchPersistentContext =
    options.launchPersistentContext ?? defaultLaunchPersistentContext;
  const connectOverCdp = options.connectOverCdp ?? defaultConnectOverCdp;
  const observer = createBrowserObserver(subscribers, {
    downloadDir: join(options.profileDir, 'downloads'),
  });
  const pages = createBrowserPageRegistry({
    allocatePageId: () => {
      pageSeq += 1;
      return `p-${generation}-${pageSeq}`;
    },
    onDialogChange: () => {
      void hooks.emitState();
    },
    ...(options.dialogTimeoutMs !== undefined ? { dialogTimeoutMs: options.dialogTimeoutMs } : {}),
  });
  let ownership: BrowserOwnership = 'owned';
  let connectPromise: Promise<void> | undefined;
  let intentionalPageClose = false;
  const cdpEndpoint =
    options.cdpEndpoint !== undefined && options.cdpEndpoint.trim() !== ''
      ? options.cdpEndpoint
      : undefined;

  async function getPage(): Promise<Page> {
    if (closed) throw new BrowserSessionClosedError('browser session is closed');
    if (launchPromise !== undefined) return launchPromise;

    if (recoveryPromise !== undefined) {
      try {
        return await recoveryPromise;
      } catch {
        if (closed) throw new BrowserSessionClosedError('browser session is closed');
      }
    }

    if (page !== undefined && isPageUsable(page) && isBrowserConnected()) {
      return page;
    }

    if (canRecoverPage() && ownership !== 'attached') {
      try {
        return await recoverBlankPage();
      } catch (error) {
        if (closed) throw new BrowserSessionClosedError('browser session is closed');
        if (canRecoverPage()) {
          lifecycle = 'failed';
          void hooks.emitState();
          throw error;
        }
      }
    }

    clearDeadRefs();
    if (cdpEndpoint !== undefined) {
      await ensureConnected();
      if (page !== undefined && isPageUsable(page)) return page;
      throw new BrowserSessionError('no target page selected');
    }
    return launchOrJoin();
  }

  async function ensureConnected(): Promise<void> {
    if (closed) throw new BrowserSessionClosedError('browser session is closed');
    if (context !== undefined && isBrowserConnected()) return;
    if (cdpEndpoint !== undefined) {
      if (connectPromise !== undefined) {
        await connectPromise;
        return;
      }
      const pending = connectAttached();
      connectPromise = pending;
      try {
        await pending;
      } finally {
        if (connectPromise === pending) connectPromise = undefined;
      }
      return;
    }
    await getPage();
  }

  function canRecoverPage(): boolean {
    return context !== undefined && isBrowserConnected();
  }

  function bindAndAttach(target: Page, kind: BrowserPageKind) {
    const existed = pages.has(target);
    const entry = pages.bind(target, kind);
    if (!existed) {
      attachPageSideEffects(target);
      pages.attachDialog(target, entry.pageId);
      if (consoleCaptureEnabled) observer.attachPage(target);
    }
    return entry;
  }

  async function disconnectQuietly(target: Browser | undefined): Promise<void> {
    if (target === undefined) return;
    try {
      const targetWithDisconnect = target as Browser & { disconnect?: () => unknown };
      if (typeof targetWithDisconnect.disconnect === 'function') {
        await Promise.resolve(targetWithDisconnect.disconnect());
        return;
      }
      // Playwright 1.61: connected Browser.close() detaches; it is not
      // context.close(), which would close the user's pages.
      await target.close();
    } catch (error) {
      if (isDeadBrowserError(error)) return;
      console.warn(
        '[browser] cdp disconnect failed',
        error instanceof Error ? error.message : error,
      );
    }
  }

  async function connectAttached(): Promise<void> {
    if (cdpEndpoint === undefined) return;
    if (closed) throw new BrowserSessionClosedError('browser session is closed');
    const endpoint = assertLoopbackCdpEndpoint(cdpEndpoint);
    lifecycle = generation === 0 ? 'starting' : 'recovering';
    void hooks.emitState();
    const epoch = bindEpoch;
    let connected: Browser | undefined;
    try {
      connected = await connectOverCdp(endpoint);
    } catch (error) {
      lifecycle = 'failed';
      void hooks.emitState();
      throw new BrowserUnavailableError(
        `cdp connect failed (${error instanceof Error ? error.message : String(error)})`,
        { cause: error, reason: 'startup-failed' },
      );
    }
    if (closed || epoch !== bindEpoch) {
      await disconnectQuietly(connected);
      if (closed) throw new BrowserSessionClosedError('browser session is closed');
      throw new BrowserRuntimeGoneError('browser connect was superseded');
    }
    const contexts = typeof connected.contexts === 'function' ? connected.contexts() : [];
    const ctx = contexts[0];
    if (ctx === undefined) {
      await disconnectQuietly(connected);
      lifecycle = 'failed';
      void hooks.emitState();
      throw new BrowserUnavailableError('cdp connection has no browser context', {
        reason: 'startup-failed',
      });
    }
    try {
      await injectFinder(ctx);
    } catch {
      // External Chrome may reject init scripts; pick is best-effort.
    }
    if (closed || epoch !== bindEpoch) {
      await disconnectQuietly(connected);
      if (closed) throw new BrowserSessionClosedError('browser session is closed');
      throw new BrowserRuntimeGoneError('browser connect was superseded');
    }

    const isRelaunch = generation > 0;
    generation += 1;
    ownership = 'attached';
    browser = connected;
    context = ctx;
    page = undefined;
    pageId = undefined;
    lifecycle = 'ready';
    if (isRelaunch) {
      pageStateLost = true;
      recoveryCount += 1;
    }
    attachContextListeners(ctx);
    attachBrowserListeners(connected);
    pages.attachPopupListener(ctx, (incoming, kind) => {
      bindAndAttach(incoming, kind);
      void hooks.emitState();
    });
    if (consoleCaptureEnabled) observer.attachContext(ctx);
    const existingPages = typeof ctx.pages === 'function' ? ctx.pages() : [];
    for (const existingPage of existingPages) {
      bindAndAttach(existingPage, 'page');
    }
    void hooks.emitState();
  }

  async function launchOrJoin(): Promise<Page> {
    if (closed) throw new BrowserSessionClosedError('browser session is closed');
    if (launchPromise !== undefined) return launchPromise;
    lifecycle = generation === 0 ? 'starting' : 'recovering';
    void hooks.emitState();
    const pendingLaunch = launch();
    launchPromise = pendingLaunch;
    try {
      return await pendingLaunch;
    } catch (error) {
      if (!closed) {
        lifecycle = 'failed';
        void hooks.emitState();
      }
      throw error;
    } finally {
      if (launchPromise === pendingLaunch) launchPromise = undefined;
    }
  }

  async function launch(): Promise<Page> {
    if (!existsSync(options.profileDir)) {
      mkdirSync(options.profileDir, { recursive: true });
    }

    const viewport = {
      width: Math.min(options.requestedViewport.width, options.maxDimension),
      height: Math.min(options.requestedViewport.height, options.maxDimension),
    };
    const guard = { cancelled: false };
    const epoch = bindEpoch;
    let launched: BrowserContext | undefined;

    const work = (async (): Promise<Page> => {
      try {
        launched = await launchPersistentContext(options.profileDir, {
          headless: options.headless,
          viewport,
          ...(options.deviceScaleFactor !== undefined
            ? { deviceScaleFactor: options.deviceScaleFactor }
            : {}),
          ...(options.userAgent !== undefined ? { userAgent: options.userAgent } : {}),
        });
      } catch (error) {
        const reason = classifyBrowserLaunchError(error);
        const status = getBrowserInstallStatus();
        const hint = status.hint ?? 'Chromium could not be launched';
        throw new BrowserUnavailableError(
          reason === 'binary-missing'
            ? `headless Chromium could not be launched. ${hint}`
            : reason === 'profile-in-use'
              ? 'browser profile is already in use by another Chromium'
              : `headless Chromium failed to start (${error instanceof Error ? error.message : String(error)})`,
          { cause: error, reason },
        );
      }

      if (closed || guard.cancelled || epoch !== bindEpoch) {
        await closeQuietly(launched);
        launched = undefined;
        if (closed) throw new BrowserSessionClosedError('browser session is closed');
        if (guard.cancelled) throw launchTimeoutError(launchTimeoutMs);
        throw new BrowserRuntimeGoneError('browser launch was superseded');
      }

      try {
        await injectFinder(launched);
        const existing = launched.pages()[0];
        const initializedPage =
          existing !== undefined && isPageUsable(existing)
            ? existing
            : await launched.newPage();
        if (closed || guard.cancelled || epoch !== bindEpoch) {
          await closeQuietly(launched);
          launched = undefined;
          if (closed) throw new BrowserSessionClosedError('browser session is closed');
          if (guard.cancelled) throw launchTimeoutError(launchTimeoutMs);
          throw new BrowserRuntimeGoneError('browser launch was superseded');
        }
        return publishRuntime(launched, initializedPage, guard, epoch, { freshLaunch: true });
      } catch (error) {
        if (launched !== undefined && context !== launched) {
          try {
            await launched.close();
          } catch (closeError) {
            if (!isDeadBrowserError(closeError)) {
              throw new AggregateError(
                [error, closeError],
                'browser runtime initialization and cleanup both failed',
              );
            }
          }
          launched = undefined;
        }
        throw error;
      }
    })();

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        guard.cancelled = true;
        reject(launchTimeoutError(launchTimeoutMs));
      }, launchTimeoutMs);
    });

    try {
      return await Promise.race([work, timeoutPromise]);
    } catch (error) {
      guard.cancelled = true;
      if (launched !== undefined && context !== launched) {
        await closeQuietly(launched);
        launched = undefined;
      }
      void work.then(
        async (latePage) => {
          if (!guard.cancelled && !closed) return;
          await closeQuietly(latePage.context());
        },
        () => undefined,
      );
      throw error;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  function publishRuntime(
    launched: BrowserContext,
    initializedPage: Page,
    guard: { cancelled: boolean },
    epoch: number,
    bind: { freshLaunch: boolean },
  ): Page {
    if (closed || guard.cancelled || epoch !== bindEpoch) {
      void closeQuietly(launched);
      if (closed) throw new BrowserSessionClosedError('browser session is closed');
      if (guard.cancelled) throw launchTimeoutError(launchTimeoutMs);
      throw new BrowserRuntimeGoneError('browser launch was superseded');
    }

    const isRelaunch = generation > 0;
    generation += 1;
    ownership = 'owned';
    browser = launched.browser() ?? undefined;
    context = launched;
    page = initializedPage;
    const bound = bindAndAttach(initializedPage, 'page');
    pageId = bound.pageId;
    lifecycle = 'ready';
    if (bind.freshLaunch) {
      pageStateLost = isRelaunch;
      if (isRelaunch) recoveryCount += 1;
    }

    if (closed || guard.cancelled || epoch !== bindEpoch) {
      const published = context;
      page = undefined;
      context = undefined;
      browser = undefined;
      pageId = undefined;
      void closeQuietly(published);
      if (closed) throw new BrowserSessionClosedError('browser session is closed');
      if (guard.cancelled) throw launchTimeoutError(launchTimeoutMs);
      throw new BrowserRuntimeGoneError('browser launch was superseded');
    }

    attachContextListeners(launched);
    if (browser !== undefined) attachBrowserListeners(browser);
    pages.attachPopupListener(launched, (incoming, kind) => {
      bindAndAttach(incoming, kind);
      void hooks.emitState();
    });
    attachConsoleAndNetwork(initializedPage, launched);
    void hooks.emitState();
    return initializedPage;
  }

  async function recoverBlankPage(): Promise<Page> {
    if (recoveryPromise !== undefined) return recoveryPromise;
    const pending = doRecoverBlankPage();
    recoveryPromise = pending;
    try {
      return await pending;
    } finally {
      if (recoveryPromise === pending) recoveryPromise = undefined;
    }
  }

  async function doRecoverBlankPage(): Promise<Page> {
    const activeContext = context;
    if (activeContext === undefined || !isBrowserConnected()) {
      clearDeadRefs();
      throw new BrowserRuntimeGoneError('browser context is gone');
    }
    lifecycle = 'recovering';
    page = undefined;
    pageId = undefined;
    consolePage = undefined;
    void hooks.emitState();

    const epoch = bindEpoch;
    const guard = { cancelled: false };
    let created: Page | undefined;
    const work = (async (): Promise<Page> => {
      let blank: Page;
      try {
        // Never adopt another existing tab; stage A always opens a blank page.
        blank = await activeContext.newPage();
      } catch (error) {
        if (isDeadBrowserError(error)) clearDeadRefs();
        throw error;
      }
      created = blank;
      if (closed) {
        await closeQuietly(blank);
        throw new BrowserSessionClosedError('browser session is closed');
      }
      if (guard.cancelled) {
        await closeQuietly(blank);
        throw launchTimeoutError(launchTimeoutMs);
      }
      if (epoch !== bindEpoch) {
        await closeQuietly(blank);
        throw new BrowserRuntimeGoneError('browser page recovery was superseded');
      }
      if (context !== activeContext || !isBrowserConnected() || !isPageUsable(blank)) {
        await closeQuietly(blank);
        if (!isBrowserConnected()) clearDeadRefs();
        throw new BrowserRuntimeGoneError('browser page could not be recovered');
      }
      page = blank;
      const bound = bindAndAttach(blank, 'page');
      pageId = bound.pageId;
      pageStateLost = true;
      recoveryCount += 1;
      lifecycle = 'ready';
      attachConsoleAndNetwork(blank, activeContext);
      void hooks.emitState();
      void hooks.requestFrame();
      return blank;
    })();

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        guard.cancelled = true;
        reject(launchTimeoutError(launchTimeoutMs));
      }, launchTimeoutMs);
    });

    try {
      return await Promise.race([work, timeoutPromise]);
    } catch (error) {
      guard.cancelled = true;
      if (created !== undefined && page !== created) {
        await closeQuietly(created);
      }
      void work.then(
        async (latePage) => {
          if (!guard.cancelled && !closed && page === latePage) return;
          await closeQuietly(latePage);
        },
        () => undefined,
      );
      throw error;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  function attachPageSideEffects(activePage: Page): void {
    activePage.on('framenavigated', () => {
      void hooks.emitState();
    });
    activePage.on('load', () => {
      void hooks.emitState();
      void hooks.requestFrame();
    });
    activePage.on('close', () => {
      handlePageDeath(activePage);
    });
    activePage.on('crash', () => {
      handlePageDeath(activePage);
    });
  }

  function attachContextListeners(activeContext: BrowserContext): void {
    activeContext.on('close', () => {
      if (closed || releasing) return;
      if (context !== activeContext) return;
      handleRuntimeDeath();
    });
  }

  function attachBrowserListeners(activeBrowser: Browser): void {
    if (typeof activeBrowser.on !== 'function') return;
    activeBrowser.on('disconnected', () => {
      if (closed || releasing) return;
      if (browser !== activeBrowser) return;
      handleRuntimeDeath();
    });
  }

  function handlePageDeath(deadPage: Page): void {
    if (closed || releasing) return;
    pages.unbind(deadPage);
    if (page !== deadPage) return;
    page = undefined;
    pageId = undefined;
    consolePage = undefined;
    pageStateLost = true;
    const contextAlive = canRecoverPage();
    lifecycle = contextAlive ? 'recovering' : 'stopped';
    void hooks.stopScreencast();
    void hooks.emitState();
    if (intentionalPageClose || ownership === 'attached') {
      if (contextAlive) lifecycle = 'ready';
      void hooks.emitState();
      return;
    }
    if (!contextAlive || !hasActiveMirrorLease()) return;
    void recoverBlankPage().catch(() => {
      if (!closed && lifecycle === 'recovering') {
        lifecycle = 'failed';
        void hooks.emitState();
      }
    });
  }

  function handleRuntimeDeath(): void {
    if (closed || releasing) return;
    const wasStartingOrRecovering = lifecycle === 'starting' || lifecycle === 'recovering';
    clearDeadRefs();
    pageStateLost = true;
    const shouldRelaunch = hasActiveMirrorLease() && !wasStartingOrRecovering;
    lifecycle = shouldRelaunch ? 'recovering' : wasStartingOrRecovering ? 'failed' : 'stopped';
    void hooks.stopScreencast();
    void hooks.emitState();
    if (!shouldRelaunch) return;
    const recover =
      cdpEndpoint !== undefined ? ensureConnected() : launchOrJoin();
    void recover.catch(() => {
      if (!closed && lifecycle !== 'ready') {
        lifecycle = 'failed';
        void hooks.emitState();
      }
    });
  }

  function clearDeadRefs(): void {
    bindEpoch += 1;
    page = undefined;
    context = undefined;
    browser = undefined;
    pageId = undefined;
    consolePage = undefined;
    networkContext = undefined;
    launchPromise = undefined;
  }

  function isPageUsable(activePage: Page): boolean {
    if (typeof activePage.isClosed !== 'function') return true;
    try {
      return !activePage.isClosed();
    } catch {
      return false;
    }
  }

  function isBrowserConnected(): boolean {
    if (browser === undefined) return context !== undefined;
    if (typeof browser.isConnected !== 'function') return true;
    try {
      return browser.isConnected();
    } catch {
      return false;
    }
  }

  function ensureConsoleCapture(activePage: Page, activeContext: BrowserContext): void {
    consoleCaptureEnabled = true;
    attachConsoleAndNetwork(activePage, activeContext);
  }

  function attachConsoleAndNetwork(activePage: Page, activeContext: BrowserContext): void {
    if (!consoleCaptureEnabled) return;
    observer.attachPage(activePage);
    observer.attachContext(activeContext);
    consolePage = activePage;
    networkContext = activeContext;
  }

  function hasActiveMirrorLease(): boolean {
    return legacyMirrorLeaseActive || activeMirrorLeaseIds.size > 0;
  }

  function mirrorLeaseCount(): number {
    return (legacyMirrorLeaseActive ? 1 : 0) + activeMirrorLeaseIds.size;
  }

  function hasMirrorLease(leaseId: string): boolean {
    return activeMirrorLeaseIds.has(leaseId);
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

  function acquireMirrorLease(leaseId?: string): boolean {
    const normalizedLeaseId = validateMirrorLeaseId(leaseId);
    if (normalizedLeaseId !== undefined && releasedMirrorLeaseIds.has(normalizedLeaseId)) {
      // A cleanup that overtook its setup owns the final intent. Lease ids
      // are one-shot, so a delayed/retried start must not resurrect a panel
      // that has already unmounted.
      return false;
    }
    if (normalizedLeaseId === undefined) {
      legacyMirrorLeaseActive = true;
    } else {
      activeMirrorLeaseIds.add(normalizedLeaseId);
    }
    return true;
  }

  function releaseMirrorLease(leaseId?: string): boolean {
    const normalizedLeaseId = validateMirrorLeaseId(leaseId);
    if (normalizedLeaseId === undefined) {
      legacyMirrorLeaseActive = false;
    } else {
      activeMirrorLeaseIds.delete(normalizedLeaseId);
      rememberReleasedMirrorLease(normalizedLeaseId);
    }
    return !hasActiveMirrorLease();
  }

  /**
   * Release only the current Playwright runtime. Keeping this separate from
   * permanent `close()` lets already-registered agent tools relaunch after the
   * desktop mirror has been closed.
   */
  async function releaseRuntime(): Promise<void> {
    releasing = true;
    bindEpoch += 1;
    try {
      const pendingLaunch = launchPromise;
      if (pendingLaunch !== undefined) {
        try {
          await pendingLaunch;
        } catch {
          // Launch failed before a process became usable; clear the rejected
          // promise so a later start/tool call can retry.
        }
      }
      const pendingRecovery = recoveryPromise;
      if (pendingRecovery !== undefined) {
        try {
          await pendingRecovery;
        } catch {
          // Page recovery failed or was cancelled by dispose.
        }
      }

      await hooks.stopScreencast();

      const activeContext = context;
      const activeBrowser = browser;
      const attached = ownership === 'attached';
      page = undefined;
      context = undefined;
      browser = undefined;
      launchPromise = undefined;
      recoveryPromise = undefined;
      connectPromise = undefined;
      consolePage = undefined;
      networkContext = undefined;
      pageId = undefined;
      pages.clear();
      observer.clear();
      if (!closed) lifecycle = 'stopped';

      if (attached) {
        // External Chrome is not Host-owned. disconnect() detaches Playwright
        // without Browser.close / context.close, which would kill user pages.
        await disconnectQuietly(activeBrowser);
        return;
      }

      let contextCloseError: unknown;
      if (activeContext !== undefined) {
        try {
          // A persistent BrowserContext owns its Chromium process. Closing the
          // context is Playwright's authoritative shutdown path and waits for
          // the child process to exit.
          await activeContext.close();
          return;
        } catch (error) {
          if (isDeadBrowserError(error)) return;
          contextCloseError = error;
        }
      }
      if (activeBrowser !== undefined) {
        try {
          await activeBrowser.close();
          return;
        } catch (error) {
          if (isDeadBrowserError(error)) {
            if (contextCloseError instanceof Error && !isDeadBrowserError(contextCloseError)) {
              throw contextCloseError;
            }
            return;
          }
          if (contextCloseError !== undefined) {
            throw new AggregateError(
              [contextCloseError, error],
              'browser runtime cleanup failed',
            );
          }
          throw error;
        }
      }
      if (contextCloseError instanceof Error) {
        throw contextCloseError;
      }
    } finally {
      releasing = false;
    }
  }

  return {
    isClosed: () => closed,
    assertOpen(): void {
      if (closed) throw new BrowserSessionClosedError('browser session is closed');
    },
    getPage,
    peekPage: () => page,
    peekContext: () => context,
    hasActiveMirrorLease,
    mirrorLeaseCount,
    hasMirrorLease,
    acquireMirrorLease,
    releaseMirrorLease,
    clearLeases(): void {
      legacyMirrorLeaseActive = false;
      activeMirrorLeaseIds.clear();
      releasedMirrorLeaseIds.clear();
    },
    markClosed(): void {
      closed = true;
      lifecycle = 'disposed';
    },
    ensureConsoleCapture,
    releaseRuntime,
    generation: () => generation,
    pageId: () => pageId,
    lifecycle: () => lifecycle,
    pageStateLost: () => pageStateLost,
    recoveryCount: () => recoveryCount,
    ownership: () => ownership,
    ensureConnected,
    listTabs: async () => {
      await ensureConnected();
      return pages.list(pageId);
    },
    listBoundTabs: () => pages.list(pageId),
    newTab: async (url) => {
      const targetUrl = typeof url === 'string' && url.trim() !== '' ? url.trim() : undefined;
      if (targetUrl !== undefined) {
        assertNavigableUrl(targetUrl);
      }
      await ensureConnected();
      const activeContext = context;
      if (activeContext === undefined) {
        throw new BrowserRuntimeGoneError('browser context is gone');
      }
      pages.beginOwnedPage();
      let created: Page;
      try {
        created = await activeContext.newPage();
      } finally {
        pages.endOwnedPage();
      }
      const entry = bindAndAttach(created, 'page');
      page = created;
      pageId = entry.pageId;
      if (targetUrl !== undefined) {
        await created.goto(targetUrl, { timeout: 15_000, waitUntil: 'domcontentloaded' });
      }
      void hooks.emitState();
      void hooks.requestFrame();
      const tabs = await pages.list(pageId);
      return (
        tabs.find((tab) => tab.pageId === entry.pageId) ?? {
          pageId: entry.pageId,
          url: url ?? '',
          title: '',
          kind: 'page' as const,
          active: true,
        }
      );
    },
    selectTab: async (targetPageId) => {
      await ensureConnected();
      const entry = requireTab(pages, targetPageId);
      page = entry.page;
      pageId = entry.pageId;
      if (consoleCaptureEnabled) observer.attachPage(entry.page);
      void hooks.emitState();
      void hooks.requestFrame();
      const tabs = await pages.list(pageId);
      return (
        tabs.find((tab) => tab.pageId === entry.pageId) ?? {
          pageId: entry.pageId,
          url: '',
          title: '',
          kind: entry.kind,
          active: true,
        }
      );
    },
    closeTab: async (targetPageId) => {
      await ensureConnected();
      const entry = requireTab(pages, targetPageId);
      intentionalPageClose = true;
      try {
        await entry.page.close();
      } finally {
        intentionalPageClose = false;
      }
      pages.unbind(entry.page);
      if (page === entry.page) {
        page = undefined;
        pageId = undefined;
      }
      void hooks.emitState();
    },
    handleDialog: (action, promptText) => pages.handleDialog(action, promptText),
    pendingDialog: () => pages.pendingDialog(),
    queryConsole: (limit) => observer.queryConsole(limit),
    queryNetwork: (limit) => observer.queryNetwork(limit),
    queryDownloads: (limit) => observer.queryDownloads(limit),
  };
}

function defaultLaunchPersistentContext(
  userDataDir: string,
  launchOptions: BrowserPersistentLaunchOptions,
): Promise<BrowserContext> {
  return chromium.launchPersistentContext(userDataDir, launchOptions);
}

function launchTimeoutError(timeoutMs: number): BrowserUnavailableError {
  return new BrowserUnavailableError(`browser launch timed out after ${timeoutMs}ms`);
}

async function closeQuietly(target: { close: () => Promise<unknown> } | undefined): Promise<void> {
  if (target === undefined) return;
  try {
    await target.close();
  } catch (error) {
    if (isDeadBrowserError(error)) return;
    console.warn('[browser] cleanup failed', error instanceof Error ? error.message : error);
  }
}
