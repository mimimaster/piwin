/** Smallest Playwright viewport we will request for the workbench mirror. */
export const BROWSER_VIEWPORT_MIN_PX = 200;

export type BrowserViewportSize = { width: number; height: number };

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
