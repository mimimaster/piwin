/**
 * Parse the hard-coded color tokens models write (hex, rgb(a), white/black)
 * and measure them. Shared by the theme contract's repairs and the derived
 * `on-accent` ink, so both judge "light" and "dark" the same way.
 */

export type Rgba = { r: number; g: number; b: number; a: number };

export function parseColorToken(token: string): Rgba | undefined {
  const lower = token.trim().toLowerCase();
  if (lower === 'white') return { r: 255, g: 255, b: 255, a: 1 };
  if (lower === 'black') return { r: 0, g: 0, b: 0, a: 1 };
  if (lower.startsWith('#')) {
    const hex = lower.slice(1);
    const full =
      hex.length === 3 || hex.length === 4
        ? hex
            .split('')
            .map((c) => c + c)
            .join('')
        : hex;
    if (full.length !== 6 && full.length !== 8) return undefined;
    return {
      r: parseInt(full.slice(0, 2), 16),
      g: parseInt(full.slice(2, 4), 16),
      b: parseInt(full.slice(4, 6), 16),
      a: full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1,
    };
  }
  if (!/^rgba?\(/.test(lower)) return undefined;
  const parts = lower
    .replace(/^rgba?\(/, '')
    .replace(/\)$/, '')
    .split(/[\s,/]+/)
    .filter(Boolean)
    .map((part) => (part.endsWith('%') ? (parseFloat(part) / 100) * 255 : parseFloat(part)));
  const [r, g, b, alpha] = parts;
  if (r === undefined || g === undefined || b === undefined) return undefined;
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return undefined;
  return {
    r,
    g,
    b,
    a: alpha === undefined || Number.isNaN(alpha) ? 1 : alpha > 1 ? alpha / 255 : alpha,
  };
}

export function relativeLuminance({ r, g, b }: Rgba): number {
  const channel = (value: number): number => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
