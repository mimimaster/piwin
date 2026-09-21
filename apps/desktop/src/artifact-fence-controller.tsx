import { useLayoutEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import {
  analyzeArtifactFence,
  createArtifactFenceRecord,
  createDefaultArtifactTheme,
  materializeArtifact,
  type ArtifactRenderPlan,
} from '@piwin/artifact';
import { Button } from '@piwin/ui-kit';
import { ArtifactCanvasLauncher } from './artifact-canvas-launcher.js';
import { ArtifactInlinePreview } from './artifact-inline-preview.js';
import { createArtifactCanvasTarget } from './artifact-canvas-model.js';
import { isShellLanguage, SourceCodeBlock } from './markdown-code-block.js';
import type { MarkdownCodeFenceProps } from './markdown-code-fence.js';
import { useArtifactSessionMediaDataUrls } from './artifact-session-media.js';
import {
  readArtifactTypography,
  sameArtifactTypography,
  type ArtifactTypography,
} from './artifact-typography.js';

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
  // Two surfaces, two switches. Canvas inherited the Inline value before the
  // split, and optional callers still do, so a single resolved switch keeps
  // working for isolated renders (Flashcards, Doc Cards, tests).
  const inlineEnabled = props.artifactInlineEnabled;
  const canvasEnabled = props.artifactCanvasEnabled ?? props.artifactInlineEnabled;
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
    try {
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
    } catch (error) {
      console.warn('[piwin] artifact fence analysis failed', error);
      return null;
    }
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
    inlineEnabled &&
    artifactPreviewOpen &&
    mountsInline &&
    !(liveFence && artifactCodeFirst);

  const mediaDataUrls = useArtifactSessionMediaDataUrls({
    source: props.source,
    ...(props.artifactOrigin ? { originSessionId: props.artifactOrigin.sessionId } : {}),
  });

  // The sandbox iframe cannot inherit transcript typography. Measure the mount
  // point before the first frame so stream paint matches the static final.
  const previewRootRef = useRef<HTMLDivElement | null>(null);
  const [typography, setTypography] = useState<ArtifactTypography | null>(null);
  useLayoutEffect(() => {
    const root = previewRootRef.current;
    if (!willMountInlineFrame || root === null) return;
    const next = readArtifactTypography(root);
    setTypography((current) => (sameArtifactTypography(current, next) ? current : next));
  }, [willMountInlineFrame, props.artifactThemeKey]);

  const plan = useMemo((): Extract<ArtifactRenderPlan, { kind: 'render' }> | null => {
    if (!willMountInlineFrame || typography === null || analysis?.kind !== 'intent') return null;
    try {
      return materializeArtifact(analysis.intent, {
        mode: liveFence ? 'stream-preview' : 'interactive',
        source: props.source,
        presentation: 'inline',
        mediaDataUrls,
        theme: { ...(props.artifactTheme ?? createDefaultArtifactTheme('dark')), ...typography },
      });
    } catch (error) {
      console.warn('[piwin] artifact fence materialize failed', error);
      return null;
    }
  }, [
    willMountInlineFrame,
    typography,
    analysis,
    liveFence,
    props.source,
    props.artifactTheme,
    mediaDataUrls,
  ]);

  const previewRoot = (children: ReactElement | null, live: boolean): ReactElement => (
    <div
      ref={previewRootRef}
      className="artifact-with-source artifact-with-source--preview"
      data-artifact-id={stickyFenceId ?? undefined}
      {...(live ? { 'data-testid': 'artifact-stream-live' } : {})}
    >
      {children}
    </div>
  );

  if (boundFenceIndex === null || stickyFenceId === null || analysis === null) {
    return (
      <SourceCodeBlock
        language={props.language}
        source={props.source}
        isShell={isShellLanguage(props.language)}
        streaming={liveFence}
      />
    );
  }

  const decisionLanguage = analysis.kind === 'code' ? analysis.language : undefined;
  const isShell = isShellLanguage(props.language || decisionLanguage);
  const previewLabel =
    analysis.kind === 'intent' && analysis.intent.descriptor.type === 'svg'
      ? 'Preview SVG'
      : 'Preview';
  // No Inline surface for this session → no dead Preview affordance.
  const previewToggle = inlineEnabled ? (
    <Button
      size="compact"
      data-testid="artifact-preview-toggle"
      aria-expanded={false}
      onClick={() => setArtifactPreviewOpen(true)}
    >
      {previewLabel}
    </Button>
  ) : null;
  const boundSource = (
    <div className="artifact-with-source" data-artifact-id={stickyFenceId}>
      <SourceCodeBlock
        language={props.language}
        source={props.source}
        isShell={isShell}
        {...(previewToggle ? { previewAction: previewToggle } : {})}
        defaultCollapsed={!artifactSourceExpanded}
        {...(liveFence ? { streaming: true } : {})}
      />
    </div>
  );

  const origin = props.artifactOrigin;
  const onOpenCanvas = props.onOpenArtifactCanvas;
  let canvasLauncher: ReactElement | null = null;
  if (
    analysis.kind === 'intent' &&
    layout === 'canvas' &&
    canvasEnabled &&
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

  if (willMountInlineFrame && plan === null) {
    // One layout pass to measure typography; nothing paints in between.
    return previewRoot(null, liveFence);
  }

  if (liveFence) {
    if (willMountInlineFrame && plan) {
      return previewRoot(
        <ArtifactInlinePreview
          plan={plan}
          fenceId={stickyFenceId}
          initPriority={props.initPriority}
          locale={props.locale}
          onShowSource={showArtifactSource}
          {...(props.artifactThemeKey ? { artifactThemeKey: props.artifactThemeKey } : {})}
          {...(props.artifactTheme ? { artifactTheme: props.artifactTheme } : {})}
          {...(props.onArtifactAction ? { onArtifactAction: props.onArtifactAction } : {})}
        />,
        true,
      );
    }

    if (analysis.kind === 'intent' && mountsInline && inlineEnabled) {
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

  // Canvas stays available when Inline is off: a canvas fence still folds to
  // its transcript launcher, and a canvas fence without one degrades to source.
  if (canvasLauncher) {
    return canvasLauncher;
  }

  if (analysis.kind === 'code' || !inlineEnabled) {
    return <SourceCodeBlock language={props.language} source={props.source} isShell={isShell} />;
  }

  if (analysis.kind === 'blocked') {
    return (
      <div className="artifact-with-source">
        <SourceCodeBlock
          language={props.language}
          source={props.source}
          isShell={isShell}
          blockedReason={analysis.reason}
        />
      </div>
    );
  }

  if (layout === 'canvas') {
    return <SourceCodeBlock language={props.language} source={props.source} isShell={isShell} />;
  }

  if (willMountInlineFrame && plan) {
    return previewRoot(
      <ArtifactInlinePreview
        plan={plan}
        fenceId={stickyFenceId}
        initPriority={props.initPriority}
        locale={props.locale}
        onShowSource={showArtifactSource}
        {...(props.artifactThemeKey ? { artifactThemeKey: props.artifactThemeKey } : {})}
        {...(props.artifactTheme ? { artifactTheme: props.artifactTheme } : {})}
        {...(props.onArtifactAction ? { onArtifactAction: props.onArtifactAction } : {})}
      />,
      false,
    );
  }

  return boundSource;
}
