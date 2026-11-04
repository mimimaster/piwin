// @vitest-environment happy-dom
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { useKeyboardInset } from './use-keyboard-inset.js';

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, 'visualViewport');
});

it('tracks the keyboard without treating pinch zoom as a keyboard', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const visual = Object.assign(new EventTarget(), { height: 844, offsetTop: 0, scale: 1 });
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: visual });
  vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(844);
  function Harness(): ReactElement {
    useKeyboardInset();
    return <div />;
  }
  try {
    await act(async () => root.render(<Harness />));
    visual.height = 422;
    visual.scale = 2;
    act(() => visual.dispatchEvent(new Event('resize')));
    expect(document.documentElement.style.getPropertyValue('--keyboard-inset')).toBe('0px');
    expect(document.documentElement.style.getPropertyValue('--mobile-visible-height')).toBe('844px');
    visual.scale = 1;
    visual.height = 500;
    act(() => visual.dispatchEvent(new Event('resize')));
    expect(document.documentElement.style.getPropertyValue('--keyboard-inset')).toBe('344px');
    expect(document.documentElement.style.getPropertyValue('--mobile-visible-height')).toBe('500px');
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
  expect(document.documentElement.style.getPropertyValue('--keyboard-inset')).toBe('');
  expect(document.documentElement.style.getPropertyValue('--mobile-visible-height')).toBe('');
});
