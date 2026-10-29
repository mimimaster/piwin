// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScreenshotPinApp } from './ScreenshotPinApp';
import type { ScreenshotPinBridge } from './screenshot-pin-bridge';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('ScreenshotPinApp', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
  });

  async function mount(bridge: ScreenshotPinBridge): Promise<void> {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(<ScreenshotPinApp bridge={bridge} />);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it('closes when the PNG cannot be loaded', async () => {
    const bridge: ScreenshotPinBridge = {
      image: vi.fn(async () => {
        throw new Error('gone');
      }),
      close: vi.fn(async () => undefined),
    };
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await mount(bridge);
    expect(bridge.close).toHaveBeenCalledOnce();
    consoleError.mockRestore();
  });

  it('shows the image and closes on the button or Escape', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const bridge: ScreenshotPinBridge = {
      image: vi.fn(async () => png),
      close: vi.fn(async () => undefined),
    };
    await mount(bridge);
    expect(document.querySelector('[data-testid="screenshot-pin"]')).not.toBeNull();
    const close = document.querySelector<HTMLButtonElement>('[data-testid="screenshot-pin-close"]');
    if (close === null) throw new Error('close button missing');
    await act(async () => {
      close.click();
    });
    expect(bridge.close).toHaveBeenCalledOnce();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(bridge.close).toHaveBeenCalledTimes(2);
  });
});
