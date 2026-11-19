/**
 * Public type contracts for `BrowserSession` and its options/events.
 *
 * Kept separate from `browser-session.ts` so the runtime orchestrator stays
 * concise and well below the file-size threshold.
 */
import type {
  BrowserControllerPush,
  BrowserFrameBinaryHeader,
  BrowserInputEvent,
  BrowserLifecycle,
  BrowserMirrorMode,
  BrowserResidencySnapshot,
  BrowserIdleSuspensionResult,
  BrowserSnapshotNode,
  BrowserTargetIdentity,
  BrowserViewportMode,
  BrowserViewportSetBy,
  HostPush,
  WebElementPickResult,
} from '@piwin/contracts';
import type { RunExclusive } from './mutex.js';
import type { BrowserControllerState } from './controller.js';
import type { BrowserLaunchPersistentContext } from './browser-runtime.js';
import type { BrowserFindResult } from './find.js';
import type {
  BrowserReloadOptions,
  BrowserWaitForCondition,
  BrowserWaitForOptions,
} from './browser-operations.js';
import type { BrowserConnectOverCdp, BrowserOwnership } from './browser-cdp.js';
import type {
  BrowserConsoleEntry,
  BrowserDownloadRef,
  BrowserNetworkEntry,
} from './browser-observe.js';
import type { BrowserDialogInfo, BrowserTabInfo } from './browser-pages.js';
import type { EnsureOwnedChromium } from './ensure-playwright-chromium.js';

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

export type BrowserOpOptions = { signal?: AbortSignal; actor?: BrowserActor; runId?: string };

/** `scroll` may target a ref/selector container instead of the page root. */
export type BrowserScrollOptions = BrowserOpOptions & { target?: string };

export type BrowserSessionOptions = {
  /** Default true. When false the browser runs headed (useful for debugging). */
  headless?: boolean;
  /** Requested viewport in CSS px; each dimension is capped to `maxDimension`. */
  viewport?: { width: number; height: number };
  /** Cap for the largest CSS viewport dimension (~1280). */
  maxDimension?: number;
  /** Host-owned Chromium raster scale. Ignored for connectOverCDP. Default 2. */
  deviceScaleFactor?: number;
  /** Screencast JPEG quality (1-100). Default 90. */
  screencastQuality?: number;
  /** Additional arguments to pass to Chromium. */
  args?: string[];
  /** Browser channel to launch (e.g. 'chrome', 'msedge'). */
  channel?: string;
  /** Custom browser executable path. */
  executablePath?: string;
  /** Default flags to ignore from Playwright's defaults. */
  ignoreDefaultArgs?: string[] | boolean;
  /** Frame stream ceiling in fps (default 4). */
  maxFps?: number;
  userAgent?: string;
  /** Persistent profile dir; default `~/.piwin/browser-profile`. */
  profileDir?: string;
  /** Conversation pages survive mirror detach until guarded Host idle suspension/disposal. */
  keepAlive?: boolean;
  /** Host injects active Run/shutdown protection; browser never imports Host. */
  isRuntimeProtected?: () => boolean;
  /** Attach an isolated context rather than the external browser's shared pages. */
  isolatedContext?: boolean;
  /** When true (default false), capture console logs and network requests as HostPush events. */
  captureConsoleAndNetwork?: boolean;
  /** Explicit loopback CDP endpoint for Playwright connectOverCDP. */
  cdpEndpoint?: string;
  /** Test seam. */
  connectOverCdp?: BrowserConnectOverCdp;
  /** Test seam. */
  launchPersistentContext?: BrowserLaunchPersistentContext;
  /** Test seam for dialog auto-dismiss. */
  dialogTimeoutMs?: number;
  /** Host-owned Chromium: download into PLAYWRIGHT_BROWSERS_PATH before launch. */
  ensureChromium?: EnsureOwnedChromium;
  /**
   * How live frames reach the shell (spec §4.1.2). `inline` keeps base64 in the
   * local JSON path; `binary` publishes metadata only. Either way the JPEG
   * bytes also go to `onFrameBytes` for the out-of-band channel.
   */
  frameTransport?: BrowserFrameTransport;
  /**
   * Sink for raw JPEG frames. A Host serving local (inline) and remote
   * (binary) shells at once needs both, so this is not gated on the transport:
   * remote projection rewrites the push to `binary` and expects these bytes.
   */
  onFrameBytes?: (header: BrowserFrameBinaryHeader, bytes: Uint8Array) => void;
};

/** Local sidecar JSON path vs the remote binary frame channel. */
export type BrowserFrameTransport = 'inline' | 'binary';

export type BrowserSessionState = { url?: string; title?: string };

export type BrowserSessionStatus = {
  lifecycle: BrowserLifecycle;
  mirror: BrowserMirrorMode;
  generation: number;
  pageStateLost: boolean;
  recoveryCount: number;
  pageId?: string;
  url?: string;
  title?: string;
};

export type BrowserRestartResult = {
  pageStateLost: boolean;
  generation: number;
  pageId?: string;
};

export type ScreenshotResult = {
  dataUrl: string;
  width: number;
  height: number;
  path?: string;
};

/** One high-quality capture for the annotation layer (spec §4.3). */
export type BrowserCaptureResult = {
  bytes: Uint8Array;
  mime: string;
  /** CSS viewport px. */
  width: number;
  height: number;
  encodedWidth: number;
  encodedHeight: number;
};

