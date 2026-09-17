/**
 * Right-side Artifact Canvas shell.
 *
 * Renders the active Canvas target through `ArtifactFrame presentation="canvas"`
 * so the same sandbox/CSP/bridge path serves both Inline and Canvas surfaces
 * (ADR 0029). Shows an empty state when the Canvas tab is restored without a
 * target after a full reload — Canvas is message-backed and ephemeral, so no
 * stale source is ever rendered.
 *
 * Composer proposals (ADR 0029 §2.6) are stored here in trusted parent state
 * and require an explicit user click before the caller appends them to the
 * Composer. The iframe cannot replace the draft, send a prompt, or invoke any
 * other product capability.
 */

import { useMemo, useState, type ReactElement } from 'react';
import {
  materializeArtifact,
  type ArtifactThemeVariables,
  type ComposerProposeTextActionPayload,
} from '@piwin/artifact';
import { Button, IconButton, IconDownload } from '@piwin/ui-kit';
import { ArtifactFrame } from './ArtifactFrame';
import type { ArtifactCanvasTarget } from './artifact-canvas-model';
import { artifactDownloadLabel, downloadArtifactSource } from './artifact-source-export.js';
import { useDesktopLocale } from './desktop-locale-context';
import { useArtifactSessionMediaDataUrls } from './artifact-session-media.js';

export type ArtifactCanvasProposal = ComposerProposeTextActionPayload;

export type ArtifactCanvasPanelProps = {
  activeTarget: ArtifactCanvasTarget | null;
  /** Theme variables for the sandboxed document; remounts on key change. */
  artifactTheme?: ArtifactThemeVariables;
  /** Bumped on theme switch so ArtifactFrame remounts with new tokens. */
  artifactThemeKey?: string | number;
  /** Security byte cap forwarded when the stored intent is materialized. */
  artifactMaxBytes?: number;
  artifactBlockExternalScripts?: boolean;
  artifactBlockExternalResources?: boolean;
  /**
   * Insert the accepted proposal into the Composer. The caller appends using
   * `appendComposerProposal` and never auto-sends.
   */
  onInsertProposal?: (proposal: ArtifactCanvasProposal) => void;
  /** The surrounding header renders Download, so no button floats over the artwork. */
  hideFloatingDownload?: boolean;
};

export function ArtifactCanvasPanel(props: ArtifactCanvasPanelProps): ReactElement {
  const { activeTarget } = props;
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';
  const [pendingProposal, setPendingProposal] = useState<ArtifactCanvasProposal | null>(null);
  const mediaDataUrls = useArtifactSessionMediaDataUrls({
    source: activeTarget?.source ?? '',
    ...(activeTarget ? { originSessionId: activeTarget.sessionId } : {}),
  });

  const plan = useMemo(() => {
    if (!activeTarget) return null;
    return materializeArtifact(activeTarget.intent, {
      mode: activeTarget.streaming === true ? 'stream-preview' : 'interactive',
      source: activeTarget.source,
      presentation: 'canvas',
      mediaDataUrls,
      ...(props.artifactTheme ? { theme: props.artifactTheme } : {}),
    });
  }, [activeTarget, props.artifactTheme, mediaDataUrls]);

  function handleInsert(): void {
    if (pendingProposal && props.onInsertProposal) {
      props.onInsertProposal(pendingProposal);
      // Keep Canvas open after insertion; clear only the accepted proposal so
      // the user can continue inspecting or revise selections.
      setPendingProposal(null);
    }
  }

  function handleDismiss(): void {
    setPendingProposal(null);
  }

  const canExportSource = (activeTarget?.source.trim().length ?? 0) > 0;
  const exportKind = activeTarget?.type === 'svg' ? 'svg' : 'html';
  const downloadLabel = artifactDownloadLabel(locale, exportKind);

  function handleDownloadSource(): void {
    if (!activeTarget || !canExportSource) return;
    void downloadArtifactSource({
      source: activeTarget.source,
      title: activeTarget.title,
      kind: exportKind,
    });
  }

  if (!activeTarget) {
    return (
      <div className="artifact-canvas-panel" data-testid="artifact-canvas-panel">
        <div className="artifact-canvas-empty muted" data-testid="artifact-canvas-empty">
          {isZh
            ? '当前没有打开的画布。新画布会自动出现在这里；之后可从对话里的画布入口再次打开。'
            : 'No Canvas artifact open. A new Canvas appears here automatically; use its conversation launcher to reopen it later.'}
        </div>
      </div>
    );
  }

  return (
    <div className="artifact-canvas-panel" data-testid="artifact-canvas-panel">
      {pendingProposal ? (
        <div className="artifact-canvas-proposal" data-testid="artifact-canvas-proposal">
          <div className="artifact-canvas-proposal-head">
            <strong>{pendingProposal.label ?? (isZh ? '作曲器提案' : 'Composer proposal')}</strong>
          </div>
          <pre
            className="artifact-canvas-proposal-text"
            data-testid="artifact-canvas-proposal-text"
          >
            {pendingProposal.text}
          </pre>
          <div className="artifact-canvas-proposal-actions">
            <Button
              variant="ghost"
              size="compact"
              data-testid="artifact-canvas-proposal-dismiss"
              onClick={handleDismiss}
            >
              {isZh ? '忽略' : 'Dismiss'}
            </Button>
            <Button
              size="compact"
              data-testid="artifact-canvas-proposal-insert"
              onClick={handleInsert}
            >
              {isZh ? '插入到作曲器' : 'Insert into Composer'}
            </Button>
          </div>
        </div>
      ) : null}
      {plan && (plan.kind === 'render' || plan.kind === 'blocked') ? (
        <ArtifactFrame
          key={`${props.artifactThemeKey ?? 'default'}:${activeTarget.id}`}
          plan={plan}
          presentation="canvas"
          locale={locale}
          initPriority={0}
          onComposerProposal={setPendingProposal}
        />
      ) : (
        <div className="artifact-canvas-empty muted">
          {isZh ? `正在准备「${activeTarget.title}」…` : `Preparing “${activeTarget.title}”…`}
        </div>
      )}
      {canExportSource && props.hideFloatingDownload !== true ? (
        <div className="artifact-floating-actions artifact-canvas-export">
          <IconButton
            label={downloadLabel}
            title={downloadLabel}
            size="sm"
            className="artifact-floating-action-button artifact-canvas-download"
            data-testid="artifact-canvas-panel-download"
            onClick={handleDownloadSource}
          >
            <IconDownload size={14} />
          </IconButton>
        </div>
      ) : null}
    </div>
  );
}
