/**
 * Playwright-driven browser session service (ADR 0020 §2). Owns one headless
 * Chromium and exposes the agent tool surface (navigate/click/type/…), element
 * pick, and a throttled screenshot frame stream for the desktop mirror panel.
 *
 * The page is a single shared resource: every operation serializes through a
 * promise-chain mutex ("browser bus") so agent calls and picks never interleave
 * against a mid-navigation page. Chromium launches lazily on first use and fails
 * fast with an actionable error when the binary is missing after first-use install.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Page } from 'playwright-core';
import type {
  BrowserControllerPush,
  BrowserMirrorMode,
  BrowserTargetIdentity,
  BrowserViewportMode,
  BrowserViewportSetBy,
} from '@piwin/contracts';
import {
  BROWSER_FRAME_BINARY_MIME,
} from '@piwin/contracts';
import { createExclusiveQueue, type RunExclusive } from './mutex.js';
import { createBrowserController } from './controller.js';
import { isMouseMoveOnly } from './input.js';
import {
  createBrowserRuntime,
  type BrowserRuntimeHooks,
} from './browser-runtime.js';
import { createBrowserMirror } from './browser-mirror.js';
import { createBrowserFramePublisher } from './browser-frame-publisher.js';
import { createBrowserSessionResidency } from './browser-session-residency.js';
import { readJpegSize } from './jpeg-size.js';
import {
  createBrowserOperations,
  assertNavigableUrl,
} from './browser-operations.js';
import type { BrowserTabInfo } from './browser-pages.js';
import {
  BROWSER_CAPTURE_QUALITY,
  defaultBrowserDeviceScaleFactor,
  BROWSER_SCREENCAST_QUALITY,
  clampBrowserDeviceScaleFactor,
} from './screencast-size.js';
import {
  AbortOperationError,
  BrowserSessionError,
  BrowserStaleTargetError,
} from './browser-errors.js';
import { createMirrorRestartScheduler } from './mirror-restart-scheduler.js';
import type {
  BrowserActor,
  BrowserSession,
  BrowserSessionEvent,
  BrowserSessionOptions,
  BrowserSessionState,
} from './browser-session-types.js';

export type {
  BrowserFramePush,
  BrowserStatePush,
  BrowserConsolePush,
  BrowserNetworkPush,
  BrowserControllerEvent,
  BrowserSessionEvent,
  BrowserActor,
  BrowserOpOptions,
  BrowserScrollOptions,
  BrowserSessionOptions,
  BrowserFrameTransport,
  BrowserSessionState,
  BrowserSessionStatus,
  BrowserRestartResult,
  ScreenshotResult,
  BrowserCaptureResult,
  BrowserSession,
} from './browser-session-types.js';

export {
  BrowserSessionError,
  NavigateError,
  BrowserUnavailableError,
  AbortOperationError,
  BrowserSessionClosedError,
  BrowserUserHasControlError,
  BrowserRuntimeGoneError,
  BrowserStaleTargetError,
  isDeadBrowserError,
} from './browser-errors.js';

export {
  assertHttpUrl,
  assertNavigableUrl,
  isValidBrowserKey,
  clampBrowserWaitForTimeout,
  BROWSER_WAIT_FOR_DEFAULT_TIMEOUT_MS,
  BROWSER_WAIT_FOR_MAX_TIMEOUT_MS,
} from './browser-operations.js';
export type {
  BrowserReloadOptions,
  BrowserWaitForCondition,
  BrowserWaitForOptions,
} from './browser-operations.js';
export type { BrowserOwnership, BrowserConnectOverCdp } from './browser-cdp.js';
export type {
  BrowserConsoleEntry,
  BrowserDownloadRef,
  BrowserNetworkEntry,
} from './browser-observe.js';
export type { BrowserDialogInfo, BrowserTabInfo } from './browser-pages.js';

const MAX_INPUT_EVENTS = 64;

export function createBrowserSession(options: BrowserSessionOptions = {}): BrowserSession {
  const keepAlive = options.keepAlive === true;
  const maxDimension = options.maxDimension ?? 1280;
  const requestedViewport = options.viewport ?? { width: 1280, height: 800 };
  const deviceScaleFactor =
    options.deviceScaleFactor ?? defaultBrowserDeviceScaleFactor(process.platform);
  const screencastQuality = options.screencastQuality ?? BROWSER_SCREENCAST_QUALITY;
  const headless = options.headless ?? true;
  const maxFps = options.maxFps ?? 12;
  const profileDir = options.profileDir ?? join(homedir(), '.piwin', 'browser-profile');
  const captureConsoleAndNetwork = options.captureConsoleAndNetwork ?? false;

  const queue = createExclusiveQueue();
  const runExclusive: RunExclusive = (operation, signal) => residency.runOperation(operation, signal);
  const subscribers = new Set<(event: BrowserSessionEvent) => void>();
  const controller = createBrowserController();
  const state: BrowserSessionState = {};
  let viewportMode: BrowserViewportMode = 'follow';
  let viewportSetBy: BrowserViewportSetBy = 'host';
  /** Only meaningful while `viewportMode === 'follow'`; see BrowserViewportConfig. */
  let viewportFollowLeaseId: string | undefined;
  /** Named lease → the client that holds it (see `start`). */
  const leaseClients = new Map<string, string>();
  /**
   * Monotonic inside one BrowserSession. A main-frame navigation bumps it, so
   * `generation + pageId + documentRevision` is a complete stale-target key.
   */
  let documentRevision = 0;

  const hooks: BrowserRuntimeHooks = {
    emitState: () => Promise.resolve(),
    requestFrame: () => Promise.resolve(),
    stopScreencast: () => Promise.resolve(),
  };
  const runtime = createBrowserRuntime(
    {
      headless,
      profileDir,
      requestedViewport,
      maxDimension,
      deviceScaleFactor,
      captureConsoleAndNetwork,
      ...(options.isolatedContext === undefined ? {} : { isolatedContext: options.isolatedContext }),
      ...(options.args !== undefined ? { args: options.args } : {}),
      ...(options.channel !== undefined ? { channel: options.channel } : {}),
      ...(options.executablePath !== undefined ? { executablePath: options.executablePath } : {}),
      ...(options.ignoreDefaultArgs !== undefined ? { ignoreDefaultArgs: options.ignoreDefaultArgs } : {}),
      ...(options.userAgent !== undefined ? { userAgent: options.userAgent } : {}),
      ...(options.cdpEndpoint !== undefined ? { cdpEndpoint: options.cdpEndpoint } : {}),
      ...(options.connectOverCdp !== undefined ? { connectOverCdp: options.connectOverCdp } : {}),
      ...(options.launchPersistentContext !== undefined
        ? { launchPersistentContext: options.launchPersistentContext }
        : {}),
      ...(options.ensureChromium !== undefined ? { ensureChromium: options.ensureChromium } : {}),
      ...(options.dialogTimeoutMs !== undefined ? { dialogTimeoutMs: options.dialogTimeoutMs } : {}),
    },
    hooks,
    subscribers,
  );
  const residency = createBrowserSessionResidency({
    runtime, controller, runExclusive: queue.runExclusive,
    headless: () => headless, onStateChange: () => emitState(),
    isProtected: () => options.isRuntimeProtected?.() === true,
  });
  async function resolveDeviceScaleFactor(page: Page): Promise<number> {
    if (runtime.ownership() === 'owned') return deviceScaleFactor;
    try {
      const value: unknown = await page.evaluate('window.devicePixelRatio');
      return clampBrowserDeviceScaleFactor(typeof value === 'number' ? value : Number(value));
    } catch {
      return 1;
    }
  }

  const mirror = createBrowserMirror({
    maxDimension,
    maxFps,
    screencastQuality,
    getPage: () => residency.getPage(),
    hasActiveMirrorLease: () => runtime.hasActiveMirrorLease(),
    resolveDeviceScaleFactor,
    onFrame: (frame) => publishFrame(frame),
  });

  // Live screencast already paints after navigate; a screenshot would be a second producer.
  function requestMirrorFrame(): Promise<void> {
    if (mirror.hasScreencast()) return Promise.resolve();
    return mirror.frameLoop.requestFrame();
  }
  hooks.requestFrame = () => requestMirrorFrame();
  hooks.stopScreencast = () => mirror.stopScreencast();

  function currentMirrorMode(): BrowserMirrorMode {
    if (!runtime.hasActiveMirrorLease()) return 'off';
    if (mirror.hasScreencast()) return 'streaming';
    return 'degraded';
  }

  function currentTarget(): BrowserTargetIdentity {
    return {
      generation: runtime.generation(),
      pageId: runtime.pageId() ?? '',
      documentRevision,
    };
  }

  function assertTargetMatches(target: BrowserTargetIdentity | undefined): void {
    if (target === undefined) return;
    const live = currentTarget();
    if (
      target.generation !== live.generation ||
      target.pageId !== live.pageId ||
      target.documentRevision !== live.documentRevision
    ) {
      throw new BrowserStaleTargetError(
        'The browser moved to another document; refresh refs before sending input.',
      );
    }
  }

  const publishFrame = createBrowserFramePublisher({
    identity: () => ({ generation: runtime.generation(), pageId: runtime.pageId() ?? '', documentRevision }),
    transport: options.frameTransport ?? 'inline',
    emit: (event) => { for (const listener of subscribers) listener(event); },
    ...(options.onFrameBytes === undefined ? {} : { onBytes: options.onFrameBytes }),
  });

  function emitState(): Promise<void> {
    const fenceGeneration = runtime.generation();
    const fencePageId = runtime.pageId();
    const activePage = runtime.peekPage();

    const publish = async (url?: string, title?: string): Promise<void> => {
      if (runtime.generation() !== fenceGeneration) return;
      if (runtime.pageId() !== fencePageId) return;
      const pageId = runtime.pageId();
      const ts = Date.now();
      const active = runtime.peekPage();
      const measured =
        active !== undefined && typeof active.viewportSize === 'function'
          ? active.viewportSize()
          : undefined;
      const viewportSize = measured ?? {
        width: Math.min(requestedViewport.width, maxDimension),
        height: Math.min(requestedViewport.height, maxDimension),
      };
      let tabs: BrowserTabInfo[] = [];
      try {
        tabs = await runtime.listBoundTabs();
      } catch {
        tabs = [];
      }
      if (runtime.generation() !== fenceGeneration) return;
      const pendingDialog = runtime.pendingDialog();
      for (const listener of subscribers) {
        listener({
          type: 'browser/state',
          pageStateLost: runtime.pageStateLost(),
          ts,
          ...(url !== undefined ? { url } : {}),
          ...(title !== undefined ? { title } : {}),
          lifecycle: runtime.lifecycle(),
          mirror: currentMirrorMode(),
          generation: runtime.generation(),
          documentRevision,
          ...(pageId !== undefined ? { pageId } : {}),
          viewport: {
            mode: viewportMode,
            width: viewportSize.width,
            height: viewportSize.height,
            setBy: viewportSetBy,
            ...(viewportMode === 'follow' && viewportFollowLeaseId !== undefined
              ? { followLeaseId: viewportFollowLeaseId }
              : {}),
          },
          tabs: tabs ?? [],
          pendingDialog: pendingDialog ?? null,
        });
      }
    };

    if (activePage === undefined) {
      return publish(state.url, state.title);
    }
    return Promise.all([activePage.url(), activePage.title()])
      .then(([url, title]) => {
        if (url !== '') state.url = url;
        state.title = title;
        return publish(state.url, state.title);
      })
      .catch(() => {
        // URL/title read failed (e.g. during navigation teardown); keep last
        // url/title but still publish lifecycle so the panel is not stuck.
        return publish(state.url, state.title);
      });
  }
  hooks.emitState = emitState;
  hooks.noteDocumentChange = () => {
    documentRevision += 1;
    residency.noteDocumentChange();
  };

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

  // Never rejects: the human and the agent share the page. Agent writes only
  // flip the activity indicator shown in the panel.
  function assertActor(actor: BrowserActor, reason: string, runId?: string): void {
    const result = controller.acquire(actor, actor === 'agent' ? runId : undefined);
    if (result.changed) emitController(reason);
  }

  const mirrorRestart = createMirrorRestartScheduler({
    restart: () =>
      runExclusive(async () => {
        const activePage = runtime.peekPage();
        if (activePage === undefined || !runtime.hasActiveMirrorLease()) return;
        await mirror.startMirrorFrames(activePage);
      }),
    onError: (error) =>
      console.warn('[browser] mirror restart failed', error instanceof Error ? error.message : error),
  });
  const operations = createBrowserOperations({
    getPage: () => residency.getPage(),
    peekPage: () => runtime.peekPage(),
    pageId: () => runtime.pageId(),
    emitState,
    requestFrame: () => requestMirrorFrame(),
    restartMirror: async () => mirrorRestart.schedule(),
    assertActor,
    maxDimension,
  });

  function subscribe(listener: (event: BrowserSessionEvent) => void): () => void {
    subscribers.add(listener);
    // Subscription is deliberately passive. HostRuntime subscribes while
    // composing tools; launching here would make Chromium resident before the
    // browser panel or an agent tool has actually requested it.
    if (runtime.hasActiveMirrorLease() && runtime.peekPage() !== undefined) {
      if (!mirror.hasScreencast()) {
        mirror.frameLoop.start();
        void mirror.frameLoop.requestFrame();
      }
      void emitState();
    }
    return () => {
      subscribers.delete(listener);
      if (subscribers.size === 0) mirror.frameLoop.stop();
    };
  }

  function withAbort<T>(operation: () => Promise<T>, signal?: AbortSignal, restoreCheckpoint = true): Promise<T> {
    if (signal?.aborted) return Promise.reject(new AbortOperationError('operation aborted'));
    return runExclusive(async () => {
      if (restoreCheckpoint) await residency.restoreIfNeeded();
      return operation();
    }, signal);
  }

  return {
    start: (leaseId, options) =>
      runExclusive(async () => {
        runtime.assertOpen();
        if (!runtime.acquireMirrorLease(leaseId)) return { ...state };
        const clientKey = options?.clientKey;
        if (leaseId !== undefined && clientKey !== undefined) {
          const superseded: string[] = [];
          for (const [held, holder] of leaseClients) {
            if (held === leaseId || holder !== clientKey) continue;
            runtime.releaseMirrorLease(held, { retire: true });
            leaseClients.delete(held);
            if (held === viewportFollowLeaseId) viewportFollowLeaseId = undefined;
            superseded.push(held);
          }
          leaseClients.set(leaseId, clientKey);
          if (superseded.length > 0) options?.onSuperseded?.(superseded);
        }
        await residency.getPage();
        const activePage = runtime.peekPage();
        const activeContext = runtime.peekContext();
        if (activePage !== undefined && activeContext !== undefined) {
          runtime.ensureConsoleCapture(activePage, activeContext);
        }
        if (activePage !== undefined) await mirror.startMirrorFrames(activePage);
        if (subscribers.size > 0 && !mirror.hasScreencast()) mirror.frameLoop.start();
        await emitState();
        if (!mirror.hasScreencast()) await mirror.frameLoop.requestFrame();
        emitController('mirror-start');
        return { ...state };
      }),

    stop: (leaseId, options) =>
      runExclusive(async () => {
        if (runtime.isClosed()) return;
        // A dropped connection may come back with the same id; only an
        // unmount retires it for good.
        const retire = options?.reason !== 'disconnect';
        // The window that drove the viewport is gone: the next focused window
        // takes over instead of every other mirror staying frozen.
        if (leaseId !== undefined) leaseClients.delete(leaseId);
        const releasedFollower = leaseId !== undefined && leaseId === viewportFollowLeaseId;
        if (releasedFollower) viewportFollowLeaseId = undefined;
        if (!runtime.releaseMirrorLease(leaseId, { retire })) {
          if (releasedFollower) await emitState();
          return;
        }
        // Closing the workbench must not leave a sticky user lock.
        const previous = controller.snapshot();
        const next = controller.giveBack();
        if (previous.owner !== next.owner) emitController('mirror-stop');
        mirror.frameLoop.stop();
        await mirror.stopScreencast();
        // Mirror lease ≠ agent claim. Keep Chromium while a run still owns
        // the lock so closing the panel cannot kill an in-flight navigate.
        // Retained runtimes are inspected separately by the guarded idle pool.
        if (keepAlive || next.owner === 'agent' || next.agentWantsLock) {
          await emitState();
          return;
        }
        await runtime.releaseRuntime();
        delete state.url;
        delete state.title;
      }),

    shutdown: () =>
      runExclusive(async () => {
        if (runtime.isClosed()) return;
        mirrorRestart.cancel();
        residency.discardCheckpoint();
        residency.noteDocumentChange();
        leaseClients.clear();
        viewportFollowLeaseId = undefined;
        runtime.clearLeases();
        mirror.frameLoop.stop();
        await mirror.stopScreencast();
        const previous = controller.snapshot();
        controller.giveBack();
        const next = controller.releaseAgentControl();
        if (previous.owner !== next.owner || previous.agentWantsLock !== next.agentWantsLock) {
          emitController('browser-close');
        }
        await runtime.releaseRuntime();
        delete state.url;
        delete state.title;
        await emitState();
      }),

    navigate: (url, options) => withAbort(async () => {
      // Explicit navigation replaces a checkpoint. A failed old URL must not
      // trap the browser, and invalid addresses must leave its checkpoint intact.
      assertNavigableUrl(url, { allowFile: options?.actor === 'user' });
      residency.discardCheckpoint();
      await operations.navigate(url, options);
    }, options?.signal, false),
    snapshot: (options) => withAbort(() => operations.snapshot(), options?.signal),
    click: (target, options) => withAbort(() => { residency.noteInteraction(); return operations.click(target, options); }, options?.signal),
    hover: (target, options) => withAbort(() => operations.hover(target, options), options?.signal),
    selectOption: (target, values, options) =>
      withAbort(() => { residency.noteInteraction(); return operations.selectOption(target, values, options); }, options?.signal),
    setChecked: (target, checked, options) =>
      withAbort(() => { residency.noteInteraction(); return operations.setChecked(target, checked, options); }, options?.signal),
    uploadFiles: (target, files, options) =>
      withAbort(() => { residency.noteInteraction(); return operations.uploadFiles(target, files, options); }, options?.signal),
    listTabs: (options) => withAbort(() => runtime.listTabs(), options?.signal),
    newTab: (url, options) =>
      withAbort(async () => {
        assertActor(options?.actor ?? 'agent', 'agent-write', options?.runId);
        return runtime.newTab(url);
      }, options?.signal),
    selectTab: (pageId, options) =>
      withAbort(async () => {
        assertActor(options?.actor ?? 'agent', 'agent-write', options?.runId);
        const tab = await runtime.selectTab(pageId);
        const activePage = runtime.peekPage();
        if (runtime.hasActiveMirrorLease() && activePage !== undefined) {
          await mirror.startMirrorFrames(activePage);
        }
        return tab;
      }, options?.signal),
    closeTab: (pageId, options) =>
      withAbort(async () => {
        assertActor(options?.actor ?? 'agent', 'agent-write', options?.runId);
        await runtime.closeTab(pageId);
      }, options?.signal),
    handleDialog: (action, promptText, options) =>
      withAbort(async () => {
        assertActor(options?.actor ?? 'agent', 'agent-write', options?.runId);
        const result = await runtime.handleDialog(action, promptText);
        await emitState();
        return result;
      }, options?.signal),
    pendingDialog: () => runtime.pendingDialog(),
    queryConsole: (limit) => runtime.queryConsole(limit),
    queryNetwork: (limit) => runtime.queryNetwork(limit),
    queryDownloads: (limit) => runtime.queryDownloads(limit),
    residencySnapshot: () => residency.snapshot(),
    suspendIdle: (idleBeforeMs) => residency.suspendIdle(idleBeforeMs),
    ownership: () => runtime.ownership(),
    type: (target, text, options) =>
      withAbort(() => { residency.noteInteraction(); return operations.type(target, text, options); }, options?.signal),
    fillForm: (fields, options) =>
      withAbort(() => { residency.noteInteraction(); return operations.fillForm(fields, options); }, options?.signal),
    scroll: (delta, options) => withAbort(() => operations.scroll(delta, options), options?.signal),
    screenshot: (path, options) => withAbort(() => operations.screenshot(path), options?.signal),
    back: (options) => withAbort(() => operations.back(options), options?.signal),
    forward: (options) => withAbort(() => operations.forward(options), options?.signal),
    find: (text, options) => withAbort(() => operations.find(text), options?.signal),
    wait: (ms, options) => residency.trackOperation(() => operations.wait(ms, options?.signal)),
    waitFor: (condition, options) => residency.trackOperation(() => operations.waitFor(condition, options)),
    reload: (options) => withAbort(() => operations.reload(options), options?.signal),
    pressKey: (key, options) =>
      withAbort(() => { residency.noteInteraction(); return operations.pressKey(key, options); }, options?.signal),
    queryViewport: () => {
      const fromPage = operations.queryViewport();
      if (fromPage) return fromPage;
      return {
        width: Math.min(requestedViewport.width, maxDimension),
        height: Math.min(requestedViewport.height, maxDimension),
      };
    },
    applyViewport: (size, options) =>
      withAbort(async () => {
        assertActor(options?.actor ?? 'agent', 'agent-write', options?.runId);
        viewportSetBy = options?.actor ?? 'agent';
        if (options?.mode !== undefined) viewportMode = options.mode;
        if (viewportMode !== 'follow') viewportFollowLeaseId = undefined;
        const next = await operations.setViewport(size, options?.mode);
        await emitState();
        return next;
      }, options?.signal),
    status: () => {
      const pageId = runtime.pageId();
      const current = { ...state };
      return {
        lifecycle: runtime.lifecycle(),
        mirror: currentMirrorMode(),
        generation: runtime.generation(),
        pageStateLost: runtime.pageStateLost(),
        recoveryCount: runtime.recoveryCount(),
        ...(pageId !== undefined ? { pageId } : {}),
        ...(current.url !== undefined ? { url: current.url } : {}),
        ...(current.title !== undefined ? { title: current.title } : {}),
      };
    },
    restart: (options) =>
      withAbort(async () => {
        runtime.assertOpen();
        residency.discardCheckpoint();
        assertActor(options?.actor ?? 'agent', 'agent-write', options?.runId);
        await runtime.releaseRuntime();
        residency.noteDocumentChange();
        delete state.url;
        delete state.title;
        await residency.getPage();
        const activePage = runtime.peekPage();
        if (runtime.hasActiveMirrorLease() && activePage !== undefined) {
          await mirror.startMirrorFrames(activePage);
        }
        await emitState();
        await requestMirrorFrame();
        const pageId = runtime.pageId();
        return {
          pageStateLost: true,
          generation: runtime.generation(),
          ...(pageId !== undefined ? { pageId } : {}),
        };
      }, options?.signal, false),
    pickElementAt: (x, y, options) =>
      withAbort(() => {
        // Pick is read-only, but it still must not act on a frame the user is
        // no longer looking at (spec §5.1).
        assertTargetMatches(options?.target);
        return operations.pickElementAt(x, y, options?.screenshotPath);
      }, options?.signal),

    dispatchInput: (events, options) => {
      if (events.length > MAX_INPUT_EVENTS) {
        return Promise.reject(new BrowserSessionError('browser input batch is too large'));
      }
      if (events.length === 0) return Promise.resolve();
      const moveOnly = isMouseMoveOnly(events);
      const operate = async (): Promise<void> => {
        assertTargetMatches(options?.target);
        if (events.some((event) => event.type !== 'mouse' ||
            (event.action !== 'move' && event.action !== 'wheel'))) residency.noteInteraction();
        await operations.dispatchEvents(events);
      };
      if (moveOnly) return operate();
      return withAbort(operate, options?.signal);
    },

    currentTarget: () => currentTarget(),
    capture: (options) =>
      withAbort(async () => {
        const quality = options?.quality ?? BROWSER_CAPTURE_QUALITY;
        const result = await operations.capture({
          quality,
          ...(options?.fullPage === true ? { fullPage: true } : {}),
        });
        const encoded = readJpegSize(result.bytes) ?? {
          width: result.viewport.width,
          height: result.viewport.height,
        };
        return {
          bytes: result.bytes,
          mime: BROWSER_FRAME_BINARY_MIME,
          width: result.viewport.width,
          height: result.viewport.height,
          encodedWidth: encoded.width,
          encodedHeight: encoded.height,
        };
      }, options?.signal),
    setViewport: (size, options) =>
      withAbort(async () => {
        if (options?.mode !== undefined) viewportMode = options.mode;
        viewportSetBy = options?.setBy ?? 'user';
        if (viewportMode !== 'follow') viewportFollowLeaseId = undefined;
        else if (options?.followLeaseId !== undefined) viewportFollowLeaseId = options.followLeaseId;
        const next = await operations.setViewport(size, options?.mode);
        await emitState();
        return next;
      }, options?.signal),
    viewportFollowLeaseId: () => viewportFollowLeaseId,
    mirrorLeaseCount: () => runtime.mirrorLeaseCount(),
    hasMirrorLease: (leaseId) => runtime.hasMirrorLease(leaseId),

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

    lock: async (owner, options) => {
      if (owner === 'user') {
        const previous = controller.snapshot();
        const next = controller.takeOver();
        if (previous.owner !== next.owner) emitController('take-over');
        return next;
      }
      assertActor('agent', 'agent-lock', options?.runId);
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

    releaseAgentControlIfHeldBy: async (runId) => {
      const previous = controller.snapshot();
      const next = controller.releaseAgentControlIfHeldBy(runId);
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
        if (runtime.isClosed()) return;
        runtime.markClosed();
        mirrorRestart.cancel();
        controller.releaseAgentControl();
        runtime.clearLeases();
        mirror.frameLoop.stop();
        subscribers.clear();
        await runtime.releaseRuntime();
        delete state.url;
        delete state.title;
      }),
  };
}
