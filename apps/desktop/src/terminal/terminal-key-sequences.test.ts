import { describe, expect, it } from 'vitest';
import { applyTerminalCtrl, terminalBarKeySequence } from './terminal-key-sequences';

describe('terminal bar keys', () => {
  it('sends the standard xterm sequences', () => {
    expect(terminalBarKeySequence('escape', false)).toBe('\x1b');
    expect(terminalBarKeySequence('tab', false)).toBe('\t');
    expect(terminalBarKeySequence('up', false)).toBe('\x1b[A');
    expect(terminalBarKeySequence('left', false)).toBe('\x1b[D');
    expect(terminalBarKeySequence('slash', false)).toBe('/');
  });

  it('applies Ctrl to arrows and Tab, and leaves keys without a Ctrl form alone', () => {
    expect(terminalBarKeySequence('right', true)).toBe('\x1b[1;5C');
    expect(terminalBarKeySequence('tab', true)).toBe('\x1b[9;5u');
    expect(terminalBarKeySequence('escape', true)).toBe('\x1b');
  });
});

describe('sticky Ctrl', () => {
  it('turns letters into control codes regardless of case', () => {
    expect(applyTerminalCtrl('c')).toBe('\x03');
    expect(applyTerminalCtrl('C')).toBe('\x03');
    expect(applyTerminalCtrl('a')).toBe('\x01');
    expect(applyTerminalCtrl('z')).toBe('\x1a');
  });

  it('maps the symbol controls and keeps the rest of the chunk', () => {
    expect(applyTerminalCtrl('[')).toBe('\x1b');
    expect(applyTerminalCtrl(' ')).toBe('\x00');
    expect(applyTerminalCtrl('dxy')).toBe('\x04xy');
  });

  it('never swallows input it cannot control', () => {
    expect(applyTerminalCtrl('1')).toBe('1');
    expect(applyTerminalCtrl('你')).toBe('你');
    expect(applyTerminalCtrl('')).toBe('');
  });
});
