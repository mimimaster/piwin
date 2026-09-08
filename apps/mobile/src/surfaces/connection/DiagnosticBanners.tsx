import type { ReactElement } from 'react';

export type DiagnosticBannersProps = {
  pasteFeedback?: string | undefined;
  onDismissPasteFeedback: () => void;
  scanError?: string | undefined;
  onDismissScanError: () => void;
  credentialPersistError: boolean;
  onRetryCredentialPersist: () => void;
  errorMessage?: string | undefined;
  isConnecting: boolean;
  onRetryConnect: () => void;
};

export function DiagnosticBanners({
  pasteFeedback,
  onDismissPasteFeedback,
  scanError,
  onDismissScanError,
  credentialPersistError,
  onRetryCredentialPersist,
  errorMessage,
  isConnecting,
  onRetryConnect,
}: DiagnosticBannersProps): ReactElement {
  return (
    <>
      {pasteFeedback !== undefined ? (
        <div className="diagnostic-box warning" role="status">
          <div className="diagnostic-box-head warning">
            <span>剪贴板提示</span>
            <button
              type="button"
              className="diagnostic-action-btn"
              onClick={onDismissPasteFeedback}
            >
              关闭
            </button>
          </div>
          <div>{pasteFeedback}</div>
        </div>
      ) : null}

      {scanError !== undefined ? (
        <div className="diagnostic-box warning" role="alert">
          <div className="diagnostic-box-head warning">
            <span>扫码提示</span>
            <button
              type="button"
              className="diagnostic-action-btn"
              onClick={onDismissScanError}
            >
              关闭
            </button>
          </div>
          <div>{scanError}</div>
        </div>
      ) : null}

      {credentialPersistError ? (
        <div className="diagnostic-box warning" role="alert">
          <div className="diagnostic-box-head warning">
            <span>钥匙串存储提示</span>
            <button
              type="button"
              className="diagnostic-action-btn"
              onClick={onRetryCredentialPersist}
            >
              重试保存
            </button>
          </div>
          <div>配对已生效，但暂未写入系统钥匙串。可点击重试以便后续免密连接。</div>
        </div>
      ) : null}

      {errorMessage !== undefined ? (
        <div className="diagnostic-box error" role="alert" data-testid="mobile-host-error">
          <div className="diagnostic-box-head error">
            <span>无法连接 Host</span>
            <button
              type="button"
              className="diagnostic-action-btn"
              onClick={onRetryConnect}
              disabled={isConnecting}
            >
              重新连接
            </button>
          </div>
          <div>{errorMessage}</div>
          <ul className="diagnostic-tips-list">
            <li>检查手机与 Host 的网络是否连通（局域网、Tailscale 或公网）。</li>
            <li>确认 Host 服务处于运行状态（终端运行 <code>piwin serve</code>）。</li>
            <li>确认 8787 端口未被防火墙或安全组拦截。</li>
          </ul>
        </div>
      ) : null}
    </>
  );
}
