import type { ReactElement } from 'react';
import type {
  ArtifactActionMessage,
  ArtifactRenderPlan,
  ArtifactThemeVariables,
} from '@piwin/artifact';
import { IconButton, IconCode, IconDownload } from '@piwin/ui-kit';
import { ArtifactFrame } from './ArtifactFrame.js';
import { artifactDownloadLabel, downloadArtifactSource } from './artifact-source-export.js';

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
 * Overlay actions inspect source and export original model source — never srcdoc.
 */
export function ArtifactInlinePreview(props: ArtifactInlinePreviewProps): ReactElement {
  const descriptor = props.plan.intent.descriptor;
  const originalSource = descriptor.source;
  const exportKind = descriptor.type === 'svg' ? 'svg' : 'html';
  const canExportSource = originalSource.trim().length > 0;
  const downloadLabel = artifactDownloadLabel(props.locale, exportKind);

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
          label={downloadLabel}
          title={downloadLabel}
          className="artifact-floating-action-button"
          data-testid="artifact-download-source"
          disabled={!canExportSource}
            onClick={() => {
              if (!canExportSource) return;
              void downloadArtifactSource({
                source: originalSource,
                title: descriptor.title,
                kind: exportKind,
              });
            }}
        >
          <IconDownload size={14} />
        </IconButton>
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
