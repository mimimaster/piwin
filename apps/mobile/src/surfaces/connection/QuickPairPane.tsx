import type { ReactElement } from 'react';
import { Spinner } from '@piwin/ui-kit';

export type QuickPairPaneProps = {
  isScanning: boolean;
  isConnecting: boolean;
  onScanQr: () => void;
  onPasteFromClipboard: () => void;
};

export function QuickPairPane({
  isScanning,
  isConnecting,
  onScanQr,
  onPasteFromClipboard,
}: QuickPairPaneProps): ReactElement {
  return (
    <div className="quick-pair-pane">
      <button
        type="button"
        className="hero-scan-btn"
        onClick={onScanQr}
        disabled={isConnecting || isScanning}
        data-testid="mobile-scan-qr-btn"
      >
        {isScanning ? (
          <>
            <Spinner />
            <span>正在开启相机…</span>
          </>
        ) : (
          <>
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
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
            <span>扫描屏幕二维码</span>
          </>
        )}
      </button>

      <button
        type="button"
        className="secondary-paste-btn"
        onClick={onPasteFromClipboard}
        disabled={isConnecting || isScanning}
        data-testid="mobile-paste-qr-btn"
      >
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
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
        <span>粘贴剪贴板中的配对码</span>
      </button>

      <div className="pair-guide-steps">
        <div className="pair-guide-title">
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
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
          <span>如何获取配对码？</span>
        </div>
        <ul className="pair-guide-list">
          <li className="pair-guide-item">
            <span className="step-badge highlight">1</span>
            <span>
              在电脑端打开 <strong>Piwin 设置 → 移动端连接</strong>（或在终端运行 <code>piwin serve</code>）。
            </span>
          </li>
          <li className="pair-guide-item">
            <span className="step-badge">2</span>
            <span>使用相机扫描屏幕上的二维码，即可完成配对。</span>
          </li>
        </ul>
      </div>
    </div>
  );
}
