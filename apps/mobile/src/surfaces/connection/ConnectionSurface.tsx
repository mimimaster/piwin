import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { HostClientState } from '@piwin/host-client';
import {
  parsePairingString,
  scanPairingQrCode,
  type ParsedPairingData,
} from '../../services/barcode-pairing.js';
import type { MobileHostConnectionInput } from '../../mobile-host-connection.js';
import { ConnectionHeader } from './ConnectionHeader.js';
import { QuickPairPane } from './QuickPairPane.js';
import { ManualConfigPane } from './ManualConfigPane.js';
import { ConnectedPane } from './ConnectedPane.js';
import { DiagnosticBanners } from './DiagnosticBanners.js';

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
  onConnect: (input?: MobileHostConnectionInput) => void;
  onDisconnect: () => void;
  onBackToApp?: (() => void) | undefined;
};

type ActiveMode = 'quick' | 'manual';

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
  const [activeMode, setActiveMode] = useState<ActiveMode>('quick');
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | undefined>();
  const [pasteFeedback, setPasteFeedback] = useState<string | undefined>();
  const surfaceRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.scrollTo(0, 0);
    if (surfaceRef.current) {
      surfaceRef.current.scrollTop = 0;
    }
  }, []);

  const isConnected = connectionState.kind === 'ready';
  const isConnecting = connectionState.kind === 'connecting';

  const applyPairingData = (parsed: ParsedPairingData): MobileHostConnectionInput => {
    const input: MobileHostConnectionInput = {
      endpoint: parsed.endpoint,
      authToken: parsed.authToken ?? '',
      pairingToken: parsed.pairingToken ?? '',
      ...(parsed.hostInstanceId === undefined
        ? {}
        : { expectedHostInstanceId: parsed.hostInstanceId }),
    };
    setEndpoint(input.endpoint);
    setAuthToken(input.authToken);
    setPairingToken(input.pairingToken);
    setExpectedHostInstanceId(parsed.hostInstanceId);
    return input;
  };

  const handleScanQr = async () => {
    setIsScanning(true);
    setScanError(undefined);
    setPasteFeedback(undefined);
    try {
      const parsed = await scanPairingQrCode();
      onConnect(applyPairingData(parsed));
    } catch (err) {
      setScanError(err instanceof Error ? err.message : '相机扫码失败。');
    } finally {
      setIsScanning(false);
    }
  };

  const handlePasteFromClipboard = async () => {
    setScanError(undefined);
    setPasteFeedback(undefined);
    try {
      if (typeof navigator === 'undefined' || !navigator.clipboard?.readText) {
        throw new Error('当前环境不支持直接读取剪贴板，请手动粘贴。');
      }
      const text = (await navigator.clipboard.readText()).trim();
      if (!text) {
        setPasteFeedback('剪贴板为空，请先在电脑端复制配对码。');
        return;
      }
      try {
        const parsed = parsePairingString(text);
        onConnect(applyPairingData(parsed));
      } catch {
        if (text.length > 8 && !text.includes(' ') && !text.includes('\n')) {
          setPairingToken(text);
          setAuthToken('');
          setActiveMode('manual');
          setPasteFeedback('已填入配对码，请确认 Host 地址后点击连接。');
        } else {
          setPasteFeedback('剪贴板中未识别到有效配对码。');
        }
      }
    } catch (err) {
      setPasteFeedback(err instanceof Error ? err.message : '读取剪贴板失败。');
    }
  };

  const handlePairingTokenChange = (value: string): void => {
    const trimmed = value.trim();
    const looksLikePairingPayload =
      trimmed.startsWith('{') ||
      trimmed.startsWith('piwin://') ||
      trimmed.startsWith('http://') ||
      trimmed.startsWith('https://') ||
      trimmed.startsWith('ws://') ||
      trimmed.startsWith('wss://');
    if (looksLikePairingPayload) {
      try {
        applyPairingData(parsePairingString(value));
        return;
      } catch {
        // Keep the pasted value visible so the user can correct it or retry.
      }
    }
    setPairingToken(value);
    if (trimmed.length > 0) {
      setAuthToken('');
    }
  };

  return (
    <div ref={surfaceRef} className="mobile-surface-container connection-surface">
      <div className="connection-surface-inner">
        {/* Brand Header */}
        <ConnectionHeader isConnected={isConnected} />

        {/* Connected Card */}
        {isConnected ? (
          <div className="connection-card">
            <ConnectedPane
              endpoint={endpoint}
              isNativeVault={isNativeVault}
              onBackToApp={onBackToApp}
              onDisconnect={onDisconnect}
            />
          </div>
        ) : (
          <>
            {/* Mode Switcher */}
            <div
              className="connection-segmented-nav"
              role="tablist"
              aria-label="连接方式"
            >
              <button
                type="button"
                role="tab"
                aria-selected={activeMode === 'quick'}
                className={activeMode === 'quick' ? 'active' : ''}
                onClick={() => setActiveMode('quick')}
                data-testid="mobile-tab-quick"
              >
                扫码配对
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeMode === 'manual'}
                className={activeMode === 'manual' ? 'active' : ''}
                onClick={() => setActiveMode('manual')}
                data-testid="mobile-tab-manual"
              >
                手动配置
              </button>
            </div>

            {/* Main Inset Card */}
            <div className="connection-card">
              {activeMode === 'quick' ? (
                <QuickPairPane
                  isScanning={isScanning}
                  isConnecting={isConnecting}
                  onScanQr={() => void handleScanQr()}
                  onPasteFromClipboard={() => void handlePasteFromClipboard()}
                />
              ) : (
                <ManualConfigPane
                  endpoint={endpoint}
                  setEndpoint={setEndpoint}
                  pairingToken={pairingToken}
                  onPairingTokenChange={handlePairingTokenChange}
                  authToken={authToken}
                  setAuthToken={setAuthToken}
                  setPairingToken={setPairingToken}
                  isConnected={isConnected}
                  isConnecting={isConnecting}
                  isScanning={isScanning}
                  onConnect={() => onConnect()}
                />
              )}
            </div>
          </>
        )}

        {/* Diagnostic & Error Banners */}
        <DiagnosticBanners
          pasteFeedback={pasteFeedback}
          onDismissPasteFeedback={() => setPasteFeedback(undefined)}
          scanError={scanError}
          onDismissScanError={() => setScanError(undefined)}
          credentialPersistError={credentialPersistError}
          onRetryCredentialPersist={onRetryCredentialPersist}
          errorMessage={errorMessage}
          isConnecting={isConnecting}
          onRetryConnect={() => onConnect()}
        />

        {/* Security / Device Storage Footer */}
        <footer className="connection-security-note">
          <svg
            className="icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <span>
            {isNativeVault
              ? '凭据加密保存在本机钥匙串；断开仅清除本地授权。'
              : '网页预览环境下凭据仅驻留内存，刷新需重新配对。'}
          </span>
        </footer>
      </div>
    </div>
  );
}
