import type { ReactElement } from 'react';
import type {
  ArtifactActionMessage,
  ArtifactRenderPlan,
  ArtifactThemeVariables,
} from '@piwin/artifact';
import { IconButton, IconCode } from '@piwin/ui-kit';
import { ArtifactFrame } from './ArtifactFrame.js';

export type ArtifactInlinePreviewProps = {
  plan: Extract<ArtifactRenderPlan, { kind: 'render' }>;
  fenceId: string;
  initPriority: number;
  artifactThemeKey?: string;
  artifactTheme?: ArtifactThemeVariables;
  onArtifactAction?: (action: ArtifactActionMessage) => void;
  locale: 'zh-CN' | 'en';
  onShowSource: () => void;
};

/**
 * Mount a materialized Inline plan (static Shadow DOM or sandbox iframe).
 * Source inspection is an overlay action; copy/export stay on original source.
 */
export function ArtifactInlinePreview(props: ArtifactInlinePreviewProps): ReactElement {
  return (
    <>
      <div className="artifact-preview-surface">
        <ArtifactFrame
          key={`${props.artifactThemeKey ?? 'default'}:${props.fenceId}`}
          plan={props.plan}
          initPriority={props.initPriority}
          locale={props.locale}
          {...(props.artifactTheme ? { theme: props.artifactTheme } : {})}
          {...(props.onArtifactAction ? { onArtifactAction: props.onArtifactAction } : {})}
        />
      </div>
      <div className="artifact-floating-actions">
        <IconButton
          label="Show code"
          title="Show code"
          className="artifact-floating-action-button"
          data-testid="artifact-preview-toggle"
          aria-expanded
          onClick={props.onShowSource}
        >
          <IconCode size={14} />
        </IconButton>
      </div>
    </>
  );
}
