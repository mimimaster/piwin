// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import {
  WEB_VIEWPORT_HEIGHT_VAR,
  WEB_VIEWPORT_KEYBOARD_INSET_VAR,
  applyWebViewportCssVars,
  clearWebViewportCssVars,
  readWebViewportMetrics,
} from './web-viewport';

describe('readWebViewportMetrics', () => {
  afterEach(() => {
    clearWebViewportCssVars(document.documentElement);
  });

  it('falls back to window inner size when visualViewport is missing', () => {
    const view = {
      innerWidth: 390,
      innerHeight: 844,
      visualViewport: null,
    } as unknown as Window;
    expect(readWebViewportMetrics(view)).toEqual({
      width: 390,
      height: 844,
      offsetTop: 0,
      keyboardInset: 0,
    });
  });

  it('treats the gap below visualViewport as keyboard inset', () => {
    const view = {
      innerWidth: 390,
      innerHeight: 844,
      visualViewport: { width: 390, height: 480, offsetTop: 0 },
    } as unknown as Window;
    expect(readWebViewportMetrics(view)).toEqual({
      width: 390,
      height: 480,
      offsetTop: 0,
      keyboardInset: 364,
    });
  });

  it('writes and clears CSS variables without leaving residue', () => {
    const root = document.documentElement;
    applyWebViewportCssVars(root, {
      width: 390,
      height: 480,
      offsetTop: 0,
      keyboardInset: 120,
    });
    expect(root.style.getPropertyValue(WEB_VIEWPORT_HEIGHT_VAR)).toBe('480px');
    expect(root.style.getPropertyValue(WEB_VIEWPORT_KEYBOARD_INSET_VAR)).toBe('120px');
    clearWebViewportCssVars(root);
    expect(root.style.getPropertyValue(WEB_VIEWPORT_HEIGHT_VAR)).toBe('');
    expect(root.style.getPropertyValue(WEB_VIEWPORT_KEYBOARD_INSET_VAR)).toBe('');
  });
});
