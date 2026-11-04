/**
 * When the collapsed-right-panel Browser Mini may appear, what state it may
 * claim, and where a dragged window is allowed to sit.
 *
 * Pure decisions only: the surface component renders them and the workbench
 * owns the inputs. The Mini is a second *presentation* of the one
 * Host-shared browser, never a second browser (`browser-mini` spec §4, §5).
 */
import type {
  BrowserController,
  BrowserLifecycle,
  BrowserMirrorMode,
} from '@piwin/contracts';

/** Why the mini is hidden — kept explicit so the UI can avoid dead chrome. */
export type BrowserMiniHiddenReason =
  | 'phone'
  | 'overlay'
  | 'panel-open'
  | 'dismissed'
  | 'no-activity';

export type BrowserMiniVisibility =
  | { visible: true }
  | { visible: false; reason: BrowserMiniHiddenReason };

export type BrowserMiniActivity = {
  /** Host-published URL; empty until a page exists. */
  url: string;
  owner: BrowserController;
};

export type BrowserMiniVisibilityInput = {
  /**
   * True while the right workspace shows any expanded body (Summary or a tool).
   * The owner's rule: a full right panel always wins over the mini.
   */
  rightBodyOpen: boolean;
  /** Settings, sub pages, studio, or a phone overlay is covering the stage. */
  overlayOpen: boolean;
  /** Phone layouts use the activity chip/sheet instead of a floating window. */
  phone: boolean;
  /** The user dismissed the mini for this session. */
  dismissed: boolean;
  activity: BrowserMiniActivity;
};

/**
 * A real page is loaded, or the agent is driving the browser right now.
 *
 * A mirrored frame is deliberately not evidence: a fresh lease paints an
 * about:blank page, and that blank frame would otherwise keep the mini on
 * screen (and the lease alive) long after everything went idle — the empty
 * "shared browser" window nobody asked for.
 */
export function hasBrowserMiniActivity(activity: BrowserMiniActivity): boolean {
  if (activity.owner === 'agent') return true;
  const url = activity.url.trim();
  if (url.length === 0) return false;
  return url !== 'about:blank';
}

export function resolveBrowserMiniVisibility(
  input: BrowserMiniVisibilityInput,
): BrowserMiniVisibility {
  if (input.phone) return { visible: false, reason: 'phone' };
  if (input.overlayOpen) return { visible: false, reason: 'overlay' };
  if (input.rightBodyOpen) return { visible: false, reason: 'panel-open' };
  if (input.dismissed) return { visible: false, reason: 'dismissed' };
  if (!hasBrowserMiniActivity(input.activity)) {
    return { visible: false, reason: 'no-activity' };
  }
  return { visible: true };
}

export type BrowserMiniRuntimeState =
  | 'live'
  | 'starting'
  | 'reconnecting'
  | 'stale'
  | 'error';

export type BrowserMiniRuntimeInput = {
  lifecycle: BrowserLifecycle | undefined;
  mirror: BrowserMirrorMode | undefined;
  mirrorError: string | null;
  frameError: string | null;
  hostReady: boolean;
  frameSrc: string;
};

/**
 * Honest stream health. A last frame plus a dropped socket is `reconnecting`
 * or `stale`, never `live`.
 */
export function resolveBrowserMiniRuntimeState(
  input: BrowserMiniRuntimeInput,
): BrowserMiniRuntimeState {
  if (!input.hostReady) return input.frameSrc.length > 0 ? 'stale' : 'reconnecting';
  if (input.frameError !== null || input.mirrorError !== null) {
    return input.frameSrc.length > 0 ? 'stale' : 'error';
  }
  if (input.lifecycle !== undefined && input.lifecycle !== 'ready') return 'starting';
  if (input.mirror === 'degraded') return input.frameSrc.length > 0 ? 'stale' : 'error';
  if (input.frameSrc.length === 0) return 'starting';
  return 'live';
}

export type BrowserMiniSize = { width: number; height: number };
export type BrowserMiniPoint = { x: number; y: number };
export type BrowserMiniContainer = { width: number; height: number };

/** Header + 16:10 viewport at the default mini width. */
export const BROWSER_MINI_SIZE: BrowserMiniSize = { width: 300, height: 232 };
/** Keep the card off the stage edges and clear of resize handles. */
export const BROWSER_MINI_INSET_PX = 12;

function maxX(container: BrowserMiniContainer, size: BrowserMiniSize): number {
  return Math.max(BROWSER_MINI_INSET_PX, container.width - size.width - BROWSER_MINI_INSET_PX);
}

