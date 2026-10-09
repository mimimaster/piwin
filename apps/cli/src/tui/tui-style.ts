/**
 * Terminal styling primitives. Only the 16 base ANSI colors and attributes
 * are used, so the palette follows whatever theme the terminal (or Desktop's
 * xterm surface) already has instead of fighting it.
 */

type Style = (text: string) => string;

function sgr(open: number, close: number): Style {
  return (text) => `\x1b[${open}m${text}\x1b[${close}m`;
}

export const style = {
  bold: sgr(1, 22),
  dim: sgr(2, 22),
  italic: sgr(3, 23),
  underline: sgr(4, 24),
  strikethrough: sgr(9, 29),
  inverse: sgr(7, 27),
  red: sgr(31, 39),
  green: sgr(32, 39),
  yellow: sgr(33, 39),
  blue: sgr(34, 39),
  magenta: sgr(35, 39),
  cyan: sgr(36, 39),
  gray: sgr(90, 39),
} as const;

