/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from 'vitest';
import { readDeckXtermFontFamily, readDeckXtermTheme } from './xterm-theme';

describe('readDeckXtermTheme', () => {
  it('reads Deck CSS variables so the canvas matches the active face', () => {
    const root = document.documentElement;
    root.style.setProperty('--void', '#08080b');
    root.style.setProperty('--term-bg', '#08080b');
    root.style.setProperty('--text-1', '#ededf2');
    root.style.setProperty('--iris', '#6e5dff');
    root.style.setProperty('--on-iris', '#ffffff');
    root.style.setProperty('--iris-wash', 'rgba(110, 93, 255, 0.14)');
    root.style.setProperty('--coral', '#ff5f56');
    root.style.setProperty('--mint', '#3ecf8e');
    root.style.setProperty('--amber', '#f5b544');
    root.style.setProperty('--sky', '#4cc2ff');
    root.style.setProperty('--font-mono', '"JetBrains Mono", monospace');

    const theme = readDeckXtermTheme();
    expect(theme.background).toBe('#08080b');
    expect(theme.foreground).toBe('#ededf2');
    expect(theme.cursor).toBe('#6e5dff');
    expect(theme.red).toBe('#ff5f56');
    expect(theme.green).toBe('#3ecf8e');
    expect(readDeckXtermFontFamily()).toContain('JetBrains Mono');
  });

  it('follows a light-face void rather than a hardcoded black slab', () => {
    const root = document.documentElement;
    root.style.setProperty('--void', '#e5e2dc');
    root.style.setProperty('--term-bg', '#e5e2dc');
    root.style.setProperty('--text-1', '#17161b');
    root.style.setProperty('--iris', '#5b4bd6');

    const theme = readDeckXtermTheme();
    expect(theme.background).toBe('#e5e2dc');
    expect(theme.foreground).toBe('#17161b');
    expect(theme.cursor).toBe('#5b4bd6');
  });
});
