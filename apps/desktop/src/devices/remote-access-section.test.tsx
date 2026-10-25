// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { HostCommand, HostResponse, LocalMobileAccessCommand } from '@piwin/contracts';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from '../theme/appearance-tokens.js';
import { DesktopLocaleProvider } from '../i18n/desktop-locale-context.js';
import { SettingsProvider, type SettingsContextValue } from '../settings/settings-context.js';
import { MobileAccessSettings } from './mobile-access-settings.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const REMOTE = {
  hostId: 'ZyXwVuTsRqPoNmLkJiHg-_',
  hostName: 'MacBook',
  user: { userId: 'AbCdEfGhIjKlMnOpQrSt_-', name: 'Yorick' },
  relay: { enabled: false, state: 'off' },
  direct: { enabled: true, url: 'ws://192.168.1.5:8790' },
  legacyAccess: 'full',
};

type Command = HostCommand | LocalMobileAccessCommand;

function sidecar(requested: Command[]) {
  return vi.fn(async (command: Command): Promise<HostResponse> => {
    requested.push(command);
    const ok = (data: unknown): HostResponse => ({
      type: 'response',
      command: command.type,
      success: true,
      data,
    });
    switch (command.type) {
      case 'mobile-access/status':
        return ok({
          listening: true,
          pairedDeviceCount: 1,
          enabled: true,
          advertisedEndpoint: 'ws://192.168.1.5:8790',
          remote: REMOTE,
        });
      case 'mobile-access/list-devices':
        return ok({
          devices: [
            { id: 'd1', name: 'Old phone', createdAt: 'a', lastSeenAt: 'b', revoked: false },
            {
              id: 'd2',
              name: 'Laptop',
              createdAt: 'a',
              lastSeenAt: 'b',
              revoked: false,
              role: 'operator',
              secureChannel: true,
            },
          ],
        });
      case 'mobile-access/create-pairing-code':
        return ok({
          endpoint: 'ws://192.168.1.5:8790',
          pairingToken: 't',
          hostInstanceId: 'h',
          protocolVersion: 1,
          expiresAt: Date.now() + 600_000,
          uri: 'piwin://pair?endpoint=legacy',
          channelUri: `piwin://pair?v=3&role=${(command as { role?: string }).role ?? 'member'}`,
        });
      case 'host/remote-access-configure':
        return ok({
          ...REMOTE,
          legacyAccess: (command as { legacyAccess?: string }).legacyAccess ?? 'full',
        });
      default:
        return ok({});
    }
  });
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let index = 0; index < 5; index += 1) await Promise.resolve();
  });
}

function type(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('remote access in phone-access settings (ADR 0101)', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    if (root && container) {
      act(() => root?.unmount());
      container.remove();
    }
  });

  async function render(requested: Command[]): Promise<HTMLDivElement> {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const contextValue = {
      hostClient: { getTransport: () => 'live', request: sidecar(requested) },
    } as unknown as SettingsContextValue;
    act(() => {
      root?.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <DesktopLocaleProvider locale="en" onLocaleChange={() => {}}>
            <SettingsProvider value={contextValue}>
              <MobileAccessSettings />
            </SettingsProvider>
          </DesktopLocaleProvider>
        </PiwinUiProvider>,
      );
    });
    await flush();
    return container;
  }

  it('shows the v3 link, the section and device notes', async () => {
    const view = await render([]);
    expect(view.querySelector('[data-testid="remote-access-section"]')).not.toBeNull();
    expect(
      (view.querySelector('[data-testid="mobile-access-pairing-uri"]') as HTMLInputElement).value,
    ).toBe('piwin://pair?v=3&role=member');
    expect(view.querySelector('[data-testid="mobile-access-device-d1"]')?.textContent).toContain(
      'older connection',
    );
    expect(view.querySelector('[data-testid="mobile-access-device-d2"]')?.textContent).toContain(
      'admin',
    );
    expect(
      view.querySelector('[data-testid="mobile-access-device-d2"]')?.textContent,
    ).not.toContain('older');
  });

  it('saves a relay address and changes the legacy mode', async () => {
    const requested: Command[] = [];
    const view = await render(requested);
    await act(async () => {
      type(
        view.querySelector('[data-testid="remote-access-relay-url"]') as HTMLInputElement,
        'wss://relay.example.com',
      );
    });
    await act(async () => {
      (view.querySelector('[data-testid="remote-access-relay-save"]') as HTMLButtonElement).click();
    });
    await flush();
    expect(requested).toContainEqual({
      type: 'host/remote-access-configure',
      relay: { enabled: true, url: 'wss://relay.example.com' },
    });

    const legacy = view.querySelector('[data-testid="remote-access-legacy"]') as HTMLSelectElement;
    await act(async () => {
      legacy.value = 'migrate-only';
      legacy.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush();
    expect(requested).toContainEqual({
      type: 'host/remote-access-configure',
      legacyAccess: 'migrate-only',
    });
  });

  it('mints an admin code into the pairing card with its note', async () => {
    const requested: Command[] = [];
    const view = await render(requested);
    await act(async () => {
      (
        view.querySelector('[data-testid="remote-access-operator-code"]') as HTMLButtonElement
      ).click();
    });
    await flush();
    expect(requested).toContainEqual({
      type: 'mobile-access/create-pairing-code',
      role: 'operator',
    });
    expect(
      (view.querySelector('[data-testid="mobile-access-pairing-uri"]') as HTMLInputElement).value,
    ).toContain('role=operator');
    expect(view.querySelector('[data-testid="mobile-access-pairing"]')?.textContent).toContain(
      'manage pairing',
    );
  });
});
