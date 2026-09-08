import type { ReactElement } from 'react';

export type ConnectedPaneProps = {
  endpoint: string;
  isNativeVault: boolean;
  onBackToApp?: (() => void) | undefined;
  onDisconnect: () => void;
};

export function ConnectedPane({
  endpoint,
  isNativeVault,
  onBackToApp,
  onDisconnect,
}: ConnectedPaneProps): ReactElement {
  return (
    <div className="connected-pane">
      <div className="connected-status-pill">
        <span className="dot done" aria-hidden="true" />
        <span>已安全连接</span>
      </div>

      <div className="connected-host-details">
        <div className="connected-host-row">
          <span className="connected-host-label">Host 地址</span>
          <span className="connected-host-val" title={endpoint}>
            {endpoint}
          </span>
        </div>
        <div className="connected-host-row">
          <span className="connected-host-label">凭据保管</span>
          <span className="connected-host-val">
            {isNativeVault ? 'iOS 安全钥匙串' : '临时内存'}
          </span>
        </div>
      </div>

      <div className="connected-actions">
        {onBackToApp !== undefined ? (
          <button
            type="button"
            className="enter-app-btn"
            onClick={onBackToApp}
            data-testid="mobile-enter-app-btn"
          >
            进入工作台
          </button>
        ) : null}
        <button
          type="button"
          className="disconnect-btn"
          onClick={onDisconnect}
          data-testid="mobile-disconnect-btn"
        >
          断开连接
        </button>
      </div>
    </div>
  );
}
