/**
 * Host-OS key conventions the VT encoder does not cover (ADR 0013).
 *
 * xterm implements what a terminal emulator must *send*, not what the platform
 * around it *means* by a chord. On macOS ⌥← moves one word, ⌘← goes to the
 * line start, ⌘K clears the scrollback and ⌘+/⌘- change the type size; none of
 * those exist in `evaluateKeyboardEvent`, so a bare xterm reads as "almost a
 * terminal" exactly where a shell is used most. Resolving them as data keeps
 * the surface a renderer and the mapping unit-testable.
 *
 * Deliberately NOT bound: ⌥+letter (still types ∫ ∂ ƒ on macOS, as in
 * Terminal.app's default Option behaviour) and every Ctrl chord (the shell
 * owns them).
 */

import type { TerminalFontStep } from './terminal-font-size';

export type TerminalKeyPlatform = 'mac' | 'other';

/** The subset of KeyboardEvent the resolver reads; keeps the tests plain data. */
export type TerminalKeyChord = {
  key: string;
  metaKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
};

export type TerminalKeyIntent =
  /** Raw bytes for the program. */
  | { kind: 'write'; data: string }
  /** Clear screen and scrollback locally, as ⌘K does in Terminal.app. */
  | { kind: 'clear' }
  | { kind: 'font-step'; step: TerminalFontStep }
  /** Open another shell in the same panel; the owner creates the session. */
  | { kind: 'new-tab' }
  | { kind: 'copy' }
  | { kind: 'paste' };

const LINE_START = '\x01';
const LINE_END = '\x05';
const KILL_LINE = '\x15';
const WORD_LEFT = '\x1bb';
const WORD_RIGHT = '\x1bf';
const KILL_WORD_LEFT = '\x1b\x7f';

export function resolveTerminalKeyChord(
  chord: TerminalKeyChord,
  platform: TerminalKeyPlatform,
): TerminalKeyIntent | null {
  if (platform === 'mac') {
    // Ctrl belongs to the shell (Ctrl-C, Ctrl-R, Ctrl-Z), never to the host.
    if (chord.ctrlKey) {
      return null;
    }
    if (chord.metaKey && !chord.altKey) {
      // ⇧ is part of ⌘⇧= ("+"), so it may not disqualify a chord.
      switch (chord.key) {
        case 'k':
        case 'K':
          return { kind: 'clear' };
        case '=':
        case '+':
          return { kind: 'font-step', step: 'up' };
        case '-':
        case '_':
          return { kind: 'font-step', step: 'down' };
        case '0':
          return { kind: 'font-step', step: 'reset' };
        case 't':
        case 'T':
          return { kind: 'new-tab' };
        case 'ArrowLeft':
          return { kind: 'write', data: LINE_START };
        case 'ArrowRight':
          return { kind: 'write', data: LINE_END };
        case 'Backspace':
          return { kind: 'write', data: KILL_LINE };
        default:
          return null;
      }
    }
    if (chord.altKey && !chord.metaKey) {
      switch (chord.key) {
        case 'ArrowLeft':
          return { kind: 'write', data: WORD_LEFT };
        case 'ArrowRight':
          return { kind: 'write', data: WORD_RIGHT };
        case 'Backspace':
          return { kind: 'write', data: KILL_WORD_LEFT };
        default:
          return null;
      }
    }
    return null;
  }

  // Windows / Linux terminals copy and paste on Ctrl+Shift+C / Ctrl+Shift+V.
  if (chord.ctrlKey && chord.shiftKey && !chord.altKey && !chord.metaKey) {
    if (chord.key === 'c' || chord.key === 'C') {
      return { kind: 'copy' };
    }
    if (chord.key === 'v' || chord.key === 'V') {
      return { kind: 'paste' };
    }
    if (chord.key === 't' || chord.key === 'T') {
      return { kind: 'new-tab' };
    }
  }
  return null;
}
