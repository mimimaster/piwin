import { useMemo, useRef, useState, type ReactElement } from 'react';
import {
  analyzeArtifactFence,
  createArtifactFenceRecord,
  materializeArtifact,
  type ArtifactRenderPlan,
} from '@piwin/artifact';
import { Button } from '@piwin/ui-kit';
import { ArtifactCanvasLauncher } from './artifact-canvas-launcher.js';
import { ArtifactInlinePreview } from './artifact-inline-preview.js';
import { createArtifactCanvasTarget } from './artifact-canvas-model.js';
import { isShellLanguage, SourceCodeBlock } from './markdown-code-block.js';
import type { MarkdownCodeFenceProps } from './markdown-code-fence.js';

/**
 * Bound-fence source/preview/Canvas controller.
 * Routing comes from analyzeArtifactFence; this module does not re-classify.
 *
 * Canvas product split: while the fence is still open, dump source in the
 * transcript (right panel stream-previews via auto-reveal). Once the closing
 * fence arrives, fold to the launcher — even if renderingPhase is still
 * stuck on streaming because activeRunId has not cleared.
 */
export function ArtifactFenceController(props: MarkdownCodeFenceProps): ReactElement {
  const streamMode = props.renderingPhase === 'streaming';
  const fenceOpen = props.fenceOpen === true;
  /** Live growing fence: stream-preview analysis + Canvas source dump. */
  const liveFence = streamMode && fenceOpen;
  const artifactCodeFirst = props.artifactCodeFirst ?? false;
  const boundFenceIndex = props.fenceIndex;
  // Freeze fence identity on first mount. Source growth must not remount an iframe.
  const stickyFenceIdRef = useRef<string | null>(null);
  if (stickyFenceIdRef.current === null && boundFenceIndex !== null) {
    const origin = props.artifactOrigin?.messageId ?? 'local';
    stickyFenceIdRef.current = `${origin}-artifact-${boundFenceIndex}`;
  }
  const stickyFenceId = stickyFenceIdRef.current;
  const [artifactPreviewOpen, setArtifactPreviewOpen] = useState(
    props.renderingPhase === 'explicit-artifact-review' || !artifactCodeFirst,
  );
  const [artifactSourceExpanded, setArtifactSourceExpanded] = useState(false);
  const showArtifactSource = (): void => {
    setArtifactSourceExpanded(true);
    setArtifactPreviewOpen(false);
  };

  const analysis = useMemo(() => {
    if (boundFenceIndex === null || stickyFenceId === null) return null;
    return analyzeArtifactFence(
      createArtifactFenceRecord({
        info: props.fenceInfo,
        source: props.source,
        ordinal: boundFenceIndex,
        open: liveFence,
      }),
      {
        id: stickyFenceId,
        htmlUiModeEnabled: props.htmlUiModeEnabled,
        mode: liveFence ? 'stream-preview' : 'interactive',
        ...(props.artifactMaxBytes !== undefined ? { maxBytes: props.artifactMaxBytes } : {}),
        ...(props.artifactBlockExternalScripts !== undefined
          ? { blockExternalScripts: props.artifactBlockExternalScripts }
          : {}),
        ...(props.artifactBlockExternalResources !== undefined
          ? { blockExternalResources: props.artifactBlockExternalResources }
          : {}),
      },
    );
  }, [
    boundFenceIndex,
    stickyFenceId,
    props.fenceInfo,
    props.source,
    liveFence,
    props.htmlUiModeEnabled,
    props.artifactMaxBytes,
    props.artifactBlockExternalScripts,
    props.artifactBlockExternalResources,
  ]);

  const layout = analysis?.kind === 'intent' ? analysis.intent.layout : null;
  const mountsInline = layout === 'flow' || layout === 'viewport';
  // Keep a live stream-preview mounted when later tokens upgrade flow → viewport.
  const willMountInlineFrame =
    analysis?.kind === 'intent' &&
    props.artifactPreviewEnabled &&
    artifactPreviewOpen &&
    mountsInline &&
    !(liveFence && artifactCodeFirst);

  const plan = useMemo((): Extract<ArtifactRenderPlan, { kind: 'render' }> | null => {
    if (!willMountInlineFrame || analysis?.kind !== 'intent') return null;
    return materializeArtifact(analysis.intent, {
      mode: liveFence ? 'stream-preview' : 'interactive',
      source: props.source,
      presentation: 'inline',
      ...(props.artifactTheme ? { theme: props.artifactTheme } : {}),
    });
  }, [willMountInlineFrame, analysis, liveFence, props.source, props.artifactTheme]);

  if (boundFenceIndex === null || stickyFenceId === null || analysis === null) {
    return (
      <SourceCodeBlock
        language={props.language}
        source={props.source}
        isShell={isShellLanguage(props.language)}
        streaming={streamMode}
      />
    );
  }

  const decisionLanguage = analysis.kind === 'code' ? analysis.language : undefined;
  const isShell = isShellLanguage(props.language || decisionLanguage);
  const previewLabel =
    analysis.kind === 'intent' && analysis.intent.descriptor.type === 'svg'
      ? 'Preview SVG'
      : 'Preview';
  const previewToggle = (
    <Button
      size="compact"
      data-testid="artifact-preview-toggle"
      aria-expanded={false}
      onClick={() => setArtifactPreviewOpen(true)}
    >
      {previewLabel}
    </Button>
  );
  const boundSource = (
    <div className="artifact-with-source" data-artifact-id={stickyFenceId}>
      <SourceCodeBlock
        language={props.language}
        source={props.source}
        isShell={isShell}
        previewAction={previewToggle}
        defaultCollapsed={!artifactSourceExpanded}
        {...(streamMode ? { streaming: true } : {})}
      />
    </div>
  );

  const origin = props.artifactOrigin;
  const onOpenCanvas = props.onOpenArtifactCanvas;
  let canvasLauncher: ReactElement | null = null;
  if (
    analysis.kind === 'intent' &&
    layout === 'canvas' &&
    props.artifactPreviewEnabled &&
    origin &&
    onOpenCanvas
  ) {
    const target = createArtifactCanvasTarget({
      sessionId: origin.sessionId,
      messageId: origin.messageId,
      fenceIndex: boundFenceIndex,
      intent: analysis.intent,
      ...(liveFence ? { streaming: true } : {}),
    });
    canvasLauncher = (
      <ArtifactCanvasLauncher
        title={analysis.intent.descriptor.title}
        source={analysis.intent.descriptor.source}
        rawLanguage={analysis.intent.descriptor.rawLanguage}
        onOpenCanvas={() => onOpenCanvas(target)}
        locale={props.locale}
      />
    );
  }

  if (liveFence) {
    if (willMountInlineFrame && plan) {
      return (
        <div
          className="artifact-with-source artifact-with-source--preview"
          data-artifact-id={stickyFenceId}
          data-testid="artifact-stream-live"
        >
          <ArtifactInlinePreview
            plan={plan}
            fenceId={stickyFenceId}
            initPriority={props.initPriority}
            locale={props.locale}
            onShowSource={showArtifactSource}
            {...(props.artifactThemeKey ? { artifactThemeKey: props.artifactThemeKey } : {})}
            {...(props.artifactTheme ? { artifactTheme: props.artifactTheme } : {})}
            {...(props.onArtifactAction ? { onArtifactAction: props.onArtifactAction } : {})}
          />
        </div>
      );
    }

    if (analysis.kind === 'intent' && mountsInline && props.artifactPreviewEnabled) {
      return boundSource;
    }

    // Canvas (and anything else not mounting inline): dump growing source.
    return (
      <SourceCodeBlock
        language={props.language}
        source={props.source}
        isShell={isShell}
        streaming
      />
    );
  }

  const streamingProps = streamMode ? ({ streaming: true } as const) : {};

  if (analysis.kind === 'code' || !props.artifactPreviewEnabled) {
    return (
      <SourceCodeBlock
        language={props.language}
        source={props.source}
        isShell={isShell}
        {...streamingProps}
      />
    );
  }

  if (analysis.kind === 'blocked') {
    return (
      <div className="artifact-with-source">
        <SourceCodeBlock
          language={props.language}
          source={props.source}
          isShell={isShell}
          blockedReason={analysis.reason}
          {...streamingProps}
        />
      </div>
    );
  }

  if (canvasLauncher) {
    return canvasLauncher;
  }

  if (layout === 'canvas') {
    return (
      <SourceCodeBlock
        language={props.language}
        source={props.source}
        isShell={isShell}
        {...streamingProps}
      />
    );
  }

  if (willMountInlineFrame && plan) {
    return (
      <div
        className="artifact-with-source artifact-with-source--preview"
        data-artifact-id={stickyFenceId}
      >
        <ArtifactInlinePreview
          plan={plan}
          fenceId={stickyFenceId}
          initPriority={props.initPriority}
          locale={props.locale}
          onShowSource={showArtifactSource}
          {...(props.artifactThemeKey ? { artifactThemeKey: props.artifactThemeKey } : {})}
          {...(props.artifactTheme ? { artifactTheme: props.artifactTheme } : {})}
          {...(props.onArtifactAction ? { onArtifactAction: props.onArtifactAction } : {})}
        />
      </div>
    );
  }

  return boundSource;
}
