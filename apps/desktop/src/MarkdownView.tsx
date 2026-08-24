import {
  cloneElement,
  isValidElement,
  useMemo,
  useRef,
  type ComponentProps,
  type JSX,
  type ReactElement,
  type ReactNode,
} from 'react';
import { cjk } from '@streamdown/cjk';
import { createMathPlugin } from '@streamdown/math';
import {
  STREAMING_ARTIFACT_FENCE_MARKER,
  projectArtifactMarkdownForRender,
  type ArtifactActionMessage,
  type ArtifactFenceRecord,
  type ArtifactThemeVariables,
} from '@piwin/artifact';
import { Streamdown, type Components, type ExtraProps } from 'streamdown';
import { fileNameFromPath, PathChip } from './path-chip';
import type { ArtifactCanvasTarget } from './artifact-canvas-model';
import {
  MarkdownCodeFence,
  type MarkdownCodeFenceProps,
  type MarkdownRenderingPhase,
} from './markdown-code-fence';
import { isLocalFilesystemMarkdownMediaSrc } from './media-path';
import {
  isLocalFileMarkdownHref,
  isLocalPathChipCandidate,
  MARKDOWN_LOCAL_PATH_TEXT_PATTERN,
  rewriteLocalFileMarkdownLinks,
} from './markdown-local-links.js';

export type { MarkdownRenderingPhase } from './markdown-code-fence';

type MarkdownViewProps = {
  text: string;
  /**
   * Parser flag: when false, native `html`/`htm` fences are not promoted to
   * artifact descriptors by `analyzeArtifactFence`. When omitted, mirrors
   * `artifactPreviewEnabled` (design §5.2) so language/source normalization
   * stays byte-stable across capability toggles.
   */
  htmlUiModeEnabled?: boolean;
  /**
   * @deprecated Prefer `renderingPhase`. false maps to streaming.
   */
  streamComplete?: boolean;
  /**
   * streaming — safe Markdown, source-only fences, no Artifact/Mermaid execution.
   * completed — full Markdown; Artifact requires explicit Preview action.
   * explicit-artifact-review — allow auto-preview for completed HTML candidates.
   */
  renderingPhase?: MarkdownRenderingPhase;
  /** Optional artifact CSS vars from active desktop theme. */
  artifactTheme?: ArtifactThemeVariables;
  /** Base priority for init queue (higher = sooner). */
  initPriorityBase?: number;
  /** Bumped on theme switch so ArtifactFrame remounts with new tokens. */
  artifactThemeKey?: string;
  /** Forwarded to ArtifactFrame for whitelisted artifact actions (flashcards). */
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
   * When true, artifact blocks display source code first with a preview toggle.
   * When false (default), artifact blocks immediately render dynamic UI.
   */
  artifactCodeFirst?: boolean;
  /** Security byte cap forwarded to analyzeArtifactFence when heavy path runs. */
  artifactMaxBytes?: number;
  /** Locale for Artifact frame copy (recycled preview placeholder). */
  locale?: 'zh-CN' | 'en';
  /** Callback when user clicks a markdown document link or plan document chip. */
  onOpenDocument?: ((doc: { title: string; path?: string; content?: string }) => void) | undefined;
  /** Active project root — resolves relative path chips and enables Save As / Reveal. */
  projectPath?: string | null | undefined;
};

const STREAMDOWN_PLUGINS = {
  cjk,
  math: createMathPlugin({ singleDollarTextMath: true }),
};
const MARKDOWN_LINK_SAFETY = { enabled: false };
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

type MarkdownDocumentReference = {
  title: string;
  path?: string;
  content?: string;
};

type StreamdownRendererOptions = {
  phase: MarkdownRenderingPhase;
  htmlUiModeEnabled: boolean;
  artifactTheme: ArtifactThemeVariables | undefined;
  initPriorityBase: number;
  artifactThemeKey: string;
  onArtifactAction: ((action: ArtifactActionMessage) => void) | undefined;
  artifactOrigin: { sessionId: string; messageId: string } | undefined;
  onOpenArtifactCanvas: ((target: ArtifactCanvasTarget) => void) | undefined;
  artifactPreviewEnabled: boolean;
  artifactCodeFirst: boolean;
  artifactMaxBytes: number | undefined;
  locale: 'zh-CN' | 'en';
  onOpenDocument: ((doc: MarkdownDocumentReference) => void) | undefined;
  projectPath: string | null | undefined;
  /** Canonical fence ordinal keyed by Streamdown `node.position.start.offset`. */
  ordinalByProjectedStartOffset: ReadonlyMap<number, number>;
  fences: readonly ArtifactFenceRecord[];
};

