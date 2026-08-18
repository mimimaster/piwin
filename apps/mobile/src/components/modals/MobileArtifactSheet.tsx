import { useState, useRef, type ReactElement } from 'react';
import { IconClose } from '@piwin/ui-kit';

export type MobileArtifactSheetProps = {
  isOpen: boolean;
  onClose: () => void;
  title?: string | undefined;
  srcdoc?: string | undefined;
  blockedReason?: string | undefined;
};

export function MobileArtifactSheet({
  isOpen,
  onClose,
  title = '交互式 Web 产物预览',
  srcdoc,
  blockedReason,
}: MobileArtifactSheetProps): ReactElement | null {
  const [viewportMode, setViewportMode] = useState<'mobile' | 'full'>('full');
  const [refreshKey, setRefreshKey] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="mobile-drawer-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="mobile-artifact-sheet" onClick={(event) => event.stopPropagation()}>
        <div className="mobile-artifact-header">
          <div className="mobile-artifact-title-group">
            <span className="artifact-icon">📱</span>
            <div>
              <h3 className="mobile-artifact-title">{title}</h3>
              <p className="mobile-artifact-subtitle">独立安全沙箱 (Sandboxed Iframe)</p>
            </div>
          </div>

          <div className="mobile-artifact-actions">
            <div className="artifact-viewport-toggle">
              <button
                type="button"
                className={`viewport-btn ${viewportMode === 'mobile' ? 'active' : ''}`}
                onClick={() => setViewportMode('mobile')}
                aria-label="手机视口"
              >
                📱
              </button>
              <button
                type="button"
                className={`viewport-btn ${viewportMode === 'full' ? 'active' : ''}`}
                onClick={() => setViewportMode('full')}
                aria-label="满屏自适应"
              >
                🖥️
              </button>
            </div>

            <button
              type="button"
              className="artifact-header-btn"
              onClick={() => setRefreshKey((key) => key + 1)}
              aria-label="重新加载"
            >
              🔄
            </button>

            <button
              type="button"
              className="mobile-drawer-close-btn"
              onClick={onClose}
              aria-label="关闭预览"
            >
              <IconClose size={18} />
            </button>
          </div>
        </div>

        <div className={`mobile-artifact-viewport-wrap ${viewportMode}`}>
          {blockedReason !== undefined || srcdoc === undefined ? (
            <p className="mobile-artifact-blocked">{blockedReason ?? '无法预览该产物。'}</p>
          ) : (
            <iframe
              key={refreshKey}
              ref={iframeRef}
              title={title}
              srcDoc={srcdoc}
              className="mobile-artifact-iframe"
              sandbox="allow-scripts"
              referrerPolicy="no-referrer"
            />
          )}
        </div>
      </div>
    </div>
  );
}
