/** Agent-controllable browser session contracts (ADR 0020 §4). */
import type { MediaAttachmentRef } from './host.js';

export type BrowserSnapshotNode = {
  role: string;
  name?: string;
  ref?: string;
  level?: number;
  checked?: boolean;
  children: BrowserSnapshotNode[];
};

export type WebElementPickResult = {
  url: string;
  selector: string;
  ref?: string;
  text: string;
  html?: string;
  boundingRect: { x: number; y: number; width: number; height: number };
  screenshotPath?: string;
};

export type WebElementAttachmentRef = {
  id: string;
  kind: 'web-element';
  url: string;
  selector: string;
  ref?: string;
  text: string;
  html?: string;
  screenshotPath?: string;
};

export type PromptAttachment = MediaAttachmentRef | WebElementAttachmentRef;

/** Who currently drives the shared Chromium workbench (ADR 0057). */
export type BrowserController = 'idle' | 'user' | 'agent';

/**
 * Pointer / key events forwarded from the desktop panel onto the Host page.
 * Coordinates are CSS viewport px (same space as `browser/frame` width/height).
 */
export type BrowserInputEvent =
  | {
      type: 'mouse';
      action: 'down' | 'up' | 'move' | 'wheel';
      x: number;
      y: number;
      button?: 'left' | 'middle' | 'right';
      clickCount?: number;
      deltaX?: number;
      deltaY?: number;
    }
  | { type: 'key'; action: 'down' | 'up'; key: string }
  | { type: 'insertText'; text: string };

/** Stable tool / session error when the human holds the workbench. */
export const BROWSER_USER_HAS_CONTROL = 'browser-user-has-control';

export const BROWSER_RUNTIME_GONE = 'browser-runtime-gone';
export const BROWSER_UNAVAILABLE = 'browser-unavailable';
export const BROWSER_STALE_TARGET = 'browser-stale-target';
export const BROWSER_ACTION_FAILED = 'browser-action-failed';
/** A follow resize from a window that does not currently drive the viewport. */
export const BROWSER_VIEWPORT_OWNED = 'browser-viewport-owned';
export const BROWSER_OPERATION_INTERRUPTED = 'browser-operation-interrupted';
export const BROWSER_AGENT_HAS_CONTROL = 'browser-agent-has-control';

export type BrowserLifecycle =
  | 'stopped'
  | 'starting'
  | 'installing'
  | 'ready'
  | 'recovering'
  | 'failed'
  | 'disposed';

export type BrowserMirrorMode = 'off' | 'streaming' | 'degraded';

export type BrowserViewportMode = 'fixed' | 'follow' | 'mobile' | 'custom';

export const BROWSER_DEFAULT_VIEWPORT_WIDTH = 1280;
export const BROWSER_DEFAULT_VIEWPORT_HEIGHT = 800;

export type BrowserPageKind = 'page' | 'popup';

export type BrowserTabInfo = {
  pageId: string;
  url: string;
  title: string;
  kind: BrowserPageKind;
  active: boolean;
};

export type BrowserDialogInfo = {
  pageId: string;
  type: string;
  message: string;
  defaultValue?: string;
  timedOut: boolean;
};

export type BrowserViewportSetBy = 'agent' | 'user' | 'host';

export type BrowserViewportConfig = {
  mode: BrowserViewportMode;
  width: number;
  height: number;
  /** Who last changed the Host CSS viewport. Omitted by older emitters. */
  setBy?: BrowserViewportSetBy;
  /**
   * `follow` only: the mirror lease whose panel the viewport tracks. With
   * several windows mirroring one Host browser, exactly one drives the size —
   * the one the user last focused — and the others show that page scaled.
   * Cleared when that lease is released.
   */
  followLeaseId?: string;
};

/**
 * Identity of the page a Desktop/Host command targets (spec §5.1). A mismatch
 * against the live page returns `browser-stale-target` without dispatching.
 */
export type BrowserTargetIdentity = {
  generation: number;
  pageId: string;
  documentRevision: number;
};

