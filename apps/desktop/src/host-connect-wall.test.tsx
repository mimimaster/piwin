// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { DesktopLocaleProvider } from './desktop-locale-context';
import { HostConnectWall } from './host-connect-wall';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const scanner = vi.hoisted(() => ({
  available: true,
  scan: vi.fn(),
  probe: vi.fn(),
  showError: vi.fn(),
}));

vi.mock('./pairing-code-scanner.js', () => ({
  canScanPairingCode: () => scanner.available,
  scanPairingCode: scanner.scan,
}));
vi.mock('./probe-desktop-remote-host.js', () => ({
  probeDesktopRemoteHost: scanner.probe,
}));
vi.mock('@piwin/ui-kit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@piwin/ui-kit')>()),
  showErrorNotification: scanner.showError,
}));

describe('HostConnectWall', () => {
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    localStorage.clear();
    vi.clearAllMocks();
    scanner.available = true;
  });

  function renderWall(): void {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        (
          <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
            <DesktopLocaleProvider locale="zh-CN" onLocaleChange={() => undefined}>
              <HostConnectWall onConnected={() => undefined} allowLocal={false} />
            </DesktopLocaleProvider>
          </PiwinUiProvider>
        ) as ReactElement,
      );
    });
  }

  function byTestId(testId: string): HTMLElement {
    const element = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
    if (element === null) {
      throw new Error(`missing ${testId}`);
    }
    return element;
  }

  it('folds the address form behind a toggle where a scanner exists', () => {
    renderWall();
    const toggle = byTestId('host-gate-manual-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    act(() => toggle.click());
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('shows the address form directly when there is no scanner', () => {
    scanner.available = false;
    renderWall();
    expect(document.querySelector('[data-testid="host-gate-manual-toggle"]')).toBeNull();
    expect(document.querySelector('[data-testid="host-gate-scan"]')).toBeNull();
    byTestId('host-gate-endpoint');
  });

  it('reports a failed scan as a toast and releases the buttons', async () => {
    scanner.scan.mockResolvedValue({ endpoint: 'ws://192.168.1.20:8790', pairingToken: 'pair' });
    scanner.probe.mockRejectedValue(new Error('boom'));
    renderWall();
    await act(async () => {
      byTestId('host-gate-scan').click();
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(scanner.showError).toHaveBeenCalledWith('连接 Host 失败：boom'));
    await vi.waitFor(() =>
      expect((byTestId('host-gate-scan') as HTMLButtonElement).disabled).toBe(false),
    );
    expect(document.querySelector('[data-testid="host-gate-error"]')).toBeNull();
  });

  it('localizes a classified Host refusal instead of showing its English message', async () => {
    scanner.scan.mockResolvedValue({ endpoint: 'ws://192.168.1.20:8790', pairingToken: 'pair' });
    scanner.probe.mockResolvedValue({
      ok: false,
      error: 'Host rejected the connection (4004): Pairing token is invalid or expired',
      reason: 'pairing-token-invalid',
    });
    renderWall();
    await act(async () => {
      byTestId('host-gate-scan').click();
      await Promise.resolve();
    });
    await vi.waitFor(() =>
      expect(scanner.showError).toHaveBeenCalledWith(
        '配对码已过期或已被使用，请在电脑端重新生成二维码。',
      ),
    );
  });
});
