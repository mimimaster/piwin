// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { HOST_UNREACHABLE_AFTER_MS, HostReconnectBanner } from './host-reconnect-banner';
import { attachHostWakeEvents } from './host-wake-events';
import { saveDesktopRemoteHostTarget, clearDesktopRemoteHostTarget } from './remote-host-session';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

describe('HostReconnectBanner', () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    saveDesktopRemoteHostTarget({ endpoint: 'ws://192.168.1.20:8790' });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <HostReconnectBanner locale="zh-CN" />
        </PiwinUiProvider>,
      );
    });
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    root = null;
    container = null;
    clearDesktopRemoteHostTarget();
    vi.useRealTimers();
  });

  const banner = (): HTMLElement | null =>
    container?.querySelector('[data-testid="host-reconnect-banner"]') ?? null;

  it('only says "connecting" during a brief drop', () => {
    expect(banner()?.dataset.state).toBeUndefined();
    expect(container?.querySelector('[data-testid="host-reconnect-retry"]')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(HOST_UNREACHABLE_AFTER_MS - 1);
    });
    expect(banner()?.dataset.state).toBeUndefined();
  });

  it('names the Host and offers a retry once the outage lasts', () => {
    const wake = vi.fn(() => true);
    const redial = vi.fn();
    const detach = attachHostWakeEvents({
      getClient: () => ({ wake, getState: () => ({ kind: 'disconnected' }) }),
      redial,
    });
    act(() => {
      vi.advanceTimersByTime(HOST_UNREACHABLE_AFTER_MS);
    });
    expect(banner()?.dataset.state).toBe('unreachable');
    expect(banner()?.textContent).toContain('192.168.1.20:8790');

    const retry = container?.querySelector<HTMLButtonElement>('[data-testid="host-reconnect-retry"]');
    act(() => {
      retry?.click();
    });
    expect(wake).toHaveBeenCalledTimes(1);
    expect(redial).not.toHaveBeenCalled();
    detach();
  });
});
