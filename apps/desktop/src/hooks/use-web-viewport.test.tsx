// @vitest-environment happy-dom
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useWebViewport } from './use-web-viewport.js';
import { WEB_VIEWPORT_HEIGHT_VAR, WEB_VIEWPORT_KEYBOARD_INSET_VAR } from '../browser/web-viewport.js';

describe('useWebViewport', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(window, 'visualViewport');
  });

  it('updates viewport CSS without rerendering the application root', async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    let renders = 0;
    function Harness(): ReactElement {
      renders += 1;
      useWebViewport();
      return <div />;
    }
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: null });
    const height = vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(800);
    try {
      await act(async () => root.render(<Harness />));
      const initialRenders = renders;
      expect(document.documentElement.style.getPropertyValue(WEB_VIEWPORT_HEIGHT_VAR)).toBe('800px');
      for (const nextHeight of [800, 780, 760, 740, 740]) {
        height.mockReturnValue(nextHeight);
        await act(async () => window.dispatchEvent(new Event('resize')));
      }
      expect(renders).toBe(initialRenders);
      expect(document.documentElement.style.getPropertyValue(WEB_VIEWPORT_HEIGHT_VAR)).toBe('740px');
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
    expect(document.documentElement.style.getPropertyValue(WEB_VIEWPORT_HEIGHT_VAR)).toBe('');
    window.dispatchEvent(new Event('resize'));
    expect(document.documentElement.style.getPropertyValue(WEB_VIEWPORT_HEIGHT_VAR)).toBe('');
  });

  it('keeps keyboard sizing and pan reset immediate without root state', async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const visual = Object.assign(new EventTarget(), {
      width: 390, height: 844, offsetTop: 0, scale: 1,
    });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: visual });
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(844);
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    function Harness(): ReactElement {
      useWebViewport();
      return <div />;
    }
    try {
      await act(async () => root.render(<Harness />));
      visual.height = 480;
      visual.offsetTop = 100;
      act(() => visual.dispatchEvent(new Event('resize')));
      expect(scrollTo).toHaveBeenCalledWith(0, 0);
      expect(document.documentElement.style.getPropertyValue(WEB_VIEWPORT_HEIGHT_VAR)).toBe('480px');
      expect(document.documentElement.style.getPropertyValue(WEB_VIEWPORT_KEYBOARD_INSET_VAR)).toBe('264px');
      scrollTo.mockClear();
      visual.scale = 2;
      act(() => visual.dispatchEvent(new Event('scroll')));
      expect(scrollTo).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
    visual.dispatchEvent(new Event('resize'));
    expect(document.documentElement.style.getPropertyValue(WEB_VIEWPORT_HEIGHT_VAR)).toBe('');
  });

  it('scrolls the focused field into view once the keyboard has shrunk the shell', async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const visual = Object.assign(new EventTarget(), {
      width: 390, height: 844, offsetTop: 0, scale: 1,
    });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: visual });
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(844);
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    const field = document.createElement('input');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    document.body.append(field, checkbox);
    const reveal = vi.fn();
    field.scrollIntoView = reveal;
    checkbox.scrollIntoView = reveal;
    function Harness(): ReactElement {
      useWebViewport();
      return <div />;
    }
    try {
      await act(async () => root.render(<Harness />));
      checkbox.focus();
      visual.height = 500;
      act(() => visual.dispatchEvent(new Event('resize')));
      expect(reveal).not.toHaveBeenCalled();
      field.focus();
      expect(reveal).toHaveBeenCalledWith({ block: 'center', inline: 'nearest' });
      reveal.mockClear();
      // Keyboard closes: nothing to reveal.
      visual.height = 844;
      act(() => visual.dispatchEvent(new Event('resize')));
      expect(reveal).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      container.remove();
      field.remove();
      checkbox.remove();
    }
  });
});
