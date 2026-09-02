/**
 * Pure sRGB color helpers for theme derivation.
 *
 * Deliberately small and dependency-free: this runs during pre-paint startup
 * (main.tsx applies appearance before React mounts), so it must not pull in a
 * color library. Only the operations the Deck derivation actually needs.
 */

export type Rgb = { r: number; g: number; b: number };

const HEX_SHORT = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i;
const HEX_LONG = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;
const RGB_FUNC = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i;

const clampChannel = (value: number): number => Math.max(0, Math.min(255, Math.round(value)));

/**
 * Parse `#rgb`, `#rrggbb`, `rgb()`, or `rgba()`.
 * Returns null for anything else (named colors, color-mix, gradients) so
 * callers fall back rather than silently producing black.
 */
export function parseColor(input: string): Rgb | null {
  const value = input.trim();

  const short = HEX_SHORT.exec(value);
  if (short?.[1] !== undefined && short[2] !== undefined && short[3] !== undefined) {
    return {
      r: Number.parseInt(`${short[1]}${short[1]}`, 16),
      g: Number.parseInt(`${short[2]}${short[2]}`, 16),
      b: Number.parseInt(`${short[3]}${short[3]}`, 16),
    };
  }

  const long = HEX_LONG.exec(value);
  if (long?.[1] !== undefined && long[2] !== undefined && long[3] !== undefined) {
    return {
      r: Number.parseInt(long[1], 16),
      g: Number.parseInt(long[2], 16),
      b: Number.parseInt(long[3], 16),
    };
  }

  const func = RGB_FUNC.exec(value);
  if (func?.[1] !== undefined && func[2] !== undefined && func[3] !== undefined) {
    return {
      r: clampChannel(Number.parseFloat(func[1])),
      g: clampChannel(Number.parseFloat(func[2])),
      b: clampChannel(Number.parseFloat(func[3])),
    };
  }

  return null;
}

export function toHex({ r, g, b }: Rgb): string {
  const hex = (channel: number): string => clampChannel(channel).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/** Linear sRGB mix. `weight` 0 returns `a`, 1 returns `b`. */
export function mix(a: string, b: string, weight: number): string {
  const from = parseColor(a);
  const to = parseColor(b);
  if (from === null || to === null) {
    return a;
  }
  const at = (start: number, end: number): number => start + (end - start) * weight;
  return toHex({ r: at(from.r, to.r), g: at(from.g, to.g), b: at(from.b, to.b) });
}

/** Move a color toward black. `amount` 0 is unchanged, 1 is black. */
export const darken = (color: string, amount: number): string => mix(color, '#000000', amount);

/** Move a color toward white. `amount` 0 is unchanged, 1 is white. */
export const lighten = (color: string, amount: number): string => mix(color, '#ffffff', amount);

/**
 * WCAG relative luminance, 0 (black) → 1 (white).
 * Used to decide whether text on a fill should be light or dark.
 */
export function luminance(color: string): number {
  const rgb = parseColor(color);
  if (rgb === null) {
    return 0;
  }
  const channel = (raw: number): number => {
    const c = raw / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

/**
 * Threshold for choosing dark over light text on a fill.
 *
 * The contrast-optimal crossover is L ≈ 0.179, but applying it literally puts
 * near-black text on saturated mid-tone accents (a violet at L ≈ 0.19) where
 * the two options are within a few percent of each other and white reads far
 * better. Biasing the threshold up keeps white on saturated hues while still
 * switching to dark for genuinely light fills.
 */
const DARK_TEXT_LUMINANCE = 0.3;

/** Pick a readable foreground for a solid fill. */
export const readableOn = (fill: string): string =>
  luminance(fill) > DARK_TEXT_LUMINANCE ? '#141414' : '#ffffff';

/** WCAG 2.1 contrast ratio, 1 (identical) → 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const first = luminance(a);
  const second = luminance(b);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Bisection depth: 12 steps resolve a 0–1 mix weight below one 8-bit step. */
const CONTRAST_SOLVE_STEPS = 12;

/**
 * Least-changed variant of `color` that clears `ratio` against `background`.
 *
 * The muted end of a derived ramp is the one place an installed theme can
 * produce output that is technically a color but functionally invisible, and
 * the shell paints real information with it (timestamps, section labels, code
 * gutters). Rather than trust a fixed mix weight to land somewhere readable
 * for an arbitrary palette, walk toward `toward` only as far as the floor
 * requires, so a theme that was already readable is returned untouched and its
 * hue is preserved.
 */
export function ensureContrast(
  color: string,
  background: string,
  ratio: number,
  toward: string,
): string {
  if (contrastRatio(color, background) >= ratio) {
    return color;
  }
  if (contrastRatio(toward, background) < ratio) {
    // Even the endpoint cannot reach the floor; it is still the best available.
    return toward;
  }
  let insufficient = 0;
  let sufficient = 1;
  for (let step = 0; step < CONTRAST_SOLVE_STEPS; step += 1) {
    const midpoint = (insufficient + sufficient) / 2;
    if (contrastRatio(mix(color, toward, midpoint), background) >= ratio) {
      sufficient = midpoint;
    } else {
      insufficient = midpoint;
    }
  }
  return mix(color, toward, sufficient);
}

/** `rgba()` string from a base color plus an alpha, for hairlines and washes. */
export function alpha(color: string, value: number): string {
  const rgb = parseColor(color);
  if (rgb === null) {
    return color;
  }
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${value})`;
}
