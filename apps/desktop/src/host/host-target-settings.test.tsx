// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from '../theme/appearance-tokens';
import { DesktopLocaleProvider } from '../i18n/desktop-locale-context';
import { HostTargetSettings } from './host-target-settings';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const fakes = vi.hoisted(() => ({
  scannerAvailable: true,
  scan: vi.fn(),
  pair: vi.fn(),
}));

vi.mock('./pairing-code-scanner.js', () => ({
  canScanPairingCode: () => fakes.scannerAvailable,
  scanPairingCode: fakes.scan,
}));
vi.mock('./channel-host-book.js', () => ({
  canPairOverChannel: () => true,
  pairWorkbenchChannelHost: fakes.pair,
  channelHostDisplayEndpoint: (entry: { relayUrl?: string }) => entry.relayUrl ?? '',
  channelHostBook: () => ({ list: async () => [] }),
  channelVault: () => ({ clear: async () => undefined }),
}));
vi.mock('../settings/settings-context.js', () => ({
  useSettings: () => ({ hostClient: undefined }),
}));

const LINK = { v: 3, relayUrl: 'wss://relay.example.com:8443', pairingToken: 'token' };

describe('HostTargetSettings', () => {
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    localStorage.clear();
    vi.clearAllMocks();
    fakes.scannerAvailable = true;
  });

  function renderSettings(): void {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        (
          <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
            <DesktopLocaleProvider locale="zh-CN" onLocaleChange={() => undefined}>
              <HostTargetSettings />
            </DesktopLocaleProvider>
          </PiwinUiProvider>
        ) as ReactElement,
      );
    });
  }

  function queryTestId(testId: string): HTMLElement | null {
    return document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  }

  it('lets the phone scan the computer QR code, which carries the relay address', async () => {
    fakes.scan.mockResolvedValue({ kind: 'channel', link: LINK });
    fakes.pair.mockResolvedValue({ hostId: 'host-1', relayUrl: LINK.relayUrl });
    renderSettings();
    expect(container?.textContent).toContain('在电脑上打开配对二维码');
    const scan = queryTestId('host-target-scan');
    expect(scan).not.toBeNull();
    await act(async () => {
      scan?.click();
      await Promise.resolve();
    });
    await vi.waitFor(() =>
      expect(fakes.pair).toHaveBeenCalledWith(expect.objectContaining({ link: LINK })),
    );
    expect(queryTestId('host-target-error')).toBeNull();
  });

  it('keeps the paste-link step without a camera', async () => {
    fakes.scannerAvailable = false;
    renderSettings();
    // Let the paired-host list settle its async load.
    await act(async () => {
      await Promise.resolve();
    });
    expect(queryTestId('host-target-scan')).toBeNull();
    expect(queryTestId('host-target-pair-link')).not.toBeNull();
    expect(container?.textContent).toContain('粘贴配对链接');
  });

  it('shows an empty scan as an inline error', async () => {
    fakes.scan.mockResolvedValue(undefined);
    renderSettings();
    await act(async () => {
      queryTestId('host-target-scan')?.click();
      await Promise.resolve();
    });
    await vi.waitFor(() =>
      expect(queryTestId('host-target-error')?.textContent).toContain('没有识别到二维码'),
    );
  });
});
