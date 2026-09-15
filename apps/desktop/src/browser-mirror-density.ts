/**
 * Mirror density accounting (spec §4.1.1).
 *
 * The panel decides whether a frame is dense enough from the *real* encoded
 * JPEG size — never from the requested screencast size — against the pixels the
 * panel actually needs: displayed CSS size × the Desktop devicePixelRatio.
 */
import type { BrowserSessionFrame } from './browser-session-lease';

export const BROWSER_MIRROR_DENSITY_TARGET_RATIO = 0.9;

export type BrowserMirrorDensity = {
  /** encoded px / required px per axis. Undefined when the frame is unmeasured. */
  widthRatio?: number;
  heightRatio?: number;
  requiredWidth?: number;
  requiredHeight?: number;
  /** True only when a measured axis falls below the target ratio. */
  low: boolean;
};

export type ResolveBrowserMirrorDensityInput = {
  frame: Pick<
    BrowserSessionFrame,
    'encodedWidth' | 'encodedHeight' | 'viewportWidth' | 'viewportHeight'
  >;
  /** CSS size the frame is displayed at inside the panel. */
  displayWidth: number;
  displayHeight: number;
  devicePixelRatio: number;
};

function ratioOrUndefined(encoded: number | undefined, required: number): number | undefined {
  if (encoded === undefined || !Number.isFinite(encoded) || encoded <= 0) return undefined;
  if (!Number.isFinite(required) || required <= 0) return undefined;
  return encoded / required;
}

export function resolveBrowserMirrorDensity(
  input: ResolveBrowserMirrorDensityInput,
): BrowserMirrorDensity {
  const dpr =
    Number.isFinite(input.devicePixelRatio) && input.devicePixelRatio > 0
      ? input.devicePixelRatio
      : 1;
  const requiredWidth = input.displayWidth > 0 ? input.displayWidth * dpr : undefined;
  const requiredHeight = input.displayHeight > 0 ? input.displayHeight * dpr : undefined;
  const widthRatio =
    requiredWidth === undefined
      ? undefined
      : ratioOrUndefined(input.frame.encodedWidth, requiredWidth);
  const heightRatio =
    requiredHeight === undefined
      ? undefined
      : ratioOrUndefined(input.frame.encodedHeight, requiredHeight);
  const measured = [widthRatio, heightRatio].filter((ratio) => ratio !== undefined);
  return {
    ...(widthRatio !== undefined ? { widthRatio } : {}),
    ...(heightRatio !== undefined ? { heightRatio } : {}),
    ...(requiredWidth !== undefined ? { requiredWidth } : {}),
    ...(requiredHeight !== undefined ? { requiredHeight } : {}),
    low: measured.some((ratio) => ratio < BROWSER_MIRROR_DENSITY_TARGET_RATIO),
  };
}

export function formatBrowserDensityRatio(density: BrowserMirrorDensity): string | undefined {
  if (density.widthRatio === undefined || density.heightRatio === undefined) return undefined;
  return `${String(Math.round(density.widthRatio * 100))}% / ${String(Math.round(density.heightRatio * 100))}%`;
}
