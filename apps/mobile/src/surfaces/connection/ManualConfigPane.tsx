import { useState, type ReactElement } from 'react';
import { PasswordInput, Spinner, TextInput } from '@piwin/ui-kit';

export type ManualConfigPaneProps = {
  endpoint: string;
  setEndpoint: (value: string) => void;
  pairingToken: string;
  onPairingTokenChange: (value: string) => void;
  authToken: string;
  setAuthToken: (value: string) => void;
  setPairingToken: (value: string) => void;
  isConnected: boolean;
  isConnecting: boolean;
  isScanning: boolean;
  onConnect: () => void;
};

export function ManualConfigPane({
  endpoint,
  setEndpoint,
  pairingToken,
  onPairingTokenChange,
  authToken,
  setAuthToken,
  setPairingToken,
  isConnected,
  isConnecting,
  isScanning,
  onConnect,
}: ManualConfigPaneProps): ReactElement {
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <div className="manual-config-pane">
      {/* Endpoint Field */}
      <div className="form-field-group">
        <label className="form-field-label" htmlFor="host-endpoint-input">
          Host 服务地址
        </label>
        <TextInput
          id="host-endpoint-input"
          value={endpoint}
          onChange={(event) => setEndpoint(event.currentTarget.value)}
          placeholder="ws://192.168.1.100:8787"
          disabled={isConnected || isConnecting}
          testId="mobile-host-endpoint"
        />
      </div>

      {/* Pairing Token Field */}
      <div className="form-field-group">
        <label className="form-field-label" htmlFor="host-pairing-token-input">
          配对码
        </label>
        <PasswordInput
          id="host-pairing-token-input"
          value={pairingToken}
          onChange={(event) => onPairingTokenChange(event.currentTarget.value)}
          placeholder="输入或粘贴配对码"
          disabled={isConnected || isConnecting}
          testId="mobile-host-pairing-token"
        />
      </div>

      {/* Advanced Settings Toggle */}
      <button
        type="button"
        className="advanced-toggle-btn"
        onClick={() => setShowAdvanced(!showAdvanced)}
      >
        <span>{showAdvanced ? '收起高级选项' : '展开高级选项（访问口令）'}</span>
        <svg
          className="icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            transform: showAdvanced ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.2s ease',
          }}
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {showAdvanced ? (
        <div className="advanced-section">
          <div className="form-field-group">
            <label className="form-field-label" htmlFor="host-auth-token-input">
              访问口令
            </label>
            <PasswordInput
              id="host-auth-token-input"
              value={authToken}
              onChange={(event) => {
                setAuthToken(event.currentTarget.value);
                if (event.currentTarget.value.trim().length > 0) {
                  setPairingToken('');
                }
              }}
              placeholder="输入 PIWIN_HOST_TOKEN 口令"
              disabled={isConnected || isConnecting}
              testId="mobile-host-token"
            />
          </div>
        </div>
      ) : null}

      {/* Submit Button */}
      <button
        type="button"
        className="connect-submit-btn"
        onClick={onConnect}
        disabled={isConnecting || isScanning || endpoint.trim().length === 0}
        data-testid="mobile-connect-submit-btn"
      >
        {isConnecting ? (
          <>
            <Spinner />
            <span>正在连接…</span>
          </>
        ) : (
          <span>连接 Host</span>
        )}
      </button>
    </div>
  );
}
