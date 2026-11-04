import { describe, expect, it } from 'vitest';
import { resolveTerminalKeyChord, type TerminalKeyChord } from './xterm-key-bindings';

function chord(partial: Partial<TerminalKeyChord> & { key: string }): TerminalKeyChord {
  return { metaKey: false, altKey: false, ctrlKey: false, shiftKey: false, ...partial };
}

describe('macOS chords', () => {
  it('clears and resizes like Terminal.app', () => {
    expect(resolveTerminalKeyChord(chord({ key: 'k', metaKey: true }), 'mac'))
      .toEqual({ kind: 'clear' });
    expect(resolveTerminalKeyChord(chord({ key: '=', metaKey: true }), 'mac'))
      .toEqual({ kind: 'font-step', step: 'up' });
    // ⇧= is how "+" is typed.
    expect(resolveTerminalKeyChord(chord({ key: '+', metaKey: true, shiftKey: true }), 'mac'))
      .toEqual({ kind: 'font-step', step: 'up' });
    expect(resolveTerminalKeyChord(chord({ key: '-', metaKey: true }), 'mac'))
      .toEqual({ kind: 'font-step', step: 'down' });
    expect(resolveTerminalKeyChord(chord({ key: '0', metaKey: true }), 'mac'))
      .toEqual({ kind: 'font-step', step: 'reset' });
    expect(resolveTerminalKeyChord(chord({ key: 't', metaKey: true }), 'mac'))
      .toEqual({ kind: 'new-tab' });
  });

  it('moves by word on Option and by line on Command', () => {
    expect(resolveTerminalKeyChord(chord({ key: 'ArrowLeft', altKey: true }), 'mac'))
      .toEqual({ kind: 'write', data: '\x1bb' });
    expect(resolveTerminalKeyChord(chord({ key: 'ArrowRight', altKey: true }), 'mac'))
      .toEqual({ kind: 'write', data: '\x1bf' });
    expect(resolveTerminalKeyChord(chord({ key: 'Backspace', altKey: true }), 'mac'))
      .toEqual({ kind: 'write', data: '\x1b\x7f' });
    expect(resolveTerminalKeyChord(chord({ key: 'ArrowLeft', metaKey: true }), 'mac'))
      .toEqual({ kind: 'write', data: '\x01' });
    expect(resolveTerminalKeyChord(chord({ key: 'ArrowRight', metaKey: true }), 'mac'))
      .toEqual({ kind: 'write', data: '\x05' });
    expect(resolveTerminalKeyChord(chord({ key: 'Backspace', metaKey: true }), 'mac'))
      .toEqual({ kind: 'write', data: '\x15' });
  });

  it('leaves the shell and the native Option glyphs alone', () => {
    // Ctrl-C must stay SIGINT even with the meta layer present.
    expect(resolveTerminalKeyChord(chord({ key: 'c', ctrlKey: true }), 'mac')).toBeNull();
    expect(resolveTerminalKeyChord(chord({ key: 'c', ctrlKey: true, metaKey: true }), 'mac')).toBeNull();
    // Option+letter still types ∫ ∂ ƒ.
    expect(resolveTerminalKeyChord(chord({ key: 'b', altKey: true }), 'mac')).toBeNull();
    // Plain typing, arrows, Enter, Tab.
    expect(resolveTerminalKeyChord(chord({ key: 'ArrowLeft' }), 'mac')).toBeNull();
    expect(resolveTerminalKeyChord(chord({ key: 'Enter' }), 'mac')).toBeNull();
    expect(resolveTerminalKeyChord(chord({ key: 'k' }), 'mac')).toBeNull();
  });
});

describe('Windows and Linux chords', () => {
  it('copies and pastes on Ctrl+Shift', () => {
    expect(resolveTerminalKeyChord(chord({ key: 'c', ctrlKey: true, shiftKey: true }), 'other'))
      .toEqual({ kind: 'copy' });
    expect(resolveTerminalKeyChord(chord({ key: 'V', ctrlKey: true, shiftKey: true }), 'other'))
      .toEqual({ kind: 'paste' });
    expect(resolveTerminalKeyChord(chord({ key: 'T', ctrlKey: true, shiftKey: true }), 'other'))
      .toEqual({ kind: 'new-tab' });
  });

  it('keeps plain Ctrl for the shell', () => {
    expect(resolveTerminalKeyChord(chord({ key: 'c', ctrlKey: true }), 'other')).toBeNull();
    expect(resolveTerminalKeyChord(chord({ key: 'v', ctrlKey: true }), 'other')).toBeNull();
  });
});
