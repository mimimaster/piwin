// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { encodeBase64Url, encodePairingLinkV3, encodePairingWebLink } from '@piwin/host-transport';
import { PIWIN_APPEARANCE_DARK } from '../theme/appearance-tokens';
import { DesktopLocaleProvider } from '../i18n/desktop-locale-context';
import { HostConnectWall } from './host-connect-wall';
import {
  createDesktopRemoteHostClient,
  loadDesktopRemoteHostTarget,
  saveDesktopRemoteHostTarget,
} from './remote-host-session';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const fakes = vi.hoisted(() => ({
  canPair: true,
  scan: vi.fn(),
  pair: vi.fn(),
  showError: vi.fn(),
  paired: [] as unknown[],
}));

vi.mock('./pairing-code-scanner.js', () => ({
  canScanPairingCode: () => true,
  scanPairingCode: fakes.scan,
}));
vi.mock('./channel-host-book.js', () => ({
  canPairOverChannel: () => fakes.canPair,
  pairWorkbenchChannelHost: fakes.pair,
  channelHostDisplayEndpoint: (entry: { relayUrl?: string; directUrl?: string }) =>
    entry.relayUrl ?? entry.directUrl ?? '',
  peekChannelHost: () => undefined,
  channelHostBook: () => ({ list: async () => fakes.paired }),
  channelVault: () => ({ clear: async () => undefined }),
  primeChannelHost: async () => true,
}));
vi.mock('@piwin/ui-kit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@piwin/ui-kit')>()),
  showErrorNotification: fakes.showError,
}));

const LINK = {
  v: 3 as const,
  userId: 'AbCdEfGhIjKlMnOpQrSt_-',
  userName: 'Yorick',
  hostId: 'ZyXwVuTsRqPoNmLkJiHg-_',
  hostName: 'MacBook',
  hostKey: encodeBase64Url(new Uint8Array(32).fill(5)),
  relayUrl: 'wss://relay.example.com',
  pairingToken: 'token',
  role: 'member' as const,
  expiresAt: Date.now() + 600_000,
};

describe('HostConnectWall over the ADR 0101 channel', () => {
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    localStorage.clear();
    vi.clearAllMocks();
    fakes.canPair = true;
    fakes.paired = [];
  });

  function renderWall(onConnected = vi.fn()): typeof onConnected {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        (
          <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
            <DesktopLocaleProvider locale="en" onLocaleChange={() => undefined}>
              <HostConnectWall onConnected={onConnected} allowLocal={false} />
            </DesktopLocaleProvider>
          </PiwinUiProvider>
        ) as ReactElement,
      );
    });
    return onConnected;
  }

  async function settle(): Promise<void> {
    await act(async () => {
      for (let index = 0; index < 5; index += 1) await Promise.resolve();
    });
  }

  it('pairs from a scanned v3 code and connects with the host id', async () => {
    fakes.scan.mockResolvedValue({ kind: 'channel', link: LINK });
    fakes.pair.mockResolvedValue({ ...LINK, pairedAt: 'now' });
    const onConnected = renderWall();
    await act(async () => {
      (container?.querySelector('[data-testid="host-gate-scan"]') as HTMLButtonElement).click();
    });
    await settle();
    expect(fakes.pair).toHaveBeenCalledWith(expect.objectContaining({ link: LINK }));
    expect(onConnected).toHaveBeenCalledWith({
      endpoint: 'wss://relay.example.com',
      hostId: LINK.hostId,
    });
  });

  it('pairs from a pasted link and hides the field where secrets cannot be stored', async () => {
    fakes.pair.mockResolvedValue({ ...LINK, pairedAt: 'now' });
    renderWall();
    await act(async () => {
      (
        container?.querySelector('[data-testid="host-gate-manual-toggle"]') as HTMLButtonElement
      ).click();
    });
    const input = container?.querySelector(
      '[data-testid="host-gate-pair-link"]',
    ) as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, encodePairingLinkV3(LINK));
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      (
        container?.querySelector('[data-testid="host-gate-pair-link-submit"]') as HTMLButtonElement
      ).click();
    });
    await settle();
    expect(fakes.pair).toHaveBeenCalledTimes(1);

    act(() => root?.unmount());
    container?.remove();
    fakes.canPair = false;
    renderWall();
    expect(container?.querySelector('[data-testid="host-gate-pair-link"]')).toBeNull();
  });

  it('lists paired Hosts and connects to one by host id', async () => {
    fakes.paired = [{ ...LINK, pairedAt: 'now' }];
    const onConnected = renderWall();
    await settle();
    const row = container?.querySelector(`[data-testid="paired-host-${LINK.hostId}"]`);
    expect(row?.textContent).toContain('MacBook');
    expect(row?.textContent).toContain('relay');
    await act(async () => {
      (
        container?.querySelector(
          `[data-testid="paired-host-connect-${LINK.hostId}"]`,
        ) as HTMLButtonElement
      ).click();
    });
    await settle();
    expect(onConnected).toHaveBeenCalledWith({
      endpoint: 'wss://relay.example.com',
      hostId: LINK.hostId,
    });
  });

  it('pairs once from a #pair= browser link and clears it from the address bar', async () => {
    fakes.pair.mockResolvedValue({ ...LINK, pairedAt: 'now' });
    const web = encodePairingWebLink('wss://relay.example.com', LINK);
    window.history.replaceState(null, '', `/${web.slice(web.indexOf('#'))}`);
    renderWall();
    await settle();
    expect(fakes.pair).toHaveBeenCalledWith(expect.objectContaining({ link: LINK }));
    expect(window.location.hash).toBe('');
  });
});

describe('desktop remote host target with a host id', () => {
  afterEach(() => localStorage.clear());

  it('keeps the host id through save and load', () => {
    saveDesktopRemoteHostTarget({ endpoint: 'wss://relay.example.com', hostId: LINK.hostId });
    expect(loadDesktopRemoteHostTarget()).toEqual({
      endpoint: 'wss://relay.example.com',
      hostId: LINK.hostId,
    });
  });

  it('refuses to build a client for a channel Host that is not primed', () => {
    expect(() =>
      createDesktopRemoteHostClient({ endpoint: 'wss://relay.example.com', hostId: LINK.hostId }),
    ).toThrow('pair it again');
  });
});
