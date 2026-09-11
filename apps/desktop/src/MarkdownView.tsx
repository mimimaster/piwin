import { useMemo, useRef, type ReactElement } from 'react';
import { cjk } from '@streamdown/cjk';
import { createMathPlugin } from '@streamdown/math';
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
  type StreamdownRendererOptions,
} from './markdown-streamdown.js';
import { escapeRawHtmlInMarkdown } from './markdown-html-escape.js';
import { rewriteLocalFileMarkdownLinks } from './markdown-local-links.js';
import {
  EMPTY_KNOWLEDGE_CITATION_INDEX,
  linkKnowledgeCitationMarkers,
  type KnowledgeCitationIndex,
} from './knowledge/knowledge-citations.js';
import { MarkdownRenderingPhaseProvider } from './markdown-rendering-phase.js';

export type { MarkdownRenderingPhase } from './markdown-code-fence.js';

type MarkdownViewProps = {
  text: string;
  /**
   * Parser flag: when false, native `html`/`htm` fences are not promoted to
   * artifact descriptors by `analyzeArtifactFence`. When omitted, mirrors
   * `artifactPreviewEnabled` so language/source normalization stays
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
   * Artifact capability. Workbench forwards `config.artifact.enabled`.
   * Isolated tests may omit it (defaults to true).
   */
  artifactPreviewEnabled?: boolean;
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

const STREAMDOWN_PLUGINS = {
  cjk,
  // Single-dollar `$...$` collides with env vars (`$HOME`) and prices (`$100`).
  // Keep `$$...$$` / `\(...\)` for real math.
  math: createMathPlugin({ singleDollarTextMath: false }),
};
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
/**
 * Streamdown streaming mode parses each marked block separately, so
 * `node.position.start.offset` is block-relative (often 0). One document block
 * keeps offsets on the projected markdown string used by the fence index.
 */
function parseStreamdownAsSingleDocument(markdown: string): string[] {
  return [markdown];
}
const ARTIFACT_THEME_VARIABLES = [
  '--piwin-artifact-theme',
  '--piwin-artifact-bg',
  '--piwin-artifact-surface',
  '--piwin-artifact-text',
  '--piwin-artifact-muted',
  '--piwin-artifact-accent',
  '--piwin-artifact-border',
  '--piwin-artifact-radius',
  '--piwin-artifact-font',
] as const satisfies readonly (keyof ArtifactThemeVariables)[];

function areArtifactThemesEqual(
  current: ArtifactThemeVariables | undefined,
  next: ArtifactThemeVariables | undefined,
): boolean {
  if (current === next) return true;
  if (!current || !next) return false;
  return ARTIFACT_THEME_VARIABLES.every((variable) => current[variable] === next[variable]);
}

/**
 * Chat maps the active manifest to a fresh object on every text delta. Keep a
 * value-equivalent theme reference stable so Streamdown's component registry
 * does not change type and remount the Artifact iframe for every token.
 */
function useStableArtifactTheme(
  theme: ArtifactThemeVariables | undefined,
): ArtifactThemeVariables | undefined {
  const stableThemeRef = useRef<ArtifactThemeVariables | undefined>(theme);
  if (!areArtifactThemesEqual(stableThemeRef.current, theme)) {
    stableThemeRef.current = theme;
  }
  return stableThemeRef.current;
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
  artifactPreviewEnabled = true,
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

  const streamdownHtmlUiMode = htmlUiModeEnabled ?? artifactPreviewEnabled;
  const stableArtifactTheme = useStableArtifactTheme(artifactTheme);
  const stableArtifactOrigin = useMemo(
    () =>
      artifactOrigin
        ? { sessionId: artifactOrigin.sessionId, messageId: artifactOrigin.messageId }
        : undefined,
    [artifactOrigin?.sessionId, artifactOrigin?.messageId],
  );

  const artifactProjection = useMemo(
    () =>
      projectArtifactMarkdownForRender(
        escapeRawHtmlInMarkdown(
          linkKnowledgeCitationMarkers(rewriteLocalFileMarkdownLinks(text), knowledgeCitations),
        ),
        !streamMode,
      ),
    [text, streamMode, knowledgeCitations],
  );
  const streamdownText = artifactProjection.markdown;
  const shouldShowStreamingCaret = streamMode && showStreamingCaret && text.trim().length > 0;
  // Streamdown treats a trailing blank line as a separate streaming block.
  // That would put the caret on an otherwise empty line, so remove only the
  // transient trailing line break from the live render. The stored message is
  // unchanged and the next real token will restore the intended Markdown.
  const streamdownTextForRender = shouldShowStreamingCaret
    ? streamdownText.replace(/(?:\r?\n)+$/u, '')
    : streamdownText;
  // History can use Streamdown's cheaper static path. Once this mounted
  // message has rendered live tokens, it must retain the keyed block tree
  // through completion or custom code fences (and their iframes) unmount.
  const usedStreamingRendererRef = useRef(streamMode);
  if (streamMode) {
    usedStreamingRendererRef.current = true;
  }
  const streamdownMode = usedStreamingRendererRef.current ? 'streaming' : 'static';
  const streamdownRendererOptionsRef = useRef<StreamdownRendererOptions>({
    phase,
    htmlUiModeEnabled: streamdownHtmlUiMode,
    artifactTheme: stableArtifactTheme,
    initPriorityBase,
    artifactThemeKey,
    onArtifactAction,
    artifactOrigin: stableArtifactOrigin,
    onOpenArtifactCanvas,
    artifactPreviewEnabled,
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
  });
  streamdownRendererOptionsRef.current = {
    phase,
    htmlUiModeEnabled: streamdownHtmlUiMode,
    artifactTheme: stableArtifactTheme,
    initPriorityBase,
    artifactThemeKey,
    onArtifactAction,
    artifactOrigin: stableArtifactOrigin,
    onOpenArtifactCanvas,
    artifactPreviewEnabled,
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
  // Renderer component function identity must survive token and phase changes.
  // Current options are read from the ref when Streamdown invokes a renderer.
  const streamdownComponents = useMemo<Components>(
    () => createStreamdownComponents(streamdownRendererOptionsRef),
    [],
  );

  return (
    <MarkdownRenderingPhaseProvider phase={phase}>
      <Streamdown
        className={shouldShowStreamingCaret ? 'prose markdown has-stream-caret' : 'prose markdown'}
        // Live tokens stay on Streamdown's streaming tree. `static` skips remend
        // and re-parses a finished document on every delta. The animate object
        // only disables startTransition; isAnimating stays false so word spans
        // are never injected.
        mode={streamdownMode}
        parseMarkdownIntoBlocksFn={parseStreamdownAsSingleDocument}
        parseIncompleteMarkdown={streamMode}
        isAnimating={false}
        animated={STREAMDOWN_IMMEDIATE_STREAMING}
        plugins={STREAMDOWN_PLUGINS}
        components={streamdownComponents}
        controls={false}
        lineNumbers={false}
        skipHtml
        linkSafety={MARKDOWN_LINK_SAFETY}
      >
        {streamdownTextForRender}
      </Streamdown>
    </MarkdownRenderingPhaseProvider>
  );
}