function lookupIndexedFence(
  options: StreamdownRendererOptions,
  startOffset: number | undefined,
): ArtifactFenceRecord | null {
  if (typeof startOffset !== 'number') {
    return null;
  }
  const ordinal = options.ordinalByProjectedStartOffset.get(startOffset);
  if (ordinal === undefined) {
    return null;
  }
  return options.fences.find((fence) => fence.ordinal === ordinal) ?? null;
}

function streamingFenceInfo(record: ArtifactFenceRecord, streaming: boolean): string {
  if (!streaming || !record.open) {
    return record.info;
  }
  const alias = record.language.toLowerCase();
  if (alias !== 'html' && alias !== 'htm' && alias !== 'svg') {
    return record.info;
  }
  if (record.info.includes(STREAMING_ARTIFACT_FENCE_MARKER)) {
    return record.info;
  }
  return `${record.info} ${STREAMING_ARTIFACT_FENCE_MARKER}`;
}

type StreamdownElementProps<Tag extends keyof JSX.IntrinsicElements> = ComponentProps<Tag> &
  ExtraProps;

type StreamdownCodeProps = StreamdownElementProps<'code'> & {
  'data-block'?: boolean | string;
};

function mergeMarkdownClassNames(base: string, className?: string): string {
  return className ? `${base} ${className}` : base;
}

function plainTextFromReactNode(value: ReactNode): string {
  if (value === null || value === undefined || typeof value === 'boolean') return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(plainTextFromReactNode).join('');
  if (isValidElement(value)) {
    const element = value as ReactElement<{ children?: ReactNode }>;
    return plainTextFromReactNode(element.props.children);
  }
  return '';
}

function renderMarkdownText(
  text: string,
  onOpenDocument: ((doc: MarkdownDocumentReference) => void) | undefined,
  keyPrefix = 'text',
  projectPath?: string | null,
): ReactNode {
  if (!onOpenDocument) return text;

  const parts: Array<string | ReactElement> = [];
  let lastIndex = 0;
  let partIndex = 0;
  MARKDOWN_LOCAL_PATH_TEXT_PATTERN.lastIndex = 0;

  for (const match of text.matchAll(MARKDOWN_LOCAL_PATH_TEXT_PATTERN)) {
    const fullPath = match[0];
    if (!isLocalPathChipCandidate(fullPath)) {
      continue;
    }
    const matchIndex = match.index ?? 0;
    if (matchIndex < lastIndex) {
      continue;
    }
    if (matchIndex > lastIndex) {
      parts.push(text.slice(lastIndex, matchIndex));
    }
    parts.push(
      <PathChip
        key={`${keyPrefix}-path-${partIndex++}`}
        fullPath={fullPath}
        {...(projectPath ? { projectPath } : {})}
        onOpen={() => onOpenDocument({ title: fileNameFromPath(fullPath), path: fullPath })}
      />,
    );
    lastIndex = matchIndex + fullPath.length;
  }

  if (parts.length === 0) return text;
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}

function renderMarkdownChildren(
  children: ReactNode,
  onOpenDocument: ((doc: MarkdownDocumentReference) => void) | undefined,
  projectPath?: string | null,
): ReactNode {
  if (typeof children === 'string')
    return renderMarkdownText(children, onOpenDocument, 'text', projectPath);
  if (!Array.isArray(children)) return children;
  return children.map((child, index) =>
    typeof child === 'string'
      ? renderMarkdownText(child, onOpenDocument, `text-${index}`, projectPath)
      : child,
  );
}

function stripLeadingCalloutMarker(value: ReactNode): ReactNode {
  let removed = false;
  const markerPattern = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i;

  const strip = (current: ReactNode): ReactNode => {
    if (removed) return current;
    if (typeof current === 'string') {
      const next = current.replace(markerPattern, '');
      if (next !== current) removed = true;
      return next;
    }
    if (Array.isArray(current)) return current.map(strip);
    if (isValidElement(current)) {
      const element = current as ReactElement<{ children?: ReactNode }>;
      return cloneElement(element, { children: strip(element.props.children) });
    }
    return current;
  };

  return strip(value);
}

