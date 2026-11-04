/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  TERMINAL_FONT_SIZE_DEFAULT,
  TERMINAL_FONT_SIZE_MAX,
  TERMINAL_FONT_SIZE_MIN,
  clampTerminalFontSize,
  readTerminalFontSize,
  stepTerminalFontSize,
  writeTerminalFontSize,
} from './terminal-font-size';

describe('terminal font size', () => {
  beforeEach(() => {
    globalThis.localStorage?.clear();
  });

  it('steps one pixel and stops at the bounds', () => {
    expect(stepTerminalFontSize(13, 'up')).toBe(14);
    expect(stepTerminalFontSize(13, 'down')).toBe(12);
    expect(stepTerminalFontSize(TERMINAL_FONT_SIZE_MAX, 'up')).toBe(TERMINAL_FONT_SIZE_MAX);
    expect(stepTerminalFontSize(TERMINAL_FONT_SIZE_MIN, 'down')).toBe(TERMINAL_FONT_SIZE_MIN);
    expect(stepTerminalFontSize(19, 'reset')).toBe(TERMINAL_FONT_SIZE_DEFAULT);
  });

  it('never returns a font size outside the readable range', () => {
    expect(clampTerminalFontSize(4)).toBe(TERMINAL_FONT_SIZE_MIN);
    expect(clampTerminalFontSize(200)).toBe(TERMINAL_FONT_SIZE_MAX);
    expect(clampTerminalFontSize(Number.NaN)).toBe(TERMINAL_FONT_SIZE_DEFAULT);
  });

  it('remembers the size and falls back on junk', () => {
    expect(readTerminalFontSize()).toBe(TERMINAL_FONT_SIZE_DEFAULT);
    writeTerminalFontSize(17);
    expect(readTerminalFontSize()).toBe(17);
    globalThis.localStorage?.setItem('piwin:terminal-font-size', 'huge');
    expect(readTerminalFontSize()).toBe(TERMINAL_FONT_SIZE_DEFAULT);
  });
});