/** `browser/capture` result: Host media id, never base64 in the response. */
export type BrowserCaptureResponse = {
  attachment: MediaAttachmentRef;
  target: BrowserTargetIdentity;
  width: number;
  height: number;
};

/**
 * Live frame payload (spec §4.1.2). Local sidecar emits `inline`; a remote Host
 * converts it to `binary` before projection and carries the JPEG out of band.
 */
export type BrowserFramePayload =
  | { kind: 'inline'; dataUrl: string }
  | { kind: 'binary' }
  | { kind: 'unavailable'; reason: 'client-update-required' | 'frame-channel-unavailable' };

export const BROWSER_FRAME_PRODUCERS = ['screencast', 'screenshot-fallback'] as const;
export type BrowserFrameProducer = (typeof BROWSER_FRAME_PRODUCERS)[number];

/**
 * Binary browser-frame envelope (spec §4.1.2): magic + version, header length,
 * UTF-8 JSON header, raw JPEG. Version 1 keeps the header self-describing so a
 * decoder can reject a mismatched or malformed frame without closing the link.
 */
export const BROWSER_FRAME_BINARY_MAGIC = 0x50_42_46_31; // 'PBF1'
export const BROWSER_FRAME_BINARY_VERSION = 1;
export const BROWSER_FRAME_BINARY_MIME = 'image/jpeg';
export const BROWSER_FRAME_HEADER_MAGIC_BYTES = 8;
export const BROWSER_FRAME_MAX_HEADER_BYTES = 4 * 1024;
/** Independent receive ceiling — never the generic JSON wire limit (spec §4.1.2). */
export const MAX_BROWSER_FRAME_BINARY_BYTES = 12 * 1024 * 1024;
/** Bounded decode ceiling for a received frame. */
export const MAX_BROWSER_FRAME_DECODE_PIXELS = 16_000_000;
/** Metadata arrived but its payload did not (spec §4.1.2). */
export const BROWSER_FRAME_PAYLOAD_TIMEOUT_MS = 2_000;
/** Why the panel shows a retry placeholder instead of a broken image. */
export const BROWSER_FRAME_ERROR_HEADER = 'piwin-browser-frame-error';

export type BrowserFrameBinaryHeader = {
  version: number;
  frameId: string;
  generation: number;
  pageId: string;
  documentRevision: number;
  /** CSS viewport px — the coordinate space of input and pick. */
  width: number;
  height: number;
  /** Real JPEG bitmap px; the decode budget is checked against these. */
  encodedWidth: number;
  encodedHeight: number;
  byteLength: number;
  mime: string;
};

/**
 * `browser/frame` push. `width`/`height` are the CSS viewport; `encodedWidth`/
 * `encodedHeight` are the real JPEG bitmap, so density is never inferred from
 * the requested capture size.
 */
export type BrowserFramePush = {
  type: 'browser/frame';
  ts: number;
  frameId: string;
  width: number;
  height: number;
  encodedWidth: number;
  encodedHeight: number;
  sourceDpr: number;
  quality: number;
  producer: BrowserFrameProducer;
  byteLength: number;
  generation: number;
  pageId: string;
  documentRevision: number;
  payload: BrowserFramePayload;
};

export type BrowserRuntimeFailure = {
  code: string;
  reason?: string;
};

/**
 * Host-normalized browser runtime snapshot (completeness plan §4.1).
 * Control ownership stays on `browser/controller`; this is connection health.
 */
export type BrowserRuntimeState = {
  lifecycle: BrowserLifecycle;
  mirror: BrowserMirrorMode;
  generation: number;
  viewport: BrowserViewportConfig;
  recoveryCount: number;
  pageId?: string;
  documentRevision?: number;
  controllerRevision?: number;
  lastFailure?: BrowserRuntimeFailure;
};

export type BrowserToolOutcome = 'not-started' | 'unknown';
export type BrowserRecoveryStatus = 'none' | 'recovered' | 'failed';

