import { useEffect, useId, useMemo, useRef, useState, type ReactElement } from 'react';
import { cjk } from '@streamdown/cjk';
import {
  projectArtifactMarkdownForRender,
  type ArtifactActionMessage,
  type ArtifactThemeVariables,
} from '@piwin/artifact';
import { Streamdown, type Components } from 'streamdown';
import type { ArtifactCanvasTarget } from './artifact-canvas-model.js';
import type { MarkdownRenderingPhase } from './markdown-code-fence.js';
import {
  createStreamdownComponents,
  KnowledgeCitationIndexProvider,
  StreamdownRendererOptionsProvider,
  type StreamdownRendererOptions,
} from './markdown-streamdown.js';
import { createMarkdownBlockIndex, createMarkdownStreamBlock } from './markdown-stream-blocks.js';
import { repairStreamingMarkdownTail } from './markdown-stream-repair.js';
import { escapeRawHtmlInMarkdown } from './markdown-html-escape.js';
import { rewriteLocalFileMarkdownLinks } from './markdown-local-links.js';
import {
  EMPTY_KNOWLEDGE_CITATION_INDEX,
  linkKnowledgeCitationMarkers,
  type KnowledgeCitationIndex,
} from './knowledge/knowledge-citations.js';
import { MarkdownRenderingPhaseProvider } from './markdown-rendering-phase.js';
import { RenderErrorBoundary } from './render-error-boundary.js';
import { useStableArtifactTheme } from './artifact-stable-theme.js';
import { useStreamCaretAnchor } from './stream-caret-anchor.js';
import {
  getStreamdownMathPlugin,
  loadStreamdownMathPlugin,
  type StreamdownMathPlugin,
} from './streamdown-math-plugin.js';

export type { MarkdownRenderingPhase } from './markdown-code-fence.js';

type MarkdownViewProps = {
  text: string;
  /**
   * Parser flag: when false, native `html`/`htm` fences are not promoted to
   * artifact descriptors by `analyzeArtifactFence`. When omitted, mirrors
   * `artifactInlineEnabled` so language/source normalization stays
   * byte-stable across capability toggles.
   */
  htmlUiModeEnabled?: boolean;
  /**
   * streaming — Streamdown repair + caret; ordinary code and Mermaid stay
   * source. HTML/SVG may stream-preview in one sandbox iframe when capability
   * is on and code-first is off.
   * completed — full Markdown; compatible Inline HTML/SVG may auto-preview.
   * explicit-artifact-review — open preview for completed HTML candidates.
   */
  renderingPhase?: MarkdownRenderingPhase;
  /** Optional artifact CSS vars from active desktop theme. */
  artifactTheme?: ArtifactThemeVariables;
  /** Base priority for init queue (higher = sooner). */
  initPriorityBase?: number;
  /** Bumped on theme switch so ArtifactFrame remounts with new tokens. */
  artifactThemeKey?: string;
  /** Forwarded to ArtifactFrame for whitelisted artifact actions. */
  onArtifactAction?: (action: ArtifactActionMessage) => void;
  /** Owning message identity used to create a stable Canvas target. */
  artifactOrigin?: { sessionId: string; messageId: string };
  /** Opens an explicitly declared Canvas artifact in the workspace panel. */
  onOpenArtifactCanvas?: (target: ArtifactCanvasTarget) => void;
  /**
   * Inline Artifact capability from the session's resolved Artifact switches.
   * Isolated tests may omit it (defaults to true).
   */
  artifactInlineEnabled?: boolean;
  /**
   * Canvas capability. Omitted follows `artifactInlineEnabled`, which keeps
   * isolated single-switch callers (Doc Cards, tests) working.
   */
  artifactCanvasEnabled?: boolean;
  /**
   * Shows the inline caret only for the message that owns the live text tail.
   * Empty streaming lifecycle messages never render a caret.
   */
  showStreamingCaret?: boolean;
  /**
   * When true, Inline artifact blocks display source first with a preview toggle.
   * Code-first is Inline-only and does not suppress Canvas auto-reveal.
   */
  artifactCodeFirst?: boolean;
  /** Security byte cap forwarded to analyzeArtifactFence when heavy path runs. */
  artifactMaxBytes?: number;
  artifactBlockExternalScripts?: boolean;
  artifactBlockExternalResources?: boolean;
  /** Locale for Artifact frame copy (recycled preview placeholder). */
  locale?: 'zh-CN' | 'en';
  /** Callback when user clicks a markdown document link or plan document chip. */
  onOpenDocument?: ((doc: { title: string; path?: string; content?: string }) => void) | undefined;
  /** Active project root — resolves relative path chips and enables Save As / Reveal. */
  projectPath?: string | null | undefined;
  /** Knowledge citations retrieved in this turn; `[n]` markers that resolve become inline citations. */
  knowledgeCitations?: KnowledgeCitationIndex | undefined;
};

