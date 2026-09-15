/**
 * JPEG screencast bounds are independent of the CSS viewport cap.
 * Chromium only downscales startScreencast maxWidth/maxHeight; DSF supplies
 * the compositor pixels. Fit the encoded bitmap into a width/height/area
 * rectangle — never a single longest-edge cap, and never reuse the CSS
 * viewport max as an encoded-pixel max.
 */
export const BROWSER_DEFAULT_DEVICE_SCALE_FACTOR = 2;
export const BROWSER_SCREENCAST_MAX_ENCODED_WIDTH = 3840;
export const BROWSER_SCREENCAST_MAX_ENCODED_HEIGHT = 2400;
export const BROWSER_SCREENCAST_MAX_ENCODED_AREA = 9_216_000;
export const BROWSER_SCREENCAST_HIGH_FPS_MAX_AREA = 5_000_000;
export const BROWSER_SCREENCAST_HIGH_FPS = 12;
export const BROWSER_SCREENCAST_LOW_FPS = 8;
export const BROWSER_SCREENCAST_QUALITY = 80;
export const BROWSER_SCREENSHOT_QUALITY = 80;
/** Annotation capture is one-shot and read off screen, so it keeps more detail. */
export const BROWSER_CAPTURE_QUALITY = 92;

export type BrowserScreencastSize = { width: number; height: number };

export type ResolveBrowserScreencastSizeInput = {
  width: number;
  height: number;
  deviceScaleFactor?: number;
  maxEncodedWidth?: number;
  maxEncodedHeight?: number;
  maxEncodedArea?: number;
};

/** Clamp a page DPR into the workbench capture range [1, 2]. */
export function clampBrowserDeviceScaleFactor(value: number): number {
  if (!Number.isFinite(value) || value < 1) return 1;
  if (value > BROWSER_DEFAULT_DEVICE_SCALE_FACTOR) return BROWSER_DEFAULT_DEVICE_SCALE_FACTOR;
  return value;
}

export function resolveBrowserScreencastFps(encodedArea: number, sessionMaxFps?: number): number {
  const areaFps =
    encodedArea <= BROWSER_SCREENCAST_HIGH_FPS_MAX_AREA
      ? BROWSER_SCREENCAST_HIGH_FPS
      : BROWSER_SCREENCAST_LOW_FPS;
  if (sessionMaxFps === undefined || !Number.isFinite(sessionMaxFps) || sessionMaxFps <= 0) {
    return areaFps;
  }
  return Math.min(sessionMaxFps, areaFps);
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
  const maxWidth = input.maxEncodedWidth ?? BROWSER_SCREENCAST_MAX_ENCODED_WIDTH;
  const maxHeight = input.maxEncodedHeight ?? BROWSER_SCREENCAST_MAX_ENCODED_HEIGHT;
  const maxArea = input.maxEncodedArea ?? BROWSER_SCREENCAST_MAX_ENCODED_AREA;
  if (
    !Number.isFinite(maxWidth) ||
    !Number.isFinite(maxHeight) ||
    !Number.isFinite(maxArea) ||
    maxWidth < 1 ||
    maxHeight < 1 ||
    maxArea < 1
  ) {
    return null;
  }

  let width = input.width * deviceScaleFactor;
  let height = input.height * deviceScaleFactor;
  const boxScale = Math.min(1, maxWidth / width, maxHeight / height);
  width *= boxScale;
  height *= boxScale;
  const area = width * height;
  if (area > maxArea) {
    const areaScale = Math.sqrt(maxArea / area);
    width *= areaScale;
    height *= areaScale;
  }
  return {
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  };
}
