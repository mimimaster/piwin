// @vitest-environment happy-dom
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useWindowResizeActivity } from './use-window-resize-activity.js';
import { isPanelResizeActive } from '../panel-resize-activity.js';

describe('useWindowResizeActivity', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
  });

  it.each(['desktop', 'mobile'] as const)('protects %s resize while leaving phone keyboard changes alone', async (runtime) => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} });
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(runtime === 'mobile' ? 'iPhone' : 'Macintosh');
    const width = vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1_000);
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    function Harness(): ReactElement {
      useWindowResizeActivity();
      return <div />;
    }
    try {
      await act(async () => root.render(<Harness />));
      width.mockReturnValue(1_020);
      window.dispatchEvent(new Event('resize'));
      expect(isPanelResizeActive()).toBe(runtime === 'desktop');
      expect(document.documentElement.dataset.windowResizing).toBe(runtime === 'desktop' ? 'true' : undefined);
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
    expect(isPanelResizeActive()).toBe(false);
  });
});