const STREAMDOWN_BASE_PLUGINS = { cjk } as const;
const MARKDOWN_LINK_SAFETY = { enabled: false };
/**
 * Streamdown 2.5: `mode="streaming"` + `animated={false}` defers block
 * updates with `startTransition` inside useEffect. WKWebView starves that
 * transition under a steady Host cadence. Passing an animate *object* makes
 * the internal `ge` flag truthy so those updates are urgent setState.
 * `isAnimating` stays false: `ge && isAnimating` is what injects
 * `data-sd-animate` word spans. Caret is CSS `.has-stream-caret` only.
 */
export const STREAMDOWN_IMMEDIATE_STREAMING = {
  duration: 0,
  stagger: 0,
} as const;
function projectMarkdownForRender(
  text: string,
  streamMode: boolean,
  knowledgeCitations: KnowledgeCitationIndex,
) {
  try {
    return projectArtifactMarkdownForRender(
      escapeRawHtmlInMarkdown(
        linkKnowledgeCitationMarkers(rewriteLocalFileMarkdownLinks(text), knowledgeCitations),
      ),
      !streamMode,
    );
  } catch (error) {
    console.warn('[piwin] artifact markdown projection failed', error);
    return {
      markdown: text,
      fences: [],
      ordinalByProjectedStartOffset: new Map<number, number>(),
    };
  }
}

/**
 * Streamdown adapter. Fence identity is the canonical index ordinal; Artifact
 * preview, highlight, math, and Mermaid live behind MarkdownCodeFence.
 */
