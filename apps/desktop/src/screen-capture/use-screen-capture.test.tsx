// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DesktopScreenCaptureOs, ScreenCaptureAuthorization } from './screen-capture-os';
import { useScreenCapture, type ScreenCaptureController } from './use-screen-capture';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function fakeOs(authorization: ScreenCaptureAuthorization) {
  let shortcutListener: (() => void) | undefined;
  const unsubscribe = vi.fn();
  const os: DesktopScreenCaptureOs = {
    capabilities: vi.fn(async () => ({ supported: true, systemRegionPicker: true })),
    authorizationStatus: vi.fn(async () => authorization),
    requestAuthorization: vi.fn(async () => authorization),
    openSystemSettings: vi.fn(async () => undefined),
    restartApp: vi.fn(async () => undefined),
    revealApp: vi.fn(async () => undefined),
    onShortcut: vi.fn(async (listener: () => void) => {
      shortcutListener = listener;
      return unsubscribe;
    }),
    take: vi.fn(async () => ({ status: 'cancelled' as const })),
    read: vi.fn(async () => new Uint8Array()),
  };
  return { os, unsubscribe, pressShortcut: () => shortcutListener?.() };
}

describe('useScreenCapture', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
  });

  async function mount(os: DesktopScreenCaptureOs): Promise<{ current: ScreenCaptureController }> {
    const latest = { current: undefined as unknown as ScreenCaptureController };
    function Probe(): null {
      latest.current = useScreenCapture({
        locale: 'en',
        canAttach: () => true,
        imageRefusal: () => undefined,
        attachImage: vi.fn(),
        dispatchNotification: vi.fn(),
        os,
      });
      return null;
    }
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(<Probe />);
    });
    return latest;
  }

  async function settle(): Promise<void> {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it('starts a capture from the global shortcut and stays put on cancel', async () => {
    const { os, pressShortcut } = fakeOs('authorized');
    await mount(os);
    act(() => pressShortcut());
    await settle();
    expect(os.take).toHaveBeenCalledOnce();
    expect(os.revealApp).not.toHaveBeenCalled();
  });

  it('runs one capture when the global and in-app shortcuts fire together', async () => {
    const { os, pressShortcut } = fakeOs('authorized');
    const controller = await mount(os);
    act(() => {
      pressShortcut();
      controller.current.start();
    });
    await settle();
    expect(os.take).toHaveBeenCalledOnce();
  });

  it('brings piwin forward for the permission prompt', async () => {
    const { os, pressShortcut } = fakeOs('not-determined-or-denied');
    const controller = await mount(os);
    act(() => pressShortcut());
    await settle();
    expect(controller.current.phase.kind).toBe('permission');
    expect(os.revealApp).toHaveBeenCalledOnce();
    expect(os.take).not.toHaveBeenCalled();
  });

  it('stops listening on unmount', async () => {
    const { os, unsubscribe } = fakeOs('authorized');
    await mount(os);
    act(() => root?.unmount());
    root = undefined;
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
