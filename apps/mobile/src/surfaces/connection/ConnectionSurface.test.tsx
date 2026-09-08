// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { ConnectionSurface } from './ConnectionSurface.js';
import { MOBILE_THEME } from '../../mobile-theme.js';
import * as barcodePairing from '../../services/barcode-pairing.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

describe('ConnectionSurface', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
    vi.restoreAllMocks();
  });

  it('renders brand header, segmented tabs and quick pairing pane by default', () => {
    act(() => {
      root.render(
        <PiwinUiProvider manifest={MOBILE_THEME}>
          <ConnectionSurface
            endpoint="ws://192.168.1.50:8787"
            setEndpoint={vi.fn()}
            authToken=""
            setAuthToken={vi.fn()}
            pairingToken=""
            setPairingToken={vi.fn()}
            setExpectedHostInstanceId={vi.fn()}
            connectionState={{ kind: 'idle' }}
            credentialPersistError={false}
            isNativeVault={true}
            onRetryCredentialPersist={vi.fn()}
            onConnect={vi.fn()}
            onDisconnect={vi.fn()}
          />
        </PiwinUiProvider>,
      );
    });

    expect(container.textContent).toContain('连接 Piwin Host');
    expect(container.textContent).toContain('印');
    expect(container.textContent).toContain('扫码配对');
    expect(container.textContent).toContain('手动配置');
    expect(container.querySelector('[data-testid="mobile-scan-qr-btn"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="mobile-paste-qr-btn"]')).not.toBeNull();
    expect(container.textContent).toContain('如何获取配对码？');
    expect(container.textContent).toContain('钥匙串');
  });

  it('triggers QR scan and calls onConnect on success', async () => {
    const onConnect = vi.fn();
    const setEndpoint = vi.fn();
    const setPairingToken = vi.fn();
    const setExpectedHostInstanceId = vi.fn();

    vi.spyOn(barcodePairing, 'scanPairingQrCode').mockResolvedValue({
      endpoint: 'ws://192.168.1.88:8787',
      pairingToken: 'pair-token-xyz',
      hostInstanceId: 'inst-1',
    });

    act(() => {
      root.render(
        <PiwinUiProvider manifest={MOBILE_THEME}>
          <ConnectionSurface
            endpoint="ws://127.0.0.1:8787"
            setEndpoint={setEndpoint}
            authToken=""
            setAuthToken={vi.fn()}
            pairingToken=""
            setPairingToken={setPairingToken}
            setExpectedHostInstanceId={setExpectedHostInstanceId}
            connectionState={{ kind: 'idle' }}
            credentialPersistError={false}
            isNativeVault={true}
            onRetryCredentialPersist={vi.fn()}
            onConnect={onConnect}
            onDisconnect={vi.fn()}
          />
        </PiwinUiProvider>,
      );
    });

    const scanBtn = container.querySelector('[data-testid="mobile-scan-qr-btn"]') as HTMLButtonElement;
    await act(async () => {
      scanBtn.click();
    });

    expect(barcodePairing.scanPairingQrCode).toHaveBeenCalled();
    expect(setEndpoint).toHaveBeenCalledWith('ws://192.168.1.88:8787');
    expect(setPairingToken).toHaveBeenCalledWith('pair-token-xyz');
    expect(setExpectedHostInstanceId).toHaveBeenCalledWith('inst-1');
    expect(onConnect).toHaveBeenCalledWith({
      endpoint: 'ws://192.168.1.88:8787',
      authToken: '',
      pairingToken: 'pair-token-xyz',
      expectedHostInstanceId: 'inst-1',
    });
  });

  it('displays scan error when barcode scanner fails', async () => {
    vi.spyOn(barcodePairing, 'scanPairingQrCode').mockRejectedValue(new Error('相机权限被拒绝'));

    act(() => {
      root.render(
        <PiwinUiProvider manifest={MOBILE_THEME}>
          <ConnectionSurface
            endpoint="ws://127.0.0.1:8787"
            setEndpoint={vi.fn()}
            authToken=""
            setAuthToken={vi.fn()}
            pairingToken=""
            setPairingToken={vi.fn()}
            setExpectedHostInstanceId={vi.fn()}
            connectionState={{ kind: 'idle' }}
            credentialPersistError={false}
            isNativeVault={true}
            onRetryCredentialPersist={vi.fn()}
            onConnect={vi.fn()}
            onDisconnect={vi.fn()}
          />
        </PiwinUiProvider>,
      );
    });

    const scanBtn = container.querySelector('[data-testid="mobile-scan-qr-btn"]') as HTMLButtonElement;
    await act(async () => {
      scanBtn.click();
    });

    expect(container.textContent).toContain('扫码提示');
    expect(container.textContent).toContain('相机权限被拒绝');
  });

  it('switches to manual config mode and shows manual form fields', () => {
    const onConnect = vi.fn();
    const setEndpoint = vi.fn();

    act(() => {
      root.render(
        <PiwinUiProvider manifest={MOBILE_THEME}>
          <ConnectionSurface
            endpoint="ws://127.0.0.1:8787"
            setEndpoint={setEndpoint}
            authToken=""
            setAuthToken={vi.fn()}
            pairingToken=""
            setPairingToken={vi.fn()}
            setExpectedHostInstanceId={vi.fn()}
            connectionState={{ kind: 'idle' }}
            credentialPersistError={false}
            isNativeVault={true}
            onRetryCredentialPersist={vi.fn()}
            onConnect={onConnect}
            onDisconnect={vi.fn()}
          />
        </PiwinUiProvider>,
      );
    });

    const tabs = container.querySelectorAll('.connection-segmented-nav button');
    act(() => {
      (tabs[1] as HTMLButtonElement).click();
    });

    expect(container.textContent).toContain('Host 服务地址');
    expect(container.textContent).toContain('配对码');

    const submitBtn = container.querySelector('[data-testid="mobile-connect-submit-btn"]') as HTMLButtonElement;
    act(() => {
      submitBtn.click();
    });
    expect(onConnect).toHaveBeenCalled();
  });

  it('toggles advanced settings for legacy auth token in manual mode', () => {
    act(() => {
      root.render(
        <PiwinUiProvider manifest={MOBILE_THEME}>
          <ConnectionSurface
            endpoint="ws://192.168.1.100:8787"
            setEndpoint={vi.fn()}
            authToken=""
            setAuthToken={vi.fn()}
            pairingToken=""
            setPairingToken={vi.fn()}
            setExpectedHostInstanceId={vi.fn()}
            connectionState={{ kind: 'idle' }}
            credentialPersistError={false}
            isNativeVault={true}
            onRetryCredentialPersist={vi.fn()}
            onConnect={vi.fn()}
            onDisconnect={vi.fn()}
          />
        </PiwinUiProvider>,
      );
    });

    const tabs = container.querySelectorAll('.connection-segmented-nav button');
    act(() => {
      (tabs[1] as HTMLButtonElement).click();
    });

    expect(container.querySelector('[data-testid="mobile-host-token"]')).toBeNull();
    const advancedToggle = container.querySelector('.advanced-toggle-btn') as HTMLButtonElement;
    act(() => {
      advancedToggle.click();
    });
    expect(container.querySelector('[data-testid="mobile-host-token"]')).not.toBeNull();
    expect(container.textContent).toContain('访问口令');
  });

  it('renders connected view with Cockpit and Disconnect buttons when ready', () => {
    const onDisconnect = vi.fn();
    const onBackToApp = vi.fn();

    act(() => {
      root.render(
        <PiwinUiProvider manifest={MOBILE_THEME}>
          <ConnectionSurface
            endpoint="ws://192.168.1.100:8787"
            setEndpoint={vi.fn()}
            authToken=""
            setAuthToken={vi.fn()}
            pairingToken=""
            setPairingToken={vi.fn()}
            setExpectedHostInstanceId={vi.fn()}
            connectionState={{ kind: 'ready' }}
            credentialPersistError={false}
            isNativeVault={true}
            onRetryCredentialPersist={vi.fn()}
            onConnect={vi.fn()}
            onDisconnect={onDisconnect}
            onBackToApp={onBackToApp}
          />
        </PiwinUiProvider>,
      );
    });

    expect(container.textContent).toContain('Host 已连接');
    expect(container.textContent).toContain('已安全连接');
    expect(container.textContent).toContain('ws://192.168.1.100:8787');

    const enterBtn = container.querySelector('[data-testid="mobile-enter-app-btn"]') as HTMLButtonElement;
    const disconnectBtn = container.querySelector('[data-testid="mobile-disconnect-btn"]') as HTMLButtonElement;

    act(() => {
      enterBtn.click();
    });
    expect(onBackToApp).toHaveBeenCalled();

    act(() => {
      disconnectBtn.click();
    });
    expect(onDisconnect).toHaveBeenCalled();
  });

  it('renders diagnostic error box with retry when error message is provided', () => {
    const onConnect = vi.fn();

    act(() => {
      root.render(
        <PiwinUiProvider manifest={MOBILE_THEME}>
          <ConnectionSurface
            endpoint="ws://127.0.0.1:8787"
            setEndpoint={vi.fn()}
            authToken=""
            setAuthToken={vi.fn()}
            pairingToken=""
            setPairingToken={vi.fn()}
            setExpectedHostInstanceId={vi.fn()}
            connectionState={{ kind: 'idle' }}
            errorMessage="无法连通 Host：请检查网络连接、Host 运行状态及端口设置。"
            credentialPersistError={false}
            isNativeVault={true}
            onRetryCredentialPersist={vi.fn()}
            onConnect={onConnect}
            onDisconnect={vi.fn()}
          />
        </PiwinUiProvider>,
      );
    });

    const errorBox = container.querySelector('[data-testid="mobile-host-error"]');
    expect(errorBox).not.toBeNull();
    expect(errorBox?.textContent).toContain('无法连接 Host');
    expect(errorBox?.textContent).toContain('无法连通 Host');
    expect(errorBox?.textContent).toContain('检查手机与 Host 的网络是否连通');

    const retryBtn = errorBox?.querySelector('.diagnostic-action-btn') as HTMLButtonElement;
    act(() => {
      retryBtn.click();
    });
    expect(onConnect).toHaveBeenCalled();
  });

  it('renders keychain warning when credential persist error is true', () => {
    const onRetryPersist = vi.fn();

    act(() => {
      root.render(
        <PiwinUiProvider manifest={MOBILE_THEME}>
          <ConnectionSurface
            endpoint="ws://192.168.1.100:8787"
            setEndpoint={vi.fn()}
            authToken=""
            setAuthToken={vi.fn()}
            pairingToken=""
            setPairingToken={vi.fn()}
            setExpectedHostInstanceId={vi.fn()}
            connectionState={{ kind: 'idle' }}
            credentialPersistError={true}
            isNativeVault={true}
            onRetryCredentialPersist={onRetryPersist}
            onConnect={vi.fn()}
            onDisconnect={vi.fn()}
          />
        </PiwinUiProvider>,
      );
    });

    expect(container.textContent).toContain('钥匙串存储提示');
    const retryBtn = container.querySelector('.diagnostic-box.warning .diagnostic-action-btn') as HTMLButtonElement;
    act(() => {
      retryBtn.click();
    });
    expect(onRetryPersist).toHaveBeenCalled();
  });
});
