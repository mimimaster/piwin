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

  it('shows a scannable QR for the LAN address when the bundled sidecar is listening', async () => {
    const requested: Array<HostCommand | LocalMobileAccessCommand> = [];
    let listening = true;
    let advertised = 'ws://192.168.1.5:8787';
    const status = () => ({
      listening,
      pairedDeviceCount: 0,
      enabled: listening,
      advertisedEndpointSource: advertised === 'ws://192.168.1.5:8787' ? 'auto' : 'custom',
      ...(listening
        ? {
            profileId: 'lan',
            bindHost: '0.0.0.0',
            bindPort: 8787,
            advertisedEndpoint: advertised,
            endpointCandidates: [
              { url: 'ws://192.168.1.5:8787', kind: 'lan', interfaceName: 'en0' },
              { url: 'ws://100.64.1.2:8787', kind: 'tailscale', interfaceName: 'utun4' },
            ],
          }
        : {}),
    });
    const request = vi.fn(async (command: HostCommand | LocalMobileAccessCommand): Promise<HostResponse> => {
      requested.push(command);
      const ok = (data: unknown): HostResponse => ({ type: 'response', command: command.type, success: true, data });
      switch (command.type) {
        case 'mobile-access/status':
          return ok(status());
        case 'mobile-access/list-devices':
          return ok({ devices: [] });
        case 'mobile-access/create-pairing-code':
          return ok({
            endpoint: advertised,
            pairingToken: 'tok',
            hostInstanceId: 'sidecar-1',
            protocolVersion: 1,
            expiresAt: Date.now() + 600_000,
            uri: `piwin://pair?endpoint=${encodeURIComponent(advertised)}&pairingToken=tok`,
          });
        case 'mobile-access/start': {
          listening = true;
          const next = (command as { advertisedEndpoint?: string }).advertisedEndpoint;
          if (next !== undefined) {
            advertised = next === '' ? 'ws://192.168.1.5:8787' : next;
          }
          return ok(status());
        }
        case 'mobile-access/stop':
          listening = false;
          return ok(status());
        default:
          return ok({});
      }
    });

    const rendered = renderSettings({ transport: 'live', request });
    root = rendered.root;
    container = rendered.container;
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const switchEl = container.querySelector('[data-testid="mobile-access-listen"]') as HTMLInputElement;
    expect(switchEl.checked).toBe(true);
    expect(container.querySelector('[data-testid="mobile-access-qr"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="mobile-access-pairing-endpoint"]')?.textContent).toBe(
      'ws://192.168.1.5:8787',
    );
    const select = container.querySelector('select') as HTMLSelectElement;
    expect(select.value).toBe('auto');
    expect(Array.from(select.options).map((option) => option.value)).toEqual([
      'auto',
      'ws://192.168.1.5:8787',
      'ws://100.64.1.2:8787',
      'custom',
    ]);

    // Picking the Tailscale address restarts with that override and re-mints the QR for it.
    await act(async () => {
      select.value = 'ws://100.64.1.2:8787';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(requested).toContainEqual(
      expect.objectContaining({ type: 'mobile-access/start', profileId: 'lan', advertisedEndpoint: 'ws://100.64.1.2:8787' }),
    );
    expect(container.querySelector('[data-testid="mobile-access-pairing-endpoint"]')?.textContent).toBe(
      'ws://100.64.1.2:8787',
    );

    // Off removes the QR; on again restarts on the LAN profile without resetting the address.
    await act(async () => {
      switchEl.click();
    });
    expect(requested).toContainEqual(expect.objectContaining({ type: 'mobile-access/stop' }));
    expect(container.querySelector('[data-testid="mobile-access-qr"]')).toBeNull();
    await act(async () => {
      (container?.querySelector('[data-testid="mobile-access-listen"]') as HTMLInputElement).click();
    });
    const lastStart = requested.filter((command) => command.type === 'mobile-access/start').at(-1);
    expect(lastStart).toEqual({ type: 'mobile-access/start', profileId: 'lan' });
  });

  it('explains why the bundled sidecar could not start listening', async () => {
    const request = vi.fn(async (command: HostCommand | LocalMobileAccessCommand): Promise<HostResponse> => {
      const ok = (data: unknown): HostResponse => ({ type: 'response', command: command.type, success: true, data });
      if (command.type === 'mobile-access/status') {
        return ok({
          listening: false,
          pairedDeviceCount: 0,
          enabled: true,
          lastError: 'Phone access found no free port in 8787–8797',
        });
      }
      return ok({ devices: [] });
    });
    const rendered = renderSettings({ transport: 'live', request, locale: 'zh-CN' });
    root = rendered.root;
    container = rendered.container;
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.textContent).toContain('手机接入没有启动：Phone access found no free port');
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

    expect(container.textContent).toContain('Phone access is off on this Host');
    expect(container.textContent).not.toContain('PIWIN_HOST_PAIRING');
    const switchEl = container.querySelector('[data-testid="mobile-access-listen"]') as HTMLInputElement;
    expect(switchEl).not.toBeNull();
    expect(switchEl.checked).toBe(false);
    expect(switchEl.disabled).toBe(true);
  });

  it('allows an operator to turn on pairing via the switch when remote Host pairing is inactive', async () => {
    let enabled = false;
    const request = vi.fn(async (command: HostCommand | LocalMobileAccessCommand): Promise<HostResponse> => {
      if (command.type === 'host/pairing-status') {
        return {
          type: 'response',
          command: command.type,
          success: true,
          data: {
            enabled,
            canManage: true,
            pairedDeviceCount: 0,
            hostInstanceId: 'host-1',
            ...(enabled ? { advertisedEndpoint: 'ws://127.0.0.1:8787' } : {}),
          },
        };
      }
      if (command.type === 'host/pairing-set-enabled') {
        enabled = (command as { enabled: boolean }).enabled;
        return {
          type: 'response',
          command: command.type,
          success: true,
          data: {
            enabled,
            canManage: true,
            pairedDeviceCount: 0,
            hostInstanceId: 'host-1',
            advertisedEndpoint: 'ws://127.0.0.1:8787',
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
            uri: 'piwin://pair?endpoint=ws%3A%2F%2F127.0.0.1%3A8787&token=token-xyz',
            expiresAt: Date.now() + 600000,
            endpoint: 'ws://127.0.0.1:8787',
            hostInstanceId: 'host-1',
            protocolVersion: 1,
          },
        };
      }
      if (command.type === 'host/pairing-list-devices') {
        return {
          type: 'response',
          command: command.type,
          success: true,
          data: { devices: [] },
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

    const switchEl = container.querySelector('[data-testid="mobile-access-listen"]') as HTMLInputElement;
    expect(switchEl).not.toBeNull();
    expect(switchEl.checked).toBe(false);
    expect(switchEl.disabled).toBe(false);

    // Turn switch ON
    await act(async () => {
      switchEl.click();
    });

    expect(request).toHaveBeenCalledWith(expect.objectContaining({ type: 'host/pairing-set-enabled', enabled: true }));
    expect(container.querySelector('[data-testid="mobile-access-pairing"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="mobile-access-qr"]')).not.toBeNull();
    // A loopback-only Host cannot be dialled by a phone; say so instead of showing a dead QR silently.
    expect(container.textContent).toContain('only reachable from its own machine');
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
