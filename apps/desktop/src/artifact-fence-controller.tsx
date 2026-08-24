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
 */
export function ArtifactFenceController(props: MarkdownCodeFenceProps): ReactElement {
  const streamMode = props.renderingPhase === 'streaming';
  const artifactCodeFirst = props.artifactCodeFirst ?? false;
  const nativeSourceFence = /^(?:html|htm|svg)$/i.test(props.language.trim());
  const boundFenceIndex = props.fenceIndex;
  // Freeze fence identity on first mount. Source growth must not remount an iframe.
  const stickyFenceIdRef = useRef<string | null>(null);
  if (stickyFenceIdRef.current === null && boundFenceIndex !== null) {
    const origin = props.artifactOrigin?.messageId ?? 'local';
    stickyFenceIdRef.current = `${origin}-artifact-${boundFenceIndex}`;
  }
  const stickyFenceId = stickyFenceIdRef.current;
  const [artifactPreviewOpen, setArtifactPreviewOpen] = useState(
    props.renderingPhase === 'explicit-artifact-review' ||
      (!artifactCodeFirst && !nativeSourceFence),
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
        open: streamMode,
      }),
      {
        id: stickyFenceId,
        htmlUiModeEnabled: props.htmlUiModeEnabled,
        mode: streamMode ? 'stream-preview' : 'interactive',
        ...(props.artifactMaxBytes !== undefined ? { maxBytes: props.artifactMaxBytes } : {}),
      },
    );
  }, [
    boundFenceIndex,
    stickyFenceId,
    props.fenceInfo,
    props.source,
    streamMode,
    props.htmlUiModeEnabled,
    props.artifactMaxBytes,
  ]);

  const layout = analysis?.kind === 'intent' ? analysis.intent.layout : null;
  const mountsInline = layout === 'flow' || layout === 'viewport';
  // Keep a live stream-preview mounted when later tokens upgrade flow → viewport.
  const willMountInlineFrame =
    analysis?.kind === 'intent' &&
    props.artifactPreviewEnabled &&
    artifactPreviewOpen &&
    mountsInline &&
    !(streamMode && artifactCodeFirst);

  const plan = useMemo((): Extract<ArtifactRenderPlan, { kind: 'render' }> | null => {
    if (!willMountInlineFrame || analysis?.kind !== 'intent') return null;
    return materializeArtifact(analysis.intent, {
      mode: streamMode ? 'stream-preview' : 'interactive',
      source: props.source,
      presentation: 'inline',
      ...(props.artifactTheme ? { theme: props.artifactTheme } : {}),
    });
  }, [willMountInlineFrame, analysis, streamMode, props.source, props.artifactTheme]);

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

  if (streamMode) {
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

    return (
      <SourceCodeBlock
        language={props.language}
        source={props.source}
        isShell={isShell}
        streaming
      />
    );
  }

  if (analysis.kind === 'code' || !props.artifactPreviewEnabled) {
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
    if (props.artifactOrigin && props.onOpenArtifactCanvas) {
      const target = createArtifactCanvasTarget({
        ...props.artifactOrigin,
        fenceIndex: boundFenceIndex,
        intent: analysis.intent,
      });
      return (
        <ArtifactCanvasLauncher
          title={analysis.intent.descriptor.title}
          source={analysis.intent.descriptor.source}
          rawLanguage={analysis.intent.descriptor.rawLanguage}
          onOpenCanvas={() => props.onOpenArtifactCanvas?.(target)}
        />
      );
    }
    return <SourceCodeBlock language={props.language} source={props.source} isShell={isShell} />;
  }

  const previewLabel = analysis.intent.descriptor.type === 'svg' ? 'Preview SVG' : 'Preview';

  return (
    <div
      className={
        willMountInlineFrame && plan
          ? 'artifact-with-source artifact-with-source--preview'
          : 'artifact-with-source'
      }
      data-artifact-id={stickyFenceId}
    >
      {willMountInlineFrame && plan ? (
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
      ) : (
        <SourceCodeBlock
          language={props.language}
          source={props.source}
          isShell={isShell}
          defaultCollapsed={!artifactSourceExpanded}
          previewAction={
            <Button
              size="compact"
              data-testid="artifact-preview-toggle"
              aria-expanded={false}
              onClick={() => setArtifactPreviewOpen(true)}
            >
              {previewLabel}
            </Button>
          }
        />
      )}
    </div>
  );
}