function createStreamdownComponents(optionsRef: {
  current: StreamdownRendererOptions;
}): Components {
  const renderParagraph = ({
    children,
    node: _node,
    className,
    ...props
  }: StreamdownElementProps<'p'>): ReactElement => (
    <p {...props} className={mergeMarkdownClassNames('md-p', className)}>
      {renderMarkdownChildren(
        children,
        optionsRef.current.onOpenDocument,
        optionsRef.current.projectPath,
      )}
    </p>
  );

  const renderHeading =
    (level: number) =>
    ({
      children,
      node: _node,
      className,
      ...props
    }: StreamdownElementProps<'h1'>): ReactElement => {
      const HeadingTag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
      return (
        <HeadingTag {...props} className={mergeMarkdownClassNames(`md-h md-h${level}`, className)}>
          {renderMarkdownChildren(
            children,
            optionsRef.current.onOpenDocument,
            optionsRef.current.projectPath,
          )}
        </HeadingTag>
      );
    };

  const renderList = (
    { children, node: _node, className }: StreamdownElementProps<'ul'>,
    ordered: boolean,
  ): ReactElement => {
    const ListTag = ordered ? 'ol' : 'ul';
    return (
      <ListTag
        className={mergeMarkdownClassNames(
          ordered ? 'md-list md-list-ordered' : 'md-list',
          className,
        )}
      >
        {children}
      </ListTag>
    );
  };

  const renderCode = ({
    children,
    className,
    node,
    'data-block': dataBlock,
    ...props
  }: StreamdownCodeProps): ReactElement => {
    const options = optionsRef.current;
    if (dataBlock === undefined) {
      const inlineValue = plainTextFromReactNode(children).trim();
      if (isLocalPathChipCandidate(inlineValue) && options.onOpenDocument) {
        return (
          <PathChip
            fullPath={inlineValue}
            {...(options.projectPath ? { projectPath: options.projectPath } : {})}
            onOpen={() =>
              options.onOpenDocument?.({
                title: fileNameFromPath(inlineValue),
                path: inlineValue,
              })
            }
          />
        );
      }
      return (
        <code {...props} className={mergeMarkdownClassNames('md-inline-code', className)}>
          {children}
        </code>
      );
    }

    const startOffset = node?.position?.start?.offset;
    const record = lookupIndexedFence(options, startOffset);
    const originKey = options.artifactOrigin?.messageId ?? 'local';
    const languageMatch = /(?:^|\s)language-([A-Za-z0-9_-]+)/.exec(className ?? '');
    const fallbackLanguage = languageMatch?.[1] ?? '';
    const fenceProps: MarkdownCodeFenceProps = {
      language: record?.language ?? fallbackLanguage,
      fenceInfo: record
        ? streamingFenceInfo(record, options.phase === 'streaming')
        : fallbackLanguage,
      source: record?.source ?? plainTextFromReactNode(children).replace(/\n$/, ''),
      htmlUiModeEnabled: options.htmlUiModeEnabled,
      fenceIndex: record?.ordinal ?? null,
      renderingPhase: options.phase,
      initPriority:
        record === null ? options.initPriorityBase : options.initPriorityBase + record.ordinal,
      artifactThemeKey: options.artifactThemeKey,
      artifactPreviewEnabled: options.artifactPreviewEnabled,
      artifactCodeFirst: options.artifactCodeFirst,
      locale: options.locale,
    };
    if (options.artifactTheme) fenceProps.artifactTheme = options.artifactTheme;
    if (options.onArtifactAction) fenceProps.onArtifactAction = options.onArtifactAction;
    if (options.artifactOrigin) fenceProps.artifactOrigin = options.artifactOrigin;
    if (options.onOpenArtifactCanvas) {
      fenceProps.onOpenArtifactCanvas = options.onOpenArtifactCanvas;
    }
    if (options.artifactMaxBytes !== undefined) {
      fenceProps.artifactMaxBytes = options.artifactMaxBytes;
    }
    // Stable React key (owi __displayKey): never include source body.
    const fenceKey =
      record === null
        ? `${originKey}:code-unbound:${typeof startOffset === 'number' ? String(startOffset) : 'none'}`
        : `${originKey}:artifact-${record.ordinal}`;
    return <MarkdownCodeFence key={fenceKey} {...fenceProps} />;
  };

  const renderAnchor = ({
    children,
    href,
    node: _node,
    className,
    ...props
  }: StreamdownElementProps<'a'>): ReactElement => {
    const options = optionsRef.current;
    const url = href ?? '';
    const label = plainTextFromReactNode(children).trim() || 'Document';
    const normalizedUrl = url.split('#', 1)[0]?.split('?', 1)[0]?.toLowerCase() ?? '';
    const isDocumentLink =
      normalizedUrl.endsWith('.md') ||
      label.includes('Plan') ||
      label.includes('Document') ||
      label.startsWith('📄');
    const isLocalPathLink = isLocalFileMarkdownHref(url);

    if ((isDocumentLink || isLocalPathLink) && options.onOpenDocument) {
      return (
        <PathChip
          fullPath={url}
          label={label}
          {...(options.projectPath ? { projectPath: options.projectPath } : {})}
          onOpen={() => options.onOpenDocument?.({ title: label, path: url })}
        />
      );
    }

    return (
      <a
        {...props}
        {...(href ? { href } : {})}
        className={mergeMarkdownClassNames('md-link', className)}
        target="_blank"
        rel="noopener noreferrer"
      >
        {children}
      </a>
    );
  };

  const renderTable = ({
    children,
    node: _node,
    className,
    ...props
  }: StreamdownElementProps<'table'>): ReactElement => (
    <div className="md-table-wrapper" data-testid="md-table">
      <table {...props} className={mergeMarkdownClassNames('md-table', className)}>
        {children}
      </table>
    </div>
  );

  const renderTableCell = ({
    children,
    node: _node,
    align,
    style,
    ...props
  }: StreamdownElementProps<'th'>): ReactElement => {
    const textAlign =
      align === 'left' || align === 'center' || align === 'right' ? align : undefined;
    return (
      <th {...props} style={textAlign ? { ...style, textAlign } : style}>
        {renderMarkdownChildren(children, optionsRef.current.onOpenDocument)}
      </th>
    );
  };

  const renderTableDataCell = ({
    children,
    node: _node,
    align,
    style,
    ...props
  }: StreamdownElementProps<'td'>): ReactElement => {
    const textAlign =
      align === 'left' || align === 'center' || align === 'right' ? align : undefined;
    return (
      <td {...props} style={textAlign ? { ...style, textAlign } : style}>
        {renderMarkdownChildren(children, optionsRef.current.onOpenDocument)}
      </td>
    );
  };

  const renderBlockquote = ({
    children,
    node: _node,
    className,
    ...props
  }: StreamdownElementProps<'blockquote'>): ReactElement =>
    (() => {
      const calloutMatch = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i.exec(
        plainTextFromReactNode(children),
      );
      if (calloutMatch?.[1]) {
        const kind = calloutMatch[1].toLowerCase();
        return (
          <div
            className={mergeMarkdownClassNames(`md-callout md-callout-${kind}`, className)}
            data-testid={`callout-${kind}`}
          >
            <div className="md-callout-header">
              <span className="md-callout-badge">{kind.toUpperCase()}</span>
            </div>
            <div className="md-callout-body">{stripLeadingCalloutMarker(children)}</div>
          </div>
        );
      }
      return (
        <blockquote {...props} className={mergeMarkdownClassNames('md-blockquote', className)}>
          {children}
        </blockquote>
      );
    })();

  const renderImage = ({
    node: _node,
    alt,
    src,
    ...props
  }: StreamdownElementProps<'img'>): ReactElement => {
    if (!src) return <span className="md-image-fallback">{alt || 'Image unavailable'}</span>;
    if (isLocalFilesystemMarkdownMediaSrc(src)) {
      return <></>;
    }
    return <img {...props} src={src} alt={alt ?? ''} loading="lazy" referrerPolicy="no-referrer" />;
  };

  const renderInput = ({
    node: _node,
    className,
    ...props
  }: StreamdownElementProps<'input'>): ReactElement => (
    <input
      {...props}
      type={props.type ?? 'checkbox'}
      disabled
      className={mergeMarkdownClassNames('md-task-checkbox', className)}
    />
  );

  return {
    p: renderParagraph,
    h1: renderHeading(1),
    h2: renderHeading(2),
    h3: renderHeading(3),
    h4: renderHeading(4),
    h5: renderHeading(5),
    h6: renderHeading(6),
    ul: (props) => renderList(props, false),
    ol: (props) => renderList(props, true),
    li: ({ children, node: _node, className, ...props }: StreamdownElementProps<'li'>) => (
      <li {...props} className={mergeMarkdownClassNames('md-list-item', className)}>
        {children}
      </li>
    ),
    blockquote: renderBlockquote,
    table: renderTable,
    th: renderTableCell,
    td: renderTableDataCell,
    code: renderCode,
    pre: ({ children, node: _node }: StreamdownElementProps<'pre'>) =>
      isValidElement<StreamdownCodeProps>(children) ? (
        cloneElement(children, { 'data-block': 'true' })
      ) : (
        <>{children}</>
      ),
    a: renderAnchor,
    img: renderImage,
    input: renderInput,
    hr: ({ node: _node, className, ...props }: StreamdownElementProps<'hr'>) => (
      <hr {...props} className={mergeMarkdownClassNames('md-hr', className)} />
    ),
    del: ({ children, node: _node, className, ...props }: StreamdownElementProps<'del'>) => (
      <del {...props} className={mergeMarkdownClassNames('md-del', className)}>
        {children}
      </del>
    ),
  };
}

