/**
 * Bytes for keys a phone keyboard does not have. Terminal programs (pi-tui,
 * native agent CLIs) read xterm's standard sequences.
 */
export type TerminalBarKey = 'escape' | 'tab' | 'up' | 'down' | 'left' | 'right' | 'slash';

const PLAIN: Record<TerminalBarKey, string> = {
  escape: '\x1b',
  tab: '\t',
  up: '\x1b[A',
  down: '\x1b[B',
  right: '\x1b[C',
  left: '\x1b[D',
  slash: '/',
};

const ARROW_FINAL: Partial<Record<TerminalBarKey, string>> = { up: 'A', down: 'B', right: 'C', left: 'D' };

/** A bar key, with the sticky Ctrl applied where terminals define one. */
export function terminalBarKeySequence(key: TerminalBarKey, ctrl: boolean): string {
  if (!ctrl) return PLAIN[key];
  const arrow = ARROW_FINAL[key];
  if (arrow !== undefined) return `\x1b[1;5${arrow}`;
  if (key === 'tab') return '\x1b[9;5u';
  return PLAIN[key];
}

const CTRL_SYMBOLS: Record<string, string> = {
  ' ': '\x00',
  '@': '\x00',
  '[': '\x1b',
  '\\': '\x1c',
  ']': '\x1d',
  '^': '\x1e',
  '_': '\x1f',
  '?': '\x7f',
};

/**
 * Ctrl held for the next typed character, as a terminal sends it: letters
 * become C0 control codes (Ctrl-C → 0x03). Anything without a control form
 * is sent unchanged, so a stray tap never swallows input.
 */
export function applyTerminalCtrl(data: string): string {
  const [first] = data;
  if (first === undefined) return data;
  const rest = data.slice(first.length);
  const code = first.toLowerCase().charCodeAt(0);
  if (first.length === 1 && code >= 0x61 && code <= 0x7a) return String.fromCharCode(code - 0x60) + rest;
  const symbol = CTRL_SYMBOLS[first];
  return symbol === undefined ? data : symbol + rest;
}
