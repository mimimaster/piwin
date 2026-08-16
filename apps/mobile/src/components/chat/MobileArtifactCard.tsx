import type { ReactElement } from 'react';
import { IconSpark } from '@piwin/ui-kit';

export type MobileArtifactCardProps = {
  title?: string | undefined;
  language?: string | undefined;
  onOpenPreview: () => void;
};

export function MobileArtifactCard({
  title = '交互式 Web 产物',
  language = 'html',
  onOpenPreview,
}: MobileArtifactCardProps): ReactElement {
  return (
    <div className="mobile-artifact-card">
      <div className="artifact-card-left">
        <div className="artifact-card-icon-wrap">
          <IconSpark size={16} />
        </div>
        <div className="artifact-card-info">
          <span className="artifact-card-title">{title}</span>
          <span className="artifact-card-tag">{language.toUpperCase()} · 网页/组件产物</span>
        </div>
      </div>

      <button
        type="button"
        className="artifact-preview-btn"
        onClick={onOpenPreview}
        aria-label="打开交互式预览"
      >
        <span>📱 预览</span>
      </button>
    </div>
  );
}