export type BrowserSession = {
  /** Acquire a desktop mirror lease; launches Chromium lazily and starts frames. */
  /**
   * `clientKey` identifies the client (device/connection principal) holding
   * the lease. A client shows one browser panel, so its newer lease retires
   * any older one it still holds — a leaked or duplicated panel must not look
   * like a second window to the Host.
   */
  start(
    leaseId?: string,
    options?: { clientKey?: string; onSuperseded?: (leaseIds: string[]) => void },
  ): Promise<BrowserSessionState>;
  /** Release pictures; retained conversation runtimes follow Host idle residency policy. */
  stop(leaseId?: string, options?: { reason?: 'disconnect' }): Promise<void>;
  /**
   * Explicitly shut down the current Chromium runtime, mirror leases, and residency
   * checkpoint without marking the BrowserSession permanently closed.
   */
  shutdown(): Promise<void>;
  navigate(url: string, options?: BrowserOpOptions): Promise<void>;
  snapshot(options?: { signal?: AbortSignal }): Promise<BrowserSnapshotNode[]>;
  click(target: string, options?: BrowserOpOptions): Promise<void>;
  hover(target: string, options?: BrowserOpOptions): Promise<void>;
  selectOption(
    target: string,
    values: string | string[],
    options?: BrowserOpOptions,
  ): Promise<void>;
  setChecked(target: string, checked: boolean, options?: BrowserOpOptions): Promise<void>;
  uploadFiles(target: string, files: string[], options?: BrowserOpOptions): Promise<void>;
  listTabs(options?: { signal?: AbortSignal }): Promise<BrowserTabInfo[]>;
  newTab(url?: string, options?: BrowserOpOptions): Promise<BrowserTabInfo>;
  selectTab(pageId: string, options?: BrowserOpOptions): Promise<BrowserTabInfo>;
  closeTab(pageId: string, options?: BrowserOpOptions): Promise<void>;
  handleDialog(
    action: 'accept' | 'dismiss',
    promptText?: string,
    options?: BrowserOpOptions,
  ): Promise<BrowserDialogInfo>;
  pendingDialog(): BrowserDialogInfo | undefined;
  queryConsole(limit?: number): BrowserConsoleEntry[];
  queryNetwork(limit?: number): BrowserNetworkEntry[];
  queryDownloads(limit?: number): BrowserDownloadRef[];
  ownership(): BrowserOwnership;
  type(target: string, text: string, options?: BrowserOpOptions): Promise<void>;
  fillForm(fields: Record<string, string>, options?: BrowserOpOptions): Promise<void>;
  scroll(delta: { x?: number; y?: number }, options?: BrowserScrollOptions): Promise<void>;
  screenshot(path?: string, options?: { signal?: AbortSignal }): Promise<ScreenshotResult>;
  back(options?: BrowserOpOptions): Promise<void>;
  forward(options?: BrowserOpOptions): Promise<void>;
  find(text: string, options?: { signal?: AbortSignal }): Promise<BrowserFindResult>;
  wait(ms: number, options?: { signal?: AbortSignal }): Promise<void>;
  waitFor(condition: BrowserWaitForCondition, options?: BrowserWaitForOptions): Promise<void>;
  queryViewport(): { width: number; height: number };
  /** Read lifecycle without launching Chromium. */
  status(): BrowserSessionStatus;
  restart(options?: BrowserOpOptions): Promise<BrowserRestartResult>;
  reload(options?: BrowserReloadOptions): Promise<void>;
  pressKey(key: string, options?: BrowserOpOptions): Promise<void>;
  /** Host-issued identity of the page input/pick commands must match (§5.1). */
  currentTarget(): BrowserTargetIdentity;
  /** Read-only high-quality capture for annotation; never takes the lock. */
  capture(options?: {
    signal?: AbortSignal;
    quality?: number;
    fullPage?: boolean;
  }): Promise<BrowserCaptureResult>;
  applyViewport(
    size: { width: number; height: number },
    options?: BrowserOpOptions & { mode?: BrowserViewportMode },
  ): Promise<{ width: number; height: number }>;
  pickElementAt(
    x: number,
    y: number,
    options?: { signal?: AbortSignal; screenshotPath?: string; target?: BrowserTargetIdentity },
  ): Promise<WebElementPickResult>;
  dispatchInput(
    events: BrowserInputEvent[],
    options?: { signal?: AbortSignal; target?: BrowserTargetIdentity },
  ): Promise<void>;
  /** Fit the Playwright viewport to the panel CSS box; does not take the lock. */
  setViewport(
    size: { width: number; height: number },
    options?: {
      signal?: AbortSignal;
      mode?: BrowserViewportMode;
      setBy?: BrowserViewportSetBy;
      /** `follow` only: the mirror lease that now drives the viewport. */
      followLeaseId?: string;
    },
  ): Promise<{ width: number; height: number }>;
  /** Mirror lease that drives the `follow` viewport, if any. */
  viewportFollowLeaseId(): string | undefined;
  mirrorLeaseCount(): number;
  hasMirrorLease(leaseId: string): boolean;
  residencySnapshot(): BrowserResidencySnapshot;
  suspendIdle(idleBeforeMs: number): Promise<BrowserIdleSuspensionResult>;
  takeOver(): Promise<BrowserControllerState>;
  giveBack(): Promise<BrowserControllerState>;
  lock(owner: BrowserActor, options?: BrowserOpOptions): Promise<BrowserControllerState>;
  unlock(owner: BrowserActor): Promise<BrowserControllerState>;
  releaseAgentControl(): Promise<void>;
  releaseAgentControlIfHeldBy(runId: string): Promise<void>;
  controllerState(): BrowserControllerState;
  runExclusive: RunExclusive;
  subscribe(listener: (event: BrowserSessionEvent) => void): () => void;
  currentState(): BrowserSessionState;
  close(): Promise<void>;
};
