/**
 * xterm.js theme projected from the live Deck CSS variables.
 *
 * The canvas is painted by xterm itself, not by CSS, so it has to read the
 * same ramp the rest of the shell just applied. `--term-bg` is the void step:
 * the terminal recesses into the field rather than sitting as a black slab
 * on Bone.
 */

import type { ITheme } from '@xterm/xterm';

function readVar(name: string): string {
  if (typeof document === 'undefined') {
    return '';
  }
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function readVarOr(name: string, fallback: string): string {
  const value = readVar(name);
  return value.length > 0 ? value : fallback;
}

/** Snapshot the current Deck ramp into an xterm ITheme. */
export function readDeckXtermTheme(): ITheme {
  const background = readVarOr('--term-bg', readVarOr('--void', '#08080b'));
  const foreground = readVarOr('--text-1', '#ededf2');
  const iris = readVarOr('--iris', '#6e5dff');
  return {
    background,
    foreground,
    cursor: iris,
    cursorAccent: readVarOr('--on-iris', '#ffffff'),
    selectionBackground: readVarOr('--iris-wash', iris),
    selectionForeground: foreground,
    black: background,
    red: readVarOr('--coral', '#ff5f56'),
    green: readVarOr('--mint', '#3ecf8e'),
    yellow: readVarOr('--amber', '#f5b544'),
    blue: readVarOr('--sky', '#4cc2ff'),
    magenta: iris,
    cyan: readVarOr('--sky', '#4cc2ff'),
    white: foreground,
    brightBlack: readVarOr('--text-3', '#62626f'),
    brightRed: readVarOr('--coral', '#ff5f56'),
    brightGreen: readVarOr('--mint', '#3ecf8e'),
    brightYellow: readVarOr('--amber', '#f5b544'),
    brightBlue: readVarOr('--sky', '#4cc2ff'),
    brightMagenta: readVarOr('--iris-lift', iris),
    brightCyan: readVarOr('--sky', '#4cc2ff'),
    brightWhite: foreground,
  };
}

export function readDeckXtermFontFamily(): string {
  return readVarOr(
    '--font-mono',
    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  );
}