export function MarkdownView({
  text,
  htmlUiModeEnabled,
  renderingPhase = 'completed',
  artifactTheme,
  initPriorityBase = 0,
  artifactThemeKey = 'default',
  onArtifactAction,
  artifactOrigin,
  onOpenArtifactCanvas,
  artifactInlineEnabled = true,
  artifactCanvasEnabled,
  showStreamingCaret = true,
  artifactCodeFirst = false,
  artifactMaxBytes,
  artifactBlockExternalScripts,
  artifactBlockExternalResources,
  locale = 'en',
  onOpenDocument,
  projectPath = null,
  knowledgeCitations = EMPTY_KNOWLEDGE_CITATION_INDEX,
}: MarkdownViewProps): ReactElement {
  const phase: MarkdownRenderingPhase = renderingPhase ?? 'completed';
  const streamMode = phase === 'streaming';

  const streamdownHtmlUiMode = htmlUiModeEnabled ?? artifactInlineEnabled;
  const stableArtifactTheme = useStableArtifactTheme(artifactTheme);
  const stableArtifactOrigin = useMemo(
    () =>
      artifactOrigin
        ? { sessionId: artifactOrigin.sessionId, messageId: artifactOrigin.messageId }
        : undefined,
    [artifactOrigin?.sessionId, artifactOrigin?.messageId],
  );

  const artifactProjection = useMemo(
    () => projectMarkdownForRender(text, streamMode, knowledgeCitations),
    [text, streamMode, knowledgeCitations],
  );
  const streamdownText = artifactProjection.markdown;
  const shouldShowStreamingCaret = streamMode && showStreamingCaret && text.trim().length > 0;
  // Unique per mounted reply, so the caret anchor finds this reply's root
  // without wrapping Streamdown in an element of our own.
  const caretRootClass = `md-caret-root-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  useStreamCaretAnchor(caretRootClass, shouldShowStreamingCaret);
  // Streamdown treats a trailing blank line as a separate streaming block.
  // That would put the caret on an otherwise empty line, so remove only the
  // transient trailing line break from the live render. The stored message is
  // unchanged and the next real token will restore the intended Markdown.
  const streamdownTextForRender = useMemo(() => {
    const visible = shouldShowStreamingCaret
      ? streamdownText.replace(/(?:\r?\n)+$/u, '')
      : streamdownText;
    // Streamdown's own repair rescans the whole reply per token; see
    // `repairStreamingMarkdownTail`. A finished reply is rendered as written.
    return streamMode ? repairStreamingMarkdownTail(visible) : visible;
  }, [shouldShowStreamingCaret, streamdownText, streamMode]);
  // History can use Streamdown's cheaper static path. Once this mounted
  // message has rendered live tokens, it must retain the keyed block tree
  // through completion or custom code fences (and their iframes) unmount.
  const usedStreamingRendererRef = useRef(streamMode);
  if (streamMode) {
    usedStreamingRendererRef.current = true;
  }
  const streamdownMode = usedStreamingRendererRef.current ? 'streaming' : 'static';
  const streamdownRendererOptions: StreamdownRendererOptions = {
    phase,
    htmlUiModeEnabled: streamdownHtmlUiMode,
    artifactTheme: stableArtifactTheme,
    initPriorityBase,
    artifactThemeKey,
    onArtifactAction,
    artifactOrigin: stableArtifactOrigin,
    onOpenArtifactCanvas,
    artifactInlineEnabled,
    // The renderer options always carry a concrete pair; only the public prop
    // is optional.
    artifactCanvasEnabled: artifactCanvasEnabled ?? artifactInlineEnabled,
    artifactCodeFirst,
    artifactMaxBytes,
    artifactBlockExternalScripts,
    artifactBlockExternalResources,
    locale,
    ordinalByProjectedStartOffset: artifactProjection.ordinalByProjectedStartOffset,
    fences: artifactProjection.fences,
    onOpenDocument,
    projectPath,
    knowledgeCitations,
  };
  const streamdownRendererOptionsRef = useRef(streamdownRendererOptions);
  streamdownRendererOptionsRef.current = streamdownRendererOptions;
  // Renderer component function identity must survive token and phase changes.
  // Current options are read from the ref when Streamdown invokes a renderer.
  const streamdownComponents = useMemo<Components>(
    () => createStreamdownComponents(streamdownRendererOptionsRef),
    [],
  );
  // One splitter per mounted message: Streamdown re-parses only the block a
  // token lands in, and the index maps block-relative fence offsets back onto
  // the projected markdown the fence index is keyed by.
  const blockIndex = useMemo(() => createMarkdownBlockIndex(), []);
  const StreamBlock = useMemo(() => createMarkdownStreamBlock(blockIndex), [blockIndex]);
  // KaTeX / remark-math stay off the cold main chunk; first markdown mount
  // loads them once. Until then Streamdown still paints text without math.
  const [mathPlugin, setMathPlugin] = useState<StreamdownMathPlugin | null>(() =>
    getStreamdownMathPlugin(),
  );
  useEffect(() => {
    if (mathPlugin) return undefined;
    let cancelled = false;
    void loadStreamdownMathPlugin().then((plugin) => {
      if (!cancelled) setMathPlugin(plugin);
    });
    return () => {
      cancelled = true;
    };
  }, [mathPlugin]);
  const streamdownPlugins = useMemo(
    () => (mathPlugin ? { cjk, math: mathPlugin } : STREAMDOWN_BASE_PLUGINS),
    [mathPlugin],
  );

  return (
    <MarkdownRenderingPhaseProvider phase={phase}>
      <RenderErrorBoundary
        locale={locale}
        surface="markdown"
        resetKey={`${phase}:${streamdownTextForRender.length}`}
      >
        <StreamdownRendererOptionsProvider value={streamdownRendererOptions}>
        <KnowledgeCitationIndexProvider value={knowledgeCitations}>
        <Streamdown
          className={
            shouldShowStreamingCaret
              ? `prose markdown has-stream-caret ${caretRootClass}`
              : 'prose markdown'
          }
          // Live tokens stay on Streamdown's streaming tree. `static` skips remend
          // and re-parses a finished document on every delta. The animate object
          // only disables startTransition; isAnimating stays false so word spans
          // are never injected.
          mode={streamdownMode}
          parseMarkdownIntoBlocksFn={blockIndex.parse}
          BlockComponent={StreamBlock}
          parseIncompleteMarkdown={false}
          isAnimating={false}
          animated={STREAMDOWN_IMMEDIATE_STREAMING}
          plugins={streamdownPlugins}
          components={streamdownComponents}
          controls={false}
          lineNumbers={false}
          skipHtml
          linkSafety={MARKDOWN_LINK_SAFETY}
        >
          {streamdownTextForRender}
        </Streamdown>
        </KnowledgeCitationIndexProvider>
        </StreamdownRendererOptionsProvider>
      </RenderErrorBoundary>
    </MarkdownRenderingPhaseProvider>
  );
}
