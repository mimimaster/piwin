// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScreenCaptureOverlayApp } from './ScreenCaptureOverlayApp';
import type { ScreenCaptureOverlayBridge } from './screen-capture-overlay-bridge';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('ScreenCaptureOverlayApp', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
  });

  it('cancels the capture when the screenshot cannot be loaded', async () => {
    const bridge: ScreenCaptureOverlayBridge = {
      image: vi.fn(async () => {
        throw new Error('gone');
      }),
      ready: vi.fn(async () => undefined),
      finish: vi.fn(async () => undefined),
      pin: vi.fn(async () => undefined),
      cancel: vi.fn(async () => undefined),
    };
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(<ScreenCaptureOverlayApp bridge={bridge} />);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(bridge.cancel).toHaveBeenCalledOnce();
    expect(bridge.ready).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
