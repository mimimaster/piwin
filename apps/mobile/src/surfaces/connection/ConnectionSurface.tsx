import { useState, type ReactElement } from 'react';
import type { HostClientState } from '@piwin/host-client';
import { Button, EmptyState, Notice, PasswordInput, TextInput } from '@piwin/ui-kit';
import { scanPairingQrCode } from '../../services/barcode-pairing.js';

export type ConnectionSurfaceProps = {
  endpoint: string;
  setEndpoint: (value: string) => void;
  authToken: string;
  setAuthToken: (value: string) => void;
  pairingToken: string;
  setPairingToken: (value: string) => void;
  setExpectedHostInstanceId: (value: string | undefined) => void;
  connectionState: HostClientState;
  errorMessage?: string | undefined;
  credentialPersistError: boolean;
  isNativeVault: boolean;
  onRetryCredentialPersist: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onBackToApp?: (() => void) | undefined;
};

export function ConnectionSurface({
  endpoint,
  setEndpoint,
  authToken,
  setAuthToken,
  pairingToken,
  setPairingToken,
  setExpectedHostInstanceId,
  connectionState,
  errorMessage,
  credentialPersistError,
  isNativeVault,
  onRetryCredentialPersist,
  onConnect,
  onDisconnect,
  onBackToApp,
}: ConnectionSurfaceProps): ReactElement {
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | undefined>();

  const isConnected = connectionState.kind === 'ready';
  const isConnecting = connectionState.kind === 'connecting';

  const handleScanQr = async () => {
    setIsScanning(true);
    setScanError(undefined);
    try {
      const parsed = await scanPairingQrCode();
      setEndpoint(parsed.endpoint);
      setExpectedHostInstanceId(parsed.hostInstanceId);
      if (parsed.pairingToken !== undefined) {
        setPairingToken(parsed.pairingToken);
        setAuthToken('');
      } else if (parsed.authToken !== undefined) {
        setAuthToken(parsed.authToken);
        setPairingToken('');
      }
      setTimeout(() => {
        onConnect();
      }, 50);
    } catch (err) {
      setScanError(err instanceof Error ? err.message : '相机扫码失败。');
    } finally {
      setIsScanning(false);
    }
  };

  return (
    <div className="mobile-surface-container connection-surface">
      <EmptyState
        title={isConnected ? 'Host 已连接' : '连接你的 Piwin Host'}
        description="手机只负责观察和控制，Node、Pi、MCP、Skill 以及项目文件都留在 Host 上。"
        action={
          <div className="connection-actions">
            {isConnected ? (
              <>
                <Button variant="secondary" onClick={onDisconnect}>
                  退出此设备
                </Button>
                {onBackToApp !== undefined ? (
                  <Button variant="primary" onClick={onBackToApp}>
                    进入 Cockpit
                  </Button>
                ) : null}
              </>
            ) : (
              <>
                <Button
                  variant="primary"
                  onClick={onConnect}
                  disabled={isConnecting || isScanning}
                >
                  {isConnecting ? '连接中…' : '连接 Host'}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => void handleScanQr()}
                  disabled={isConnecting || isScanning}
                >
                  {isScanning ? '正在扫码…' : '📷 扫码配对'}
                </Button>
              </>
            )}
          </div>
        }
      >
        <div className="mobile-connection-form">
          <TextInput
            label="Host WebSocket 地址"
            value={endpoint}
            onChange={(event) => setEndpoint(event.currentTarget.value)}
            placeholder="ws://127.0.0.1:8787"
            disabled={isConnected}
            testId="mobile-host-endpoint"
          />
          <PasswordInput
            label="配对令牌"
            value={pairingToken}
            onChange={(event) => {
              setPairingToken(event.currentTarget.value);
              if (event.currentTarget.value.trim().length > 0) {
                setAuthToken('');
              }
            }}
            placeholder="扫码或粘贴一次性 pairingToken"
            disabled={isConnected}
            testId="mobile-host-pairing-token"
          />
          <PasswordInput
            label="Host 口令"
            value={authToken}
            onChange={(event) => {
              setAuthToken(event.currentTarget.value);
              if (event.currentTarget.value.trim().length > 0) {
                setPairingToken('');
              }
            }}
            placeholder="开发/LAN 回退，不要当设备凭证保存"
            disabled={isConnected}
            testId="mobile-host-token"
          />
          <p className="mobile-empty-detail">
            {isNativeVault
              ? '配对成功后设备密钥写入本机 Keychain；退出此设备只清本地，不会在 Host 上吊销。'
              : '浏览器预览把设备密钥留在内存里，刷新后需要重新配对。'}
          </p>
        </div>
      </EmptyState>

      {scanError !== undefined ? (
        <Notice tone="warning" title="扫码提示">
          {scanError}
        </Notice>
      ) : null}

      {credentialPersistError ? (
        <Notice
          tone="warning"
          title="Keychain 写入失败"
          action={
            <Button variant="secondary" onClick={onRetryCredentialPersist}>
              重试保存
            </Button>
          }
        >
          已颁发的设备密钥仍在本次会话内存中。请重试写入，不要重新扫码。
        </Notice>
      ) : null}

      {errorMessage !== undefined ? (
        <Notice tone="error" title="Host 连接异常" testId="mobile-host-error">
          {errorMessage}
        </Notice>
      ) : null}
    </div>
  );
}
