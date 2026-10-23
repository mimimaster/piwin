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

import { useLayoutEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import {
  materializeArtifact,
  type ArtifactThemeVariables,
  type ComposerProposeTextActionPayload,
} from '@piwin/artifact';
import { Button } from '@piwin/ui-kit';
import { ArtifactFrame } from './ArtifactFrame';
import { artifactIncompleteCopy } from './artifact-incomplete-copy.js';
import type { ArtifactCanvasTarget } from './artifact-canvas-model';
import { artifactDownloadLabel, downloadArtifactSource } from './artifact-source-export.js';
import { useDesktopLocale } from '../i18n/desktop-locale-context';
import { useArtifactSessionMediaDataUrls } from './artifact-session-media.js';
import { useStableArtifactTheme } from './artifact-stable-theme.js';
import {
  readArtifactReadingTypography,
  sameArtifactTypography,
  type ArtifactTypography,
} from './artifact-typography.js';
import { RenderErrorBoundary } from '../markdown/render-error-boundary.js';
import { ArtifactFullscreenOverlay } from './artifact-fullscreen-overlay.js';
import { ArtifactViewerStage, ArtifactViewerToolbar } from './artifact-viewer-controls.js';
import { resolveArtifactViewerKey, type ArtifactViewerWidth } from './artifact-viewer-model.js';
import { SourceCodeBlock } from '../markdown/markdown-code-block.js';
import { isMobileTauriRuntime } from '../tool-cards/shell-runtime.js';
import { useArtifactStyleModes } from './artifact-style-modes';
import type { ArtifactTextSelection } from './artifact-canvas-selection.js';
import { ArtifactCanvasSelectionComment } from './artifact-canvas-selection-comment.js';

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
  /** The surrounding header renders Download, so the toolbar omits its own. */
  hideFloatingDownload?: boolean;
  /** Width presets; defaults off on the mobile shell (fullscreen only). */
  viewerPresets?: boolean;
};

function canvasPanelResetKey(target: ArtifactCanvasTarget | null): string {
  if (!target) return 'empty';
  return `${target.id}:${target.source.length}:${target.streaming === true ? 'stream' : 'final'}`;
}

export function ArtifactCanvasPanel(props: ArtifactCanvasPanelProps): ReactElement {
  const { locale } = useDesktopLocale();
  return (
    <RenderErrorBoundary
      locale={locale}
      surface="canvas"
      resetKey={canvasPanelResetKey(props.activeTarget)}
    >
      <ArtifactCanvasPanelInner {...props} />
    </RenderErrorBoundary>
  );
}

