/**
 * JPEG screencast bounds are independent of the CSS viewport cap.
 * Chromium only downscales startScreencast maxWidth/maxHeight; DSF supplies
 * the compositor pixels. Both axes must cover css×DSF or the extra raster
 * is thrown away.
 */
export const BROWSER_DEFAULT_DEVICE_SCALE_FACTOR = 2;
export const BROWSER_SCREENCAST_MAX_PX = 2560;
export const BROWSER_SCREENCAST_QUALITY = 80;
export const BROWSER_SCREENSHOT_QUALITY = 80;

export type BrowserScreencastSize = { width: number; height: number };

export type ResolveBrowserScreencastSizeInput = {
  width: number;
  height: number;
  deviceScaleFactor?: number;
  maxPx?: number;
};

/** Clamp a page DPR into the workbench capture range [1, 2]. */
export function clampBrowserDeviceScaleFactor(value: number): number {
  if (!Number.isFinite(value) || value < 1) return 1;
  if (value > BROWSER_DEFAULT_DEVICE_SCALE_FACTOR) return BROWSER_DEFAULT_DEVICE_SCALE_FACTOR;
  return value;
}

/**
 * Physical JPEG bounds for page.screencast.start({ size }).
 * Returns null when the CSS box is not a real viewport.
 */
export function resolveBrowserScreencastSize(
  input: ResolveBrowserScreencastSizeInput,
): BrowserScreencastSize | null {
  if (
    !Number.isFinite(input.width) ||
    !Number.isFinite(input.height) ||
    input.width < 1 ||
    input.height < 1
  ) {
    return null;
  }
  const deviceScaleFactor = clampBrowserDeviceScaleFactor(
    input.deviceScaleFactor ?? BROWSER_DEFAULT_DEVICE_SCALE_FACTOR,
  );
  const maxPx = input.maxPx ?? BROWSER_SCREENCAST_MAX_PX;
  if (!Number.isFinite(maxPx) || maxPx < 1) return null;

  let width = Math.round(input.width * deviceScaleFactor);
  let height = Math.round(input.height * deviceScaleFactor);
  const longest = Math.max(width, height);
  if (longest > maxPx) {
    const scale = maxPx / longest;
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }
  return {
    width: Math.max(1, width),
    height: Math.max(1, height),
  };
}
