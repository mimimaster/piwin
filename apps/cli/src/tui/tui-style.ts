/**
 * Terminal styling primitives. Only the 16 base ANSI colors and attributes
 * are used, so the palette follows whatever theme the terminal (or Desktop's
 * xterm surface) already has instead of fighting it.
 */

type Style = (text: string) => string;

function sgr(open: number, close: number): Style {
  return (text) => `\x1b[${open}m${text}\x1b[${close}m`;
}

const plain: Style = (text) => text;

/**
 * `NO_COLOR` (https://no-color.org) drops hue but keeps attributes, so the
 * hierarchy survives: errors still lead with ✗, secondary text is dimmed.
 * `PIWIN_TUI_THEME=high-contrast` draws secondary text in the normal color
 * instead of bright black, which some terminals render almost invisible.
 */
export function createStyle(env: NodeJS.ProcessEnv) {
  const noColor = (env.NO_COLOR ?? '') !== '';
  const hue = (open: number): Style => (noColor ? plain : sgr(open, 39));
  const secondary: Style = noColor ? sgr(2, 22) : env.PIWIN_TUI_THEME === 'high-contrast' ? plain : sgr(90, 39);
  return {
    bold: sgr(1, 22),
    dim: sgr(2, 22),
    italic: sgr(3, 23),
    underline: sgr(4, 24),
    strikethrough: sgr(9, 29),
    inverse: sgr(7, 27),
    red: hue(31),
    green: hue(32),
    yellow: hue(33),
    blue: hue(34),
    magenta: hue(35),
    cyan: hue(36),
    gray: secondary,
  } as const;
}

export const style = createStyle(process.env);
