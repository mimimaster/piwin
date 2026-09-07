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
export const BROWSER_OPERATION_INTERRUPTED = 'browser-operation-interrupted';
export const BROWSER_AGENT_HAS_CONTROL = 'browser-agent-has-control';

export type BrowserLifecycle =
  | 'stopped'
  | 'starting'
  | 'ready'
  | 'recovering'
  | 'failed'
  | 'disposed';

export type BrowserMirrorMode = 'off' | 'streaming' | 'degraded';

export type BrowserViewportMode = 'fixed' | 'follow' | 'mobile' | 'custom';

export const BROWSER_DEFAULT_VIEWPORT_WIDTH = 1280;
export const BROWSER_DEFAULT_VIEWPORT_HEIGHT = 800;

export type BrowserViewportConfig = {
  mode: BrowserViewportMode;
  width: number;
  height: number;
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
};

export type BrowserControllerPush = {
  type: 'browser/controller';
  owner: BrowserController;
  ts: number;
  /** True while a run acquired agent control and has not released it. */
  agentWantsLock?: boolean;
  reason?: string;
};

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
