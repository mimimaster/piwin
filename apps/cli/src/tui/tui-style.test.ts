import { describe, expect, it } from 'vitest';
import { createStyle } from './tui-style.js';

describe('createStyle', () => {
  it('colors by default', () => {
    expect(createStyle({}).red('x')).toBe('\x1b[31mx\x1b[39m');
    expect(createStyle({}).gray('x')).toBe('\x1b[90mx\x1b[39m');
  });

  it('drops hue under NO_COLOR but keeps attributes and dims secondary text', () => {
    const style = createStyle({ NO_COLOR: '1' });
    expect(style.red('x')).toBe('x');
    expect(style.cyan('x')).toBe('x');
    expect(style.bold('x')).toBe('\x1b[1mx\x1b[22m');
    expect(style.gray('x')).toBe('\x1b[2mx\x1b[22m');
  });

  it('treats an empty NO_COLOR as unset, per the convention', () => {
    expect(createStyle({ NO_COLOR: '' }).red('x')).toBe('\x1b[31mx\x1b[39m');
  });

  it('draws secondary text in the normal color in the high-contrast theme', () => {
    const style = createStyle({ PIWIN_TUI_THEME: 'high-contrast' });
    expect(style.gray('x')).toBe('x');
    expect(style.red('x')).toBe('\x1b[31mx\x1b[39m');
  });
});
