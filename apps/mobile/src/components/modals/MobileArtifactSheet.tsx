import { useState, useRef, type ReactElement } from 'react';
import { IconClose } from '@piwin/ui-kit';

export type MobileArtifactSheetProps = {
  isOpen: boolean;
  onClose: () => void;
  title?: string | undefined;
  htmlContent: string;
};

export function MobileArtifactSheet({
  isOpen,
  onClose,
  title = '交互式 Web 产物预览',
  htmlContent,
}: MobileArtifactSheetProps): ReactElement | null {
  const [viewportMode, setViewportMode] = useState<'mobile' | 'full'>('full');
  const [refreshKey, setRefreshKey] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  if (!isOpen) {
    return null;
  }

  const handleRefresh = () => {
    setRefreshKey((k) => k + 1);
  };

  return (
    <div className="mobile-drawer-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="mobile-artifact-sheet" onClick={(e) => e.stopPropagation()}>
        {/* Sheet Top Bar */}
        <div className="mobile-artifact-header">
          <div className="mobile-artifact-title-group">
            <span className="artifact-icon">📱</span>
            <div>
              <h3 className="mobile-artifact-title">{title}</h3>
              <p className="mobile-artifact-subtitle">独立安全沙箱 (Sandboxed Iframe)</p>
            </div>
          </div>

          <div className="mobile-artifact-actions">
            {/* Viewport mode toggle */}
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

            {/* Refresh */}
            <button
              type="button"
              className="artifact-header-btn"
              onClick={handleRefresh}
              aria-label="重新加载"
            >
              🔄
            </button>

            {/* Close */}
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

        {/* Iframe Viewport Container */}
        <div className={`mobile-artifact-viewport-wrap ${viewportMode}`}>
          <iframe
            key={refreshKey}
            ref={iframeRef}
            title={title}
            srcDoc={htmlContent}
            className="mobile-artifact-iframe"
            sandbox="allow-scripts allow-forms allow-same-origin"
          />
        </div>
      </div>
    </div>
  );
}
