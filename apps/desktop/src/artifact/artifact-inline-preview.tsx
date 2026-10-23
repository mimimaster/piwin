import { useState, type ReactElement } from 'react';
import type {
  ArtifactActionMessage,
  ArtifactRenderPlan,
  ArtifactThemeVariables,
} from '@piwin/artifact';
import {
  DropdownMenu,
  DropdownMenuItem,
  IconButton,
  IconCanvas,
  IconCode,
  IconDownload,
  IconExpand,
} from '@piwin/ui-kit';
import { ArtifactFrame } from './ArtifactFrame.js';
import { artifactDownloadLabel, downloadArtifactSource } from './artifact-source-export.js';
import { ArtifactFullscreenOverlay } from './artifact-fullscreen-overlay.js';
import { artifactViewerCopy, resolveArtifactViewerKey } from './artifact-viewer-model.js';
import { isMobileTauriRuntime } from '../tool-cards/shell-runtime.js';
import { IconMore } from '../tool-cards/shell-icons.js';
import type { ArtifactStyleOverride } from './artifact-style-override.js';

export type ArtifactInlinePreviewProps = {
  plan: Extract<ArtifactRenderPlan, { kind: 'render' }>;
  fenceId: string;
  initPriority: number;
  artifactThemeKey?: string;
  artifactTheme?: ArtifactThemeVariables;
  onArtifactAction?: (action: ArtifactActionMessage) => void;
  locale: 'zh-CN' | 'en';
  onShowSource: () => void;
  /** Promote this fence to the Canvas surface; omitted when Canvas is unavailable. */
  onOpenCanvas?: () => void;
  mediaDataUrls?: ReadonlyMap<string, string>;
  /** "View with theme" for expressive artifacts. */
  styleOverride?: ArtifactStyleOverride;
};

/**
 * Mount a materialized Inline plan (static Shadow DOM or sandbox iframe).
 * The action row sits below the artifact, never over it: model-authored
 * headers favour the top-right corner. Canvas/fullscreen stay one click away;
 * download and source live in the overflow menu. Download exports original
 * model source — never srcdoc.
 */
export function ArtifactInlinePreview(props: ArtifactInlinePreviewProps): ReactElement {
  const descriptor = props.plan.intent.descriptor;
  const originalSource = descriptor.source;
  const exportKind = descriptor.type === 'svg' ? 'svg' : 'html';
  const canExportSource = originalSource.trim().length > 0;
  const downloadLabel = artifactDownloadLabel(props.locale, exportKind);
  const copy = artifactViewerCopy(props.locale);
  const [fullscreen, setFullscreen] = useState(false);
  // A growing stream has no final document to show bigger yet.
  const settled = props.plan.mode !== 'stream-preview';
  const onOpenCanvas = settled ? props.onOpenCanvas : undefined;

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
          {...(props.styleOverride ? { styleOverride: props.styleOverride } : {})}
        />
      </div>
      <div
        className="artifact-floating-actions"
        onKeyDown={(event) => {
          const action = resolveArtifactViewerKey(event.nativeEvent, { surface: 'inline', presets: false });
          if (action?.kind === 'open-canvas' && onOpenCanvas) {
            event.preventDefault();
            onOpenCanvas();
          }
        }}
      >
        {onOpenCanvas ? (
          <IconButton
            label={copy.openCanvas}
            title={`${copy.openCanvas} (⌘⇧O)`}
            className="artifact-floating-action-button"
            data-testid="artifact-open-canvas"
            onClick={onOpenCanvas}
          >
            <IconCanvas size={14} />
          </IconButton>
        ) : null}
        <IconButton
          label={copy.fullscreen}
          title={`${copy.fullscreen} — ${copy.remountNote}`}
          className="artifact-floating-action-button"
          data-testid="artifact-open-fullscreen"
          disabled={!settled}
          onClick={(event) => {
            event.currentTarget.focus();
            setFullscreen(true);
          }}
        >
          <IconExpand size={14} />
        </IconButton>
        <DropdownMenu
          align="end"
          label={copy.moreActions}
          trigger={
            <IconButton
              label={copy.moreActions}
              title={copy.moreActions}
              className="artifact-floating-action-button"
              data-testid="artifact-more-actions"
            >
              <IconMore size={14} />
            </IconButton>
          }
        >
          <DropdownMenuItem
            icon={<IconDownload size={14} />}
            testId="artifact-download-source"
            disabled={!canExportSource}
            onSelect={() => {
              void downloadArtifactSource({
                source: originalSource,
                title: descriptor.title,
                kind: exportKind,
              });
            }}
          >
            {downloadLabel}
          </DropdownMenuItem>
          <DropdownMenuItem
            icon={<IconCode size={14} />}
            testId="artifact-show-code"
            onSelect={props.onShowSource}
          >
            {copy.showCode}
          </DropdownMenuItem>
        </DropdownMenu>
      </div>
      {fullscreen ? (
        <ArtifactFullscreenOverlay
          intent={props.plan.intent}
          source={originalSource}
          locale={props.locale}
          presets={!isMobileTauriRuntime()}
          {...(props.artifactTheme ? { hostTheme: props.artifactTheme } : {})}
          {...(props.mediaDataUrls ? { mediaDataUrls: props.mediaDataUrls } : {})}
          onClose={() => setFullscreen(false)}
        />
      ) : null}
    </>
  );
}
