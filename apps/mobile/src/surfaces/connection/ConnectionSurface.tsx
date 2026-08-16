import { useState, type ReactElement } from 'react';
import type { HostClientState } from '@piwin/host-client';
import { Button, EmptyState, Notice, PasswordInput, TextInput } from '@piwin/ui-kit';
import { scanPairingQrCode } from '../../services/barcode-pairing.js';

export type ConnectionSurfaceProps = {
  endpoint: string;
  setEndpoint: (value: string) => void;
  authToken: string;
  setAuthToken: (value: string) => void;
  connectionState: HostClientState;
  errorMessage?: string | undefined;
  onConnect: () => void;
  onDisconnect: () => void;
  onBackToApp?: (() => void) | undefined;
};

export function ConnectionSurface({
  endpoint,
  setEndpoint,
  authToken,
  setAuthToken,
  connectionState,
  errorMessage,
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
      if (parsed.token !== undefined) {
        setAuthToken(parsed.token);
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
                  断开连接
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
            label="Host Token（可选）"
            value={authToken}
            onChange={(event) => setAuthToken(event.currentTarget.value)}
            placeholder="仅当 Host 开启认证时填写"
            disabled={isConnected}
            testId="mobile-host-token"
          />
          <p className="mobile-empty-detail">
            支持局域网、Tailscale 直连与扫码快速配对；凭据在本地安全存储。
          </p>
        </div>
      </EmptyState>

      {scanError !== undefined ? (
        <Notice tone="warning" title="扫码提示">
          {scanError}
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
