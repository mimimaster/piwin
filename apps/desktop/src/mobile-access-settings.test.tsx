// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { HostResponse, HostCommand, LocalMobileAccessCommand } from '@piwin/contracts';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens.js';
import { DesktopLocaleProvider } from './desktop-locale-context.js';
import { SettingsProvider, type SettingsContextValue } from './settings/settings-context.js';
import { MobileAccessSettings } from './mobile-access-settings.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function renderSettings(options: {
  transport?: 'live' | 'remote' | 'mock';
  request?: (command: HostCommand | LocalMobileAccessCommand) => Promise<HostResponse>;
  locale?: 'zh-CN' | 'en';
}): { container: HTMLDivElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  const hostClient = {
    getTransport: () => options.transport ?? 'remote',
    request: options.request ?? vi.fn(async () => ({ success: true, type: 'response', command: 'noop' })),
  };

  const contextValue = {
    hostClient,
  } as unknown as SettingsContextValue;

  act(() => {
    root.render(
      <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
        <DesktopLocaleProvider locale={options.locale ?? 'en'} onLocaleChange={() => {}}>
          <SettingsProvider value={contextValue}>
            <MobileAccessSettings />
          </SettingsProvider>
        </DesktopLocaleProvider>
      </PiwinUiProvider>,
    );
  });

  return { container, root };
}

describe('MobileAccessSettings', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    if (root && container) {
      act(() => root?.unmount());
      container.remove();
    }
    root = undefined;
    container = undefined;
  });

  it('queries mobile-access/* when local sidecar is available', async () => {
    const requested: string[] = [];
    const request = vi.fn(async (command: HostCommand | LocalMobileAccessCommand): Promise<HostResponse> => {
      requested.push(command.type);
      if (command.type === 'mobile-access/status') {
        return {
          type: 'response',
          command: command.type,
          success: true,
          data: { listening: false, port: 8787, activeConnections: 0, pairedDeviceCount: 0 },
        };
      }
      if (command.type === 'mobile-access/list-devices') {
        return {
          type: 'response',
          command: command.type,
          success: true,
          data: { devices: [] },
        };
      }
      return { type: 'response', command: command.type, success: true, data: {} };
    });

    const rendered = renderSettings({ transport: 'live', request });
    root = rendered.root;
    container = rendered.container;

    // Wait for initial load effects
    await act(async () => {
      await Promise.resolve();
    });

    expect(requested).toContain('mobile-access/status');
    expect(requested).toContain('mobile-access/list-devices');
    expect(container.querySelector('[data-testid="mobile-access-listen"]')).not.toBeNull();
  });

  it('shows disabled warning when remote Host has not enabled pairing', async () => {
    const request = vi.fn(async (command: HostCommand | LocalMobileAccessCommand): Promise<HostResponse> => {
      if (command.type === 'host/pairing-status') {
        return {
          type: 'response',
          command: command.type,
          success: true,
          data: {
            enabled: false,
            canManage: false,
            pairedDeviceCount: 0,
            hostInstanceId: 'host-1',
          },
        };
      }
      return { type: 'response', command: command.type, success: true, data: {} };
    });

    const rendered = renderSettings({ transport: 'remote', request });
    root = rendered.root;
    container = rendered.container;

    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Phone access not enabled on Host');
    expect(container.textContent).toContain('PIWIN_HOST_PAIRING=1');
    expect(container.querySelector('[data-testid="mobile-access-copy-env"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="mobile-access-listen"]')).toBeNull();
  });

  it('enables code generation and device management when remote Host supports pairing', async () => {
    const request = vi.fn(async (command: HostCommand | LocalMobileAccessCommand): Promise<HostResponse> => {
      if (command.type === 'host/pairing-status') {
        return {
          type: 'response',
          command: command.type,
          success: true,
          data: {
            enabled: true,
            canManage: true,
            pairedDeviceCount: 1,
            hostInstanceId: 'host-1',
            advertisedEndpoint: 'wss://host.example.com:8787',
          },
        };
      }
      if (command.type === 'host/pairing-list-devices') {
        return {
          type: 'response',
          command: command.type,
          success: true,
          data: {
            devices: [
              {
                id: 'phone-1',
                name: 'iPhone 15',
                createdAt: new Date().toISOString(),
                lastSeenAt: new Date().toISOString(),
                revoked: false,
              },
            ],
          },
        };
      }
      if (command.type === 'host/pairing-create-code') {
        return {
          type: 'response',
          command: command.type,
          success: true,
          data: {
            pairingToken: 'token-xyz',
            uri: 'piwin://pair?endpoint=wss%3A%2F%2Fhost.example.com%3A8787&token=token-xyz',
            expiresAt: Date.now() + 600000,
            endpoint: 'wss://host.example.com:8787',
            hostInstanceId: 'host-1',
            protocolVersion: 1,
          },
        };
      }
      if (command.type === 'host/pairing-revoke-device') {
        return {
          type: 'response',
          command: command.type,
          success: true,
          data: { revoked: true },
        };
      }
      return { type: 'response', command: command.type, success: true, data: {} };
    });

    const rendered = renderSettings({ transport: 'remote', request });
    root = rendered.root;
    container = rendered.container;

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Check advertised endpoint and device
    const advertisedInput = container.querySelector('[data-testid="mobile-access-advertised"]') as HTMLInputElement;
    expect(advertisedInput?.value).toBe('wss://host.example.com:8787');
    expect(container.querySelector('[data-testid="mobile-access-device-phone-1"]')).not.toBeNull();

    // Click generate pairing code
    const generateBtn = container.querySelector('[data-testid="mobile-access-generate"]') as HTMLButtonElement;
    expect(generateBtn).not.toBeNull();
    await act(async () => {
      generateBtn.click();
    });

    // Pairing credential card appears
    expect(container.querySelector('[data-testid="mobile-access-pairing"]')).not.toBeNull();
    const uriInput = container.querySelector('[data-testid="mobile-access-pairing-uri"]') as HTMLInputElement;
    expect(uriInput.value).toContain('token-xyz');

    // Revoke device
    const revokeBtn = container.querySelector('[data-testid="mobile-access-revoke-phone-1"]') as HTMLButtonElement;
    expect(revokeBtn).not.toBeNull();
    await act(async () => {
      revokeBtn.click();
    });
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ type: 'host/pairing-revoke-device', deviceId: 'phone-1' }));
  });

  it('handles older Hosts that reject host/pairing-* gracefully', async () => {
    const request = vi.fn(async (command: HostCommand | LocalMobileAccessCommand): Promise<HostResponse> => {
      return {
        type: 'response',
        command: command.type,
        success: false,
        error: 'unknown command: host/pairing-status',
      };
    });

    const rendered = renderSettings({ transport: 'remote', request });
    root = rendered.root;
    container = rendered.container;

    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Host pairing not supported');
  });
});