function ArtifactCanvasPanelInner(props: ArtifactCanvasPanelProps): ReactElement {
  const { activeTarget } = props;
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';
  const [pendingProposal, setPendingProposal] = useState<ArtifactCanvasProposal | null>(null);
  const [width, setWidth] = useState<ArtifactViewerWidth>('fit');
  const [fullscreen, setFullscreen] = useState(false);
  const [showingCode, setShowingCode] = useState(false);
  const [textSelection, setTextSelection] = useState<ArtifactTextSelection | null>(null);
  // "View with theme" applies to one artifact; another target starts in its own style.
  const [hostViewTargetId, setHostViewTargetId] = useState<string | null>(null);
  const styleModes = useArtifactStyleModes();
  const presets = props.viewerPresets ?? !isMobileTauriRuntime();
  const mediaDataUrls = useArtifactSessionMediaDataUrls({
    source: activeTarget?.source ?? '',
    ...(activeTarget ? { originSessionId: activeTarget.sessionId } : {}),
  });

  const hostTheme = useStableArtifactTheme(props.artifactTheme);
  // The sandbox cannot inherit the reading size; measure it before the first
  // frame so the Canvas reads at the same size as the transcript.
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [typography, setTypography] = useState<ArtifactTypography | null>(null);
  const hasTarget = activeTarget !== null && activeTarget !== undefined;
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!hasTarget || panel === null) return;
    const next = readArtifactReadingTypography(panel);
    setTypography((current) => (sameArtifactTypography(current, next) ? current : next));
  }, [hasTarget, props.artifactThemeKey]);
  const artifactTheme = useMemo(
    () => (hostTheme && typography ? { ...hostTheme, ...typography } : hostTheme),
    [hostTheme, typography],
  );
  const hostView = activeTarget !== null && activeTarget !== undefined && hostViewTargetId === activeTarget.id;
  const plan = useMemo(() => {
    if (!activeTarget || typography === null) return null;
    return materializeArtifact(activeTarget.intent, {
      mode: activeTarget.streaming === true ? 'stream-preview' : 'interactive',
      source: activeTarget.source,
      presentation: 'canvas',
      mediaDataUrls,
      styleModes,
      ...(hostView ? { forceHostStyle: true } : {}),
      ...(artifactTheme ? { theme: artifactTheme } : {}),
    });
  }, [activeTarget, typography, artifactTheme, mediaDataUrls, styleModes, hostView]);

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
    <div
      ref={panelRef}
      className="artifact-canvas-panel"
      data-testid="artifact-canvas-panel"
      onKeyDown={(event) => {
        if (fullscreen) return;
        const action = resolveArtifactViewerKey(event.nativeEvent, { surface: 'canvas', presets });
        if (!action) return;
        event.preventDefault();
        if (action.kind === 'toggle-fullscreen') setFullscreen(true);
        else if (action.kind === 'width') setWidth(action.width);
      }}
    >
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
      {activeTarget.sourceIncomplete ? (
        <div className="artifact-canvas-incomplete">
          <p className="artifact-source-incomplete" data-testid="artifact-source-incomplete" role="status">
            {artifactIncompleteCopy(locale, activeTarget.source)}
          </p>
        </div>
      ) : null}
      <ArtifactViewerToolbar
        title={activeTarget.title}
        style={activeTarget.intent.descriptor.style}
        locale={locale}
        fullscreen={false}
        presets={presets}
        width={width}
        onWidthChange={setWidth}
        // The desktop pane has its own maximize; the mobile shell has no
        // keyboard for F, so it keeps the button.
        {...(presets ? {} : { onToggleFullscreen: () => setFullscreen(true) })}
        showingCode={showingCode}
        onToggleCode={() => setShowingCode((value) => !value)}
        {...(canExportSource && props.hideFloatingDownload !== true
          ? { onDownload: handleDownloadSource, downloadLabel }
          : {})}
        downloadTestId="artifact-canvas-panel-download"
        testIdPrefix="artifact-canvas"
      />
      {showingCode ? (
        <div className="artifact-canvas-code" data-testid="artifact-canvas-code">
          <SourceCodeBlock
            language={activeTarget.type === 'svg' ? 'svg' : 'html'}
            source={activeTarget.source}
            isShell={false}
          />
        </div>
      ) : plan && (plan.kind === 'render' || plan.kind === 'blocked') ? (
        <ArtifactViewerStage width={width} testId="artifact-canvas-stage">
          <ArtifactFrame
            key={`${props.artifactThemeKey ?? 'default'}:${activeTarget.id}`}
            plan={plan}
            presentation="canvas"
            locale={locale}
            initPriority={0}
            onComposerProposal={setPendingProposal}
            onTextSelection={setTextSelection}
            styleOverride={{
              active: hostView,
              onToggle: () => setHostViewTargetId(hostView ? null : activeTarget.id),
            }}
          />
        </ArtifactViewerStage>
      ) : (
        <div className="artifact-canvas-empty muted">
          {isZh ? `正在准备「${activeTarget.title}」…` : `Preparing “${activeTarget.title}”…`}
        </div>
      )}
      {textSelection && !showingCode && !fullscreen ? (
        <ArtifactCanvasSelectionComment
          selection={textSelection}
          locale={locale}
          onDone={() => setTextSelection(null)}
        />
      ) : null}
      {fullscreen ? (
        <ArtifactFullscreenOverlay
          intent={activeTarget.intent}
          source={activeTarget.source}
          locale={locale}
          presets={presets}
          initialWidth={width}
          mediaDataUrls={mediaDataUrls}
          {...(artifactTheme ? { hostTheme: artifactTheme } : {})}
          onClose={() => setFullscreen(false)}
        />
      ) : null}
    </div>
  );
}