/**
 * `browser/state` payload. `url`/`title` remain for existing panels.
 * Lifecycle fields are optional so older emitters stay valid.
 */
export type BrowserStatePush = {
  type: 'browser/state';
  ts: number;
  url?: string;
  title?: string;
  lifecycle?: BrowserLifecycle;
  mirror?: BrowserMirrorMode;
  generation?: number;
  pageId?: string;
  documentRevision?: number;
  controllerRevision?: number;
  viewport?: BrowserViewportConfig;
  recoveryCount?: number;
  tabs?: BrowserTabInfo[];
  pendingDialog?: BrowserDialogInfo | null;
};

export type BrowserControllerPush = {
  type: 'browser/controller';
  owner: BrowserController;
  ts: number;
  /** True while a run acquired agent control and has not released it. */
  agentWantsLock?: boolean;
  reason?: string;
};

/** Stable guidance for the model after a browser tool failure (spec §6.4). */
export type BrowserRecoveryAction =
  | 'wait-for-user-handoff'
  | 'wait-for-agent-or-take-over'
  | 'snapshot-and-retarget'
  | 'snapshot-or-dismiss-overlay'
  | 'retry-once-after-recovery'
  | 'report-browser-unavailable'
  | 'inspect-current-state';

/** Model-facing next step derived from lifecycle + control ownership (spec §5.2). */
export type BrowserToolNextAction =
  | 'continue'
  | 'read-only-or-wait-for-user'
  | 'wait-for-recovery'
  | 'restart'
  | 'navigate-or-observe-will-start';

/** Lightweight page identity attached to browser tool successes (spec §6.3). */
export type BrowserToolPageState = {
  url: string;
  title?: string;
  generation: number;
  pageId?: string;
  documentRevision?: number;
  pendingDialog: boolean;
};

/** Whether the model actually received pixels for a screenshot (spec §7). */
export type BrowserScreenshotEvidence =
  | { status: 'delivered'; mediaId: string }
  | { status: 'delegated'; mediaId: string; description: string; model: string }
  | { status: 'unavailable'; mediaId?: string; reason: string };

/** `browser_scroll` amount bounds in CSS px (spec §6.3). */
export const BROWSER_SCROLL_DEFAULT_AMOUNT_PX = 400;
export const BROWSER_SCROLL_MAX_AMOUNT_PX = 2000;

/** Model-facing byte caps for picked web-element payloads. */
export const MAX_WEB_ELEMENT_TEXT_BYTES = 2 * 1024; // ~2 KB
export const MAX_WEB_ELEMENT_HTML_BYTES = 8 * 1024; // ~8 KB
/** Workbench IME / paste insertText budget (Desktop + Host dispatch). */
export const MAX_BROWSER_INSERT_TEXT_BYTES = 8 * 1024;

const TRUNCATION_MARKER = '…';

/** Truncate to a UTF-8 byte budget without splitting a multi-byte character. */
function truncateToBytes(value: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  if (encoder.encode(value).byteLength <= maxBytes) {
    return value;
  }
  let low = 0;
  let high = value.length;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (encoder.encode(value.slice(0, mid)).byteLength <= maxBytes) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return `${value.slice(0, low)}${TRUNCATION_MARKER}`;
}

/**
 * Renders a picked web element for a text-only model (no base64 dump).
 * The `html:` and `screenshot path:` lines are optional, present only when set.
 */
export function formatTextModelWebElementInjection(ref: WebElementAttachmentRef): string {
  const parts = [
    '[attached web element]',
    `url: ${ref.url}`,
    `selector: ${ref.selector}`,
    `text: ${truncateToBytes(ref.text, MAX_WEB_ELEMENT_TEXT_BYTES)}`,
  ];
  if (ref.html !== undefined) {
    parts.push(`html: ${truncateToBytes(ref.html, MAX_WEB_ELEMENT_HTML_BYTES)}`);
  }
  if (ref.screenshotPath !== undefined) {
    parts.push(`screenshot path: ${ref.screenshotPath}`);
  }
  return parts.join('\n');
}