function maxY(container: BrowserMiniContainer, size: BrowserMiniSize): number {
  return Math.max(BROWSER_MINI_INSET_PX, container.height - size.height - BROWSER_MINI_INSET_PX);
}

/** Keep a dragged window inside the stage, whatever the split or zoom. */
export function clampBrowserMiniPosition(input: {
  point: BrowserMiniPoint;
  container: BrowserMiniContainer;
  size?: BrowserMiniSize;
}): BrowserMiniPoint {
  const size = input.size ?? BROWSER_MINI_SIZE;
  return {
    x: Math.min(Math.max(BROWSER_MINI_INSET_PX, Math.round(input.point.x)), maxX(input.container, size)),
    y: Math.min(Math.max(BROWSER_MINI_INSET_PX, Math.round(input.point.y)), maxY(input.container, size)),
  };
}

/**
 * Floating windows start at the stage's top-right, which is where a collapsed
 * rail leaves the most transcript visible underneath.
 */
export function defaultBrowserMiniPosition(input: {
  container: BrowserMiniContainer;
  size?: BrowserMiniSize;
}): BrowserMiniPoint {
  const size = input.size ?? BROWSER_MINI_SIZE;
  return clampBrowserMiniPosition({
    point: {
      x: input.container.width - size.width - BROWSER_MINI_INSET_PX,
      y: BROWSER_MINI_INSET_PX,
    },
    container: input.container,
    size,
  });
}

/** Arrow-key / pointer delta applied to a floating window, then clamped. */
export function moveBrowserMini({
  point,
  delta,
  container,
  size,
}: {
  point: BrowserMiniPoint;
  delta: { dx: number; dy: number };
  container: BrowserMiniContainer;
  size?: BrowserMiniSize;
}): BrowserMiniPoint {
  return clampBrowserMiniPosition({
    point: { x: point.x + delta.dx, y: point.y + delta.dy },
    container,
    ...(size === undefined ? {} : { size }),
  });
}

/** Dragging near the top-right anchor snaps back to the docked slot. */
export const BROWSER_MINI_SNAP_BACK_PX = 72;

export function shouldSnapBrowserMiniBack(input: {
  point: BrowserMiniPoint;
  container: BrowserMiniContainer;
  size?: BrowserMiniSize;
}): boolean {
  const size = input.size ?? BROWSER_MINI_SIZE;
  const anchor = defaultBrowserMiniPosition({ container: input.container, size });
  return (
    Math.abs(input.point.x - anchor.x) <= BROWSER_MINI_SNAP_BACK_PX &&
    Math.abs(input.point.y - anchor.y) <= BROWSER_MINI_SNAP_BACK_PX
  );
}

/** Frame alt/title fallback: page title, then host, then a neutral label. */
export function resolveBrowserMiniTitle(input: {
  title: string;
  url: string;
  fallback: string;
}): string {
  const title = input.title.trim();
  if (title.length > 0) return title;
  const url = input.url.trim();
  if (url.length > 0) {
    try {
      return new URL(url).host || url;
    } catch {
      return url;
    }
  }
  return input.fallback;
}

/**
 * Persisted placement: the point as a share of the stage box, so a different
 * window size, zoom level, or split re-clamps to the same relative corner
 * instead of restoring a pixel offset that no longer fits (spec §5.3).
 */
export type BrowserMiniStoredPlacement = { xRatio: number; yRatio: number };

const RATIO_MIN = 0;
const RATIO_MAX = 1;

function ratioInRange(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= RATIO_MIN && value <= RATIO_MAX;
}

/** Null when the box is degenerate, so callers never store NaN/Infinity. */
export function browserMiniPlacementToStored(
  point: BrowserMiniPoint,
  container: BrowserMiniContainer,
): BrowserMiniStoredPlacement | null {
  if (container.width <= 0 || container.height <= 0) return null;
  return {
    xRatio: Math.min(RATIO_MAX, Math.max(RATIO_MIN, point.x / container.width)),
    yRatio: Math.min(RATIO_MAX, Math.max(RATIO_MIN, point.y / container.height)),
  };
}

/** Restore a stored placement, clamped into the current stage box. */
export function browserMiniPlacementFromStored(
  stored: unknown,
  container: BrowserMiniContainer,
  size: BrowserMiniSize = BROWSER_MINI_SIZE,
): BrowserMiniPoint | null {
  if (typeof stored !== 'object' || stored === null) return null;
  const { xRatio, yRatio } = stored as { xRatio?: unknown; yRatio?: unknown };
  if (!ratioInRange(xRatio) || !ratioInRange(yRatio)) return null;
  return clampBrowserMiniPosition({
    point: { x: xRatio * container.width, y: yRatio * container.height },
    container,
    size,
  });
}