/**
 * Markdown renderer with optional HTML Artifact previews, KaTeX, and Mermaid.
 * Inert model HTML is sanitized into an isolated Shadow DOM; executable or
 * externally-referenced content stays inside sandboxed ArtifactFrame.
 * Math/Mermaid failures soft-degrade (show source); they must not crash the shell.
 */
export function MarkdownView({
  text,
  htmlUiModeEnabled,
  streamComplete = true,
  renderingPhase,
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
  locale = 'en',
  onOpenDocument,
  projectPath = null,
}: MarkdownViewProps): ReactElement {
  const phase: MarkdownRenderingPhase =
    renderingPhase ?? (streamComplete ? 'completed' : 'streaming');
  const streamMode = phase === 'streaming';

  // Streamdown owns the Markdown grammar and streaming recovery. Piwin keeps
  // the surrounding product renderers (ArtifactFrame, shell disclosure,
  // Mermaid and path chips) behind its custom component boundary.
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
      projectArtifactMarkdownForRender(rewriteLocalFileMarkdownLinks(text), !streamMode),
    [text, streamMode],
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
  // message has rendered live tokens, however, it must retain the keyed block
  // tree through completion or custom code fences (and their iframes) unmount.
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
    locale,
    ordinalByProjectedStartOffset: artifactProjection.ordinalByProjectedStartOffset,
    fences: artifactProjection.fences,
    onOpenDocument,
    projectPath,
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
    locale,
    ordinalByProjectedStartOffset: artifactProjection.ordinalByProjectedStartOffset,
    fences: artifactProjection.fences,
    onOpenDocument,
    projectPath,
  };
  // Renderer component function identity must survive token and phase changes.
  // Current options are read from the ref when Streamdown invokes a renderer.
  const streamdownComponents = useMemo<Components>(
    () => createStreamdownComponents(streamdownRendererOptionsRef),
    [],
  );

  return (
    <Streamdown
      className="markdown"
      // Streamdown renders `static` and `streaming` through different React
      // trees. A live message keeps its keyed block tree through completion;
      // completion only turns off repair, animation state and the caret.
      mode={streamdownMode}
      parseMarkdownIntoBlocksFn={parseStreamdownAsSingleDocument}
      parseIncompleteMarkdown={streamMode}
      isAnimating={streamMode}
      animated={false}
      {...(shouldShowStreamingCaret ? { caret: 'block' as const } : {})}
      plugins={STREAMDOWN_PLUGINS}
      components={streamdownComponents}
      controls={false}
      lineNumbers={false}
      skipHtml
      linkSafety={MARKDOWN_LINK_SAFETY}
    >
      {streamdownTextForRender}
    </Streamdown>
  );
}
