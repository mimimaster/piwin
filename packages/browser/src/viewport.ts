/**
 * Host CSS viewport policy (completeness plan §6.1).
 * Default is a fixed 1280×800 page; only follow mode tracks the panel box,
 * 1:1. `clampBrowserViewport` stays for legacy callers.
 */
import {
  BROWSER_DEFAULT_VIEWPORT_HEIGHT,
  BROWSER_DEFAULT_VIEWPORT_WIDTH,
  type BrowserViewportMode,
} from '@piwin/contracts';

/** Smallest Playwright viewport we will request for the workbench mirror. */
export const BROWSER_VIEWPORT_MIN_PX = 200;

/** Follow-mode CSS viewport ceiling. Independent of fixed-mode maxDimension. */
export const BROWSER_FOLLOW_VIEWPORT_MAX_WIDTH = 1920;
export const BROWSER_FOLLOW_VIEWPORT_MAX_HEIGHT = 1200;

export type BrowserViewportSize = { width: number; height: number };

export type ResolveBrowserViewportInput = {
  mode?: BrowserViewportMode;
  panelWidth?: number;
  panelHeight?: number;
  maxDimension?: number;
  width?: number;
  height?: number;
};

/**
 * Map a panel CSS box onto a Playwright viewport.
 * Preserve aspect ratio when either axis exceeds `maxDimension`.
 * Returns null when the box is not yet a real layout size.
 */
export function clampBrowserViewport(
  width: number,
  height: number,
  maxDimension: number,
): BrowserViewportSize | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    return null;
  }
  if (!Number.isFinite(maxDimension) || maxDimension < BROWSER_VIEWPORT_MIN_PX) {
    return null;
  }

  let nextWidth = Math.round(width);
  let nextHeight = Math.round(height);
  nextWidth = Math.max(BROWSER_VIEWPORT_MIN_PX, nextWidth);
  nextHeight = Math.max(BROWSER_VIEWPORT_MIN_PX, nextHeight);

  const longest = Math.max(nextWidth, nextHeight);
  if (longest > maxDimension) {
    const scale = maxDimension / longest;
    nextWidth = Math.max(BROWSER_VIEWPORT_MIN_PX, Math.round(nextWidth * scale));
    nextHeight = Math.max(BROWSER_VIEWPORT_MIN_PX, Math.round(nextHeight * scale));
  }

  return { width: nextWidth, height: nextHeight };
}

/**
 * Resolve the Host CSS viewport for a mode.
 * `fixed` (default) ignores tiny/hidden panels so a 40×40 ResizeObserver
 * cannot collapse Chromium to 200×200.
 */
export function resolveBrowserViewport(
  input: ResolveBrowserViewportInput,
): BrowserViewportSize | null {
  const mode = input.mode ?? 'fixed';
  const maxDimension = input.maxDimension ?? BROWSER_DEFAULT_VIEWPORT_WIDTH;
  if (!Number.isFinite(maxDimension) || maxDimension < 1) {
    return null;
  }

  if (mode === 'follow') {
    return resolveFollowViewport(input.panelWidth, input.panelHeight, maxDimension);
  }
  if (mode === 'mobile' || mode === 'custom') {
    return fitExplicitSize(input.width, input.height, maxDimension);
  }
  return resolveFixedViewport(input.width, input.height, maxDimension);
}

function resolveFixedViewport(
  width: number | undefined,
  height: number | undefined,
  maxDimension: number,
): BrowserViewportSize {
  const explicit = fitExplicitSize(width, height, maxDimension);
  if (explicit) return explicit;
  return fitWithinMaxDimension(
    BROWSER_DEFAULT_VIEWPORT_WIDTH,
    BROWSER_DEFAULT_VIEWPORT_HEIGHT,
    maxDimension,
  );
}

function resolveFollowViewport(
  panelWidth: number | undefined,
  panelHeight: number | undefined,
  _maxDimension: number,
): BrowserViewportSize | null {
  if (
    panelWidth === undefined ||
    panelHeight === undefined ||
    !Number.isFinite(panelWidth) ||
    !Number.isFinite(panelHeight) ||
    panelWidth < 1 ||
    panelHeight < 1
  ) {
    return null;
  }

  // 1 CSS px per panel px: the page lays out for the space it really has,
  // text stays sharp, and the frame fills the panel with no letterbox. Pages
  // that need a desktop layout use the fixed/desktop preset instead.
  const width = Math.max(BROWSER_VIEWPORT_MIN_PX, Math.round(panelWidth));
  const height = Math.max(BROWSER_VIEWPORT_MIN_PX, Math.round(panelHeight));
  return fitWithinRectangle(
    width,
    height,
    BROWSER_FOLLOW_VIEWPORT_MAX_WIDTH,
    BROWSER_FOLLOW_VIEWPORT_MAX_HEIGHT,
  );
}

function fitWithinRectangle(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number,
): BrowserViewportSize {
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function fitExplicitSize(
  width: number | undefined,
  height: number | undefined,
  maxDimension: number,
): BrowserViewportSize | null {
  if (
    width === undefined ||
    height === undefined ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < 1 ||
    height < 1
  ) {
    return null;
  }
  return fitWithinMaxDimension(width, height, maxDimension);
}

/**
 * Scale so the longest edge is at most `maxDimension`. Rounding is clamped
 * afterward so a 0.5px bump cannot exceed the cap.
 */
function fitWithinMaxDimension(
  width: number,
  height: number,
  maxDimension: number,
): BrowserViewportSize {
  const longest = Math.max(width, height);
  let nextWidth = width;
  let nextHeight = height;
  if (longest > maxDimension) {
    const scale = maxDimension / longest;
    nextWidth = width * scale;
    nextHeight = height * scale;
  }
  nextWidth = Math.round(nextWidth);
  nextHeight = Math.round(nextHeight);
  if (nextWidth > maxDimension) nextWidth = maxDimension;
  if (nextHeight > maxDimension) nextHeight = maxDimension;
  return {
    width: Math.max(1, nextWidth),
    height: Math.max(1, nextHeight),
  };
}
