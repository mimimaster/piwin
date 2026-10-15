// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { PiwinConfig } from '@piwin/contracts';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from '../appearance-tokens.js';
import { SettingsProvider, type SettingsContextValue } from './settings-context.js';
import { NetworkProxySettings } from './network-proxy-settings.js';

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

function render(contextValue: Partial<SettingsContextValue>): HTMLDivElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  container = host;
  root = createRoot(host);
  act(() => {
    root?.render(
      <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
        <SettingsProvider value={contextValue as SettingsContextValue}>
          <NetworkProxySettings />
        </SettingsProvider>
      </PiwinUiProvider>,
    );
  });
  return host;
}

async function click(view: HTMLElement, testId: string): Promise<void> {
  await act(async () => {
    view.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)?.click();
    await Promise.resolve();
    await Promise.resolve();
  });
}

const BASE_CONFIG = { providers: [], network: { proxyUrl: 'direct' } } as unknown as PiwinConfig;

describe('NetworkProxySettings', () => {
  it('saves the detected system proxy in one click', async () => {
    const saveConfig = vi.fn(async () => true);
    const setInfo = vi.fn();
    const request = vi.fn(async () => ({
      type: 'response' as const,
      command: 'network/detect-system-proxy',
      success: true as const,
      data: { supported: true, proxyUrl: 'http://127.0.0.1:7897' },
    }));
    const view = render({
      config: BASE_CONFIG,
      saveConfig,
      setInfo,
      hostClient: { request, subscribe: vi.fn(() => () => {}) },
    });
    await click(view, 'network-proxy-use-system');
    expect(request).toHaveBeenCalledWith({ type: 'network/detect-system-proxy' });
    const saved = (saveConfig.mock.calls[0] as unknown as [PiwinConfig])[0];
    expect(saved.network).toEqual({ proxyUrl: 'http://127.0.0.1:7897' });
    expect(setInfo).toHaveBeenCalledWith(expect.stringContaining('127.0.0.1:7897'), 'success');
  });

  it('explains when the system has no usable proxy and saves nothing', async () => {
    const saveConfig = vi.fn(async () => true);
    const request = vi.fn(async () => ({
      type: 'response' as const,
      command: 'network/detect-system-proxy',
      success: true as const,
      data: { supported: true },
    }));
    const view = render({
      config: BASE_CONFIG,
      saveConfig,
      setInfo: vi.fn(),
      hostClient: { request, subscribe: vi.fn(() => () => {}) },
    });
    await click(view, 'network-proxy-use-system');
    expect(saveConfig).not.toHaveBeenCalled();
    expect(view.querySelector('[data-testid="network-proxy-error"]')?.textContent).toMatch(/SOCKS/);
  });

  it('hides the system proxy button when the Host lacks the command', () => {
    const view = render({
      config: BASE_CONFIG,
      saveConfig: vi.fn(),
      setInfo: vi.fn(),
      hostClient: {
        request: vi.fn(),
        subscribe: vi.fn(() => () => {}),
        supportsCommand: (type: string) => type !== 'network/detect-system-proxy',
      } as unknown as NonNullable<SettingsContextValue['hostClient']>,
    });
    expect(view.querySelector('[data-testid="network-proxy-use-system"]')).toBeNull();
    expect(view.querySelector<HTMLInputElement>('[data-testid="network-proxy-url"]')?.value).toBe('direct');
  });
});
