import { useState, type ReactElement } from 'react';
import { IconClose, IconRefresh } from '@piwin/ui-kit';
import { MobileLayer } from '../../mobile-portal.js';

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
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <MobileLayer isOpen={isOpen} onClose={onClose}>
      <div className="mobile-artifact-sheet" onClick={(event) => event.stopPropagation()}>
        <div className="mobile-artifact-header">
          <div className="mobile-artifact-title-group">
            <div>
              <h3 className="mobile-artifact-title">{title}</h3>
              <p className="mobile-artifact-subtitle">沙箱预览 · 默认拦截外连</p>
            </div>
          </div>

          <div className="mobile-artifact-actions">
            <button
              type="button"
              className="artifact-header-btn"
              onClick={() => setRefreshKey((key) => key + 1)}
              aria-label="重新加载"
            >
              <IconRefresh size={16} />
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

        <div className="mobile-artifact-viewport-wrap full">
          {blockedReason !== undefined || srcdoc === undefined ? (
            <p className="mobile-artifact-blocked">{blockedReason ?? '无法预览该产物。'}</p>
          ) : (
            <iframe
              key={refreshKey}
              title={title}
              srcDoc={srcdoc}
              className="mobile-artifact-iframe"
              sandbox="allow-scripts"
              referrerPolicy="no-referrer"
            />
          )}
        </div>
      </div>
    </MobileLayer>
  );
}
