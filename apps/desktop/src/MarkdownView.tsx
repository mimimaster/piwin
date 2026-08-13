import {
  cloneElement,
  isValidElement,
  useCallback,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type JSX,
  type ReactElement,
  type ReactNode,
} from 'react';
import { cjk } from '@streamdown/cjk';
import { createMathPlugin } from '@streamdown/math';
import {
  evaluateCodeFence,
  normalizeStreamingArtifactFences,
  type ArtifactActionMessage,
  type ArtifactPreviewDecision,
  type ArtifactThemeVariables,
} from '@piwin/artifact';
import { Button } from '@piwin/ui-kit';
import { Streamdown, type Components, type ExtraProps } from 'streamdown';
import { useHighlight, TokenSpans, normalizeLanguage, type TokenLine } from './syntax-highlight';
import { fileNameFromPath, PathChip } from './path-chip';
import { ArtifactFrame } from './ArtifactFrame';
import { ArtifactCanvasLauncher } from './artifact-canvas-launcher';
import { createArtifactCanvasTarget, type ArtifactCanvasTarget } from './artifact-canvas-model';
import { isFlashcardArtifactSource } from './flashcard-artifact';
import { MermaidBlock } from './MermaidBlock';
import { isMathFenceLanguage, isMermaidFenceLanguage, renderKatex } from './markdown-math';
import { parseUnifiedDiff } from './diff-view';
import { computeDiffLineNumbers } from './diff-line-numbers';
import { CollapsibleContentBlock } from './collapsible-content-block';
import {
  ContextMenuFromCatalog,
  useDesktopContextMenu,
  type ContextMenuTarget,
} from './context-menu';

/** CM-11: code-block surface menu wrapper around a rendered fence. */
function CodeBlockContextMenu(props: {
  source: string;
  language: string;
  children: ReactNode;
}): ReactElement {
  const contextMenu = useDesktopContextMenu();
  const target: ContextMenuTarget | null =
    contextMenu && props.source.trim().length > 0
      ? {
          surface: 'code-block',
          selectedText: props.source,
          label: props.language || 'code',
        }
      : null;
  if (!target || !contextMenu) {
    return <>{props.children}</>;
  }
  return (
    <ContextMenuFromCatalog
      testId="code-block-context-menu"
      target={target}
      caps={contextMenu.caps}
      dispatchers={contextMenu.dispatchers}
    >
      {props.children}
    </ContextMenuFromCatalog>
  );
}

/** C5: explicit rendering phases for coding-agent transcript policy. */
export type MarkdownRenderingPhase = 'streaming' | 'completed' | 'explicit-artifact-review';

type MarkdownViewProps = {
  text: string;
  /**
   * Parser flag: when false, native `html`/`htm` fences are not promoted to
   * artifact descriptors by `evaluateCodeFence`. When omitted, mirrors
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
   * When true (default), HTML Artifact capability is enabled.
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
  /** Security byte cap forwarded to evaluateCodeFence when heavy path runs. */
  artifactMaxBytes?: number;
  /** Locale for Artifact frame copy (recycled preview placeholder). */
  locale?: 'zh-CN' | 'en';
  /** Callback when user clicks a markdown document link or plan document chip. */
  onOpenDocument?: ((doc: { title: string; path?: string; content?: string }) => void) | undefined;
};

const SHELL_LANGUAGES = new Set([
  'bash',
  'sh',
  'zsh',
  'shell',
  'console',
  'terminal',
  'cmd',
  'powershell',
]);

function isShellLanguage(lang?: string): boolean {
  return lang ? SHELL_LANGUAGES.has(lang.trim().toLowerCase()) : false;
}

const STREAMDOWN_PLUGINS = {
  cjk,
  math: createMathPlugin({ singleDollarTextMath: true }),
};
const MARKDOWN_LINK_SAFETY = { enabled: false };
const MARKDOWN_FILE_PATH_PATTERN =
  /(?:file:\/\/|\/|[A-Za-z]:[\\/]|(?:\.\.?\/))+[\w\u4e00-\u9fa5_.\/-]+\.md\b/g;
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
  /**
   * owi-style fence ordinal keyed by the AST start position. Streamdown may
   * invoke a renderer more than once without re-rendering MarkdownView, so a
   * call counter alone eventually changes iframe identity.
   */
  allocateFenceOrdinal: (identity: string) => number;
};

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
): ReactNode {
  if (!onOpenDocument) return text;

  const parts: Array<string | ReactElement> = [];
  let lastIndex = 0;
  let partIndex = 0;
  MARKDOWN_FILE_PATH_PATTERN.lastIndex = 0;

  for (const match of text.matchAll(MARKDOWN_FILE_PATH_PATTERN)) {
    const fullPath = match[0];
    const matchIndex = match.index ?? 0;
    if (matchIndex > lastIndex) {
      parts.push(text.slice(lastIndex, matchIndex));
    }
    parts.push(
      <PathChip
        key={`${keyPrefix}-path-${partIndex++}`}
        fullPath={fullPath}
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
): ReactNode {
  if (typeof children === 'string') return renderMarkdownText(children, onOpenDocument);
  if (!Array.isArray(children)) return children;
  return children.map((child, index) =>
    typeof child === 'string' ? renderMarkdownText(child, onOpenDocument, `text-${index}`) : child,
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
      {renderMarkdownChildren(children, optionsRef.current.onOpenDocument)}
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
          {renderMarkdownChildren(children, optionsRef.current.onOpenDocument)}
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
      const inlineValue = plainTextFromReactNode(children);
      const isMarkdownPath =
        (inlineValue.includes('/') ||
          inlineValue.includes('\\') ||
          inlineValue.startsWith('file://')) &&
        inlineValue.trim().endsWith('.md');
      if (isMarkdownPath && options.onOpenDocument) {
        return (
          <PathChip
            fullPath={inlineValue.trim()}
            onOpen={() =>
              options.onOpenDocument?.({
                title: fileNameFromPath(inlineValue.trim()),
                path: inlineValue.trim(),
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

    const source = plainTextFromReactNode(children).replace(/\n$/, '');
    const languageMatch = /(?:^|\s)language-([A-Za-z0-9_-]+)/.exec(className ?? '');
    const language = languageMatch?.[1] ?? '';
    const rawMetadata = node?.properties?.['metastring'];
    const metadata = typeof rawMetadata === 'string' ? rawMetadata.trim() : '';
    const fenceInfo = metadata ? `${language} ${metadata}` : language;
    const startPosition = node?.position?.start;
    const fenceIdentity =
      typeof startPosition?.offset === 'number'
        ? `offset:${startPosition.offset}`
        : `line:${startPosition?.line ?? 0}:column:${startPosition?.column ?? 0}`;
    // owi: `${rootId}-artifact-${ordinal}`. Cache by AST position because
    // Streamdown can invoke this renderer multiple times for one parse.
    const ordinal = options.allocateFenceOrdinal(fenceIdentity);
    const originKey = options.artifactOrigin?.messageId ?? 'local';
    const fenceProps: Parameters<typeof CodeFenceView>[0] = {
      language,
      fenceInfo,
      source,
      htmlUiModeEnabled: options.htmlUiModeEnabled,
      fenceIndex: ordinal,
      renderingPhase: options.phase,
      initPriority: options.initPriorityBase + ordinal,
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
    return (
      <CodeBlockContextMenu
        key={`${originKey}:artifact-${ordinal}`}
        source={source}
        language={language}
      >
        <CodeFenceView key={`${originKey}:artifact-${ordinal}`} {...fenceProps} />
      </CodeBlockContextMenu>
    );
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

    if (isDocumentLink && options.onOpenDocument) {
      return (
        <PathChip
          fullPath={url}
          label={label}
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

/** Collapsed height for long code fences (~11–12 lines at 13px / 1.35 lh). */
const CODE_FENCE_COLLAPSED_HEIGHT_PX = 200;

/**
 * Line-numbered, syntax-highlighted code body for transcript code fences.
 * Falls back to plain text while shiki is loading. Diff language gets
 * GitHub-style old/new gutters (from hunk headers) plus add/delete backgrounds.
 * Non-diff fences keep sequential 1…n numbering of the fence body.
 * Tall fences auto-collapse behind a gradient mask + expand toggle.
 */
function CodeBodyWithLineNumbers({
  source,
  language,
  defaultCollapsed = true,
  highlightEnabled = true,
}: {
  source: string;
  language: string;
  /** When false (e.g. streaming), keep expanded so new lines stay visible. */
  defaultCollapsed?: boolean;
  /** Streaming blocks stay plain until completion to avoid retaining token trees per delta. */
  highlightEnabled?: boolean;
}): ReactElement {
  const normalizedLang = normalizeLanguage(language);
  const isDiff = normalizedLang === 'diff';
  const lines = useMemo(() => source.split('\n'), [source]);
  const tokenLines = useHighlight(source, normalizedLang, highlightEnabled);
  const diffLineNumbers = useMemo(() => {
    if (!isDiff) return null;
    return computeDiffLineNumbers(parseUnifiedDiff(source));
  }, [isDiff, source]);

  const body = (
    <pre className={`md-code${isDiff ? ' md-code-diff' : ''}`}>
      <div
        className="md-code-content"
        data-language={language || undefined}
        data-syntax-highlight={highlightEnabled ? 'enabled' : 'deferred'}
      >
        {lines.map((line, index) => {
          const tokens: TokenLine | null = tokenLines?.[index] ?? null;
          let lineClass = 'md-code-line';
          if (isDiff) {
            const marker = line.charAt(0);
            if (marker === '+') lineClass += ' diff-line-add';
            else if (marker === '-') lineClass += ' diff-line-delete';
            else lineClass += ' diff-line-context';
          }

          let gutter: ReactNode;
          if (diffLineNumbers) {
            const nums = diffLineNumbers[index];
            gutter = (
              <>
                <span className="md-code-line-num md-code-line-num-old" aria-hidden>
                  {nums?.old ?? ''}
                </span>
                <span className="md-code-line-num md-code-line-num-new" aria-hidden>
                  {nums?.new ?? ''}
                </span>
              </>
            );
          } else {
            gutter = (
              <span className="md-code-line-num" aria-hidden>
                {index + 1}
              </span>
            );
          }

          return (
            <div key={index} className={lineClass}>
              {gutter}
              <span className="md-code-line-text">
                {tokens ? <TokenSpans tokens={tokens} /> : line}
              </span>
            </div>
          );
        })}
      </div>
    </pre>
  );

  return (
    <CollapsibleContentBlock
      maxCollapsedHeight={CODE_FENCE_COLLAPSED_HEIGHT_PX}
      defaultCollapsed={defaultCollapsed}
      className="md-code-collapsible"
    >
      {body}
    </CollapsibleContentBlock>
  );
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

  const streamdownText = normalizeStreamingArtifactFences(text, streamdownHtmlUiMode, !streamMode);
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
  const fenceOrdinalMapRef = useRef(new Map<string, number>());
  const nextFenceOrdinalRef = useRef(0);
  const fenceOwnerKey = stableArtifactOrigin?.messageId ?? 'local';
  const fenceOwnerKeyRef = useRef(fenceOwnerKey);
  if (fenceOwnerKeyRef.current !== fenceOwnerKey) {
    fenceOwnerKeyRef.current = fenceOwnerKey;
    fenceOrdinalMapRef.current.clear();
    nextFenceOrdinalRef.current = 0;
  }
  const allocateFenceOrdinal = useCallback((identity: string): number => {
    const existing = fenceOrdinalMapRef.current.get(identity);
    if (existing !== undefined) {
      return existing;
    }
    const ordinal = nextFenceOrdinalRef.current;
    nextFenceOrdinalRef.current += 1;
    fenceOrdinalMapRef.current.set(identity, ordinal);
    return ordinal;
  }, []);
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
    allocateFenceOrdinal,
    onOpenDocument,
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
    allocateFenceOrdinal,
    onOpenDocument,
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

function CodeFenceView(props: {
  language: string;
  /** Full fence info string including title/surface metadata. */
  fenceInfo: string;
  source: string;
  htmlUiModeEnabled: boolean;
  fenceIndex: number;
  renderingPhase: MarkdownRenderingPhase;
  artifactTheme?: ArtifactThemeVariables;
  initPriority: number;
  artifactThemeKey?: string;
  onArtifactAction?: (action: ArtifactActionMessage) => void;
  artifactOrigin?: { sessionId: string; messageId: string };
  onOpenArtifactCanvas?: (target: ArtifactCanvasTarget) => void;
  artifactPreviewEnabled: boolean;
  artifactCodeFirst?: boolean;
  artifactMaxBytes?: number;
  locale: 'zh-CN' | 'en';
}): ReactElement {
  const streamMode = props.renderingPhase === 'streaming';
  const artifactCodeFirst = props.artifactCodeFirst ?? false;
  // Freeze fence identity on first mount — owi: `${rootId}-artifact-${ordinal}`.
  // Never encode source body into the id (token growth would remount the iframe).
  const stickyFenceIdRef = useRef<string | null>(null);
  if (stickyFenceIdRef.current === null) {
    const origin = props.artifactOrigin?.messageId ?? 'local';
    stickyFenceIdRef.current = `${origin}-artifact-${props.fenceIndex}`;
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

  if (isMermaidFenceLanguage(props.language)) {
    // While streaming an incomplete fence, show source instead of partial mermaid.
    if (streamMode) {
      return (
        <pre className="md-code" data-testid="mermaid-stream-source">
          <code data-language="mermaid">{props.source}</code>
        </pre>
      );
    }
    return <MermaidBlock source={props.source} />;
  }

  if (isMathFenceLanguage(props.language)) {
    return <MathView tex={props.source} display />;
  }

  // Keep one document during streaming and reconcile throttled token snapshots
  // in place. Completion commits one final snapshot, then stops the stream.
  const evaluateOptions: Parameters<typeof evaluateCodeFence>[0] = {
    language: props.fenceInfo,
    source: props.source,
    id: stickyFenceId,
    htmlUiModeEnabled: props.htmlUiModeEnabled,
    mode: streamMode ? 'stream-preview' : 'interactive',
  };
  if (props.artifactMaxBytes !== undefined) {
    evaluateOptions.maxBytes = props.artifactMaxBytes;
  }
  if (props.artifactTheme) {
    evaluateOptions.theme = props.artifactTheme;
  }

  const decision: ArtifactPreviewDecision = evaluateCodeFence(evaluateOptions);
  const isFlashcard = isFlashcardArtifactSource(props.source);
  const isCanvasArtifact = decision.kind !== 'code' && decision.descriptor.surface === 'canvas';
  const decisionLanguage = decision.kind === 'code' ? decision.language : undefined;
  const isShell = isShellLanguage(props.language || decisionLanguage);

  if (streamMode) {
    // No separate waiting state: evaluate mounts the render frame as soon as
    // the fence parses (possibly with an empty body) and stream snapshots
    // draw the UI block by block.
    if (
      props.artifactPreviewEnabled &&
      artifactPreviewOpen &&
      !artifactCodeFirst &&
      !isCanvasArtifact &&
      decision.kind === 'render'
    ) {
      return (
        <div
          className="artifact-with-source artifact-with-source--preview"
          data-artifact-id={stickyFenceId}
          data-testid="artifact-stream-live"
        >
          <div className="artifact-preview-surface">
            <ArtifactFrame
              // Same key in stream and completed branches; theme changes remain a
              // deliberate document boundary, token growth and `done` do not.
              key={`${props.artifactThemeKey ?? 'default'}:${stickyFenceId}`}
              decision={decision}
              initPriority={props.initPriority}
              locale={props.locale}
              {...(props.artifactTheme ? { theme: props.artifactTheme } : {})}
              {...(props.onArtifactAction ? { onArtifactAction: props.onArtifactAction } : {})}
            />
          </div>
          <div className="artifact-side-rail">
            <Button
              variant="ghost"
              size="compact"
              className="artifact-frame-text-action"
              data-testid="artifact-preview-toggle"
              aria-expanded
              onClick={showArtifactSource}
            >
              Show code
            </Button>
          </div>
        </div>
      );
    }

    return (
      <div
        className="md-code-block"
        data-is-shell={isShell ? 'true' : undefined}
        data-testid="code-fence-streaming"
      >
        <div className="md-code-header">
          <div className="md-code-header-title">
            {isShell ? (
              <span className="md-code-shell-icon" aria-hidden="true">
                $
              </span>
            ) : null}
            <span className="md-code-lang muted">
              {props.language || (isShell ? 'bash' : 'code')}
            </span>
          </div>
        </div>
        <CodeBodyWithLineNumbers
          source={props.source}
          language={props.language}
          defaultCollapsed={false}
          highlightEnabled={false}
        />
      </div>
    );
  }

  // Flashcard exception (design §6): when capability is off but the source
  // carries a data-card-id, offer a one-click Preview card that temporarily
  // mounts the heavy path for this fence only — without flipping the global
  // preference.
  if (!props.artifactPreviewEnabled && isFlashcard) {
    const flashcardProps: {
      language: string;
      source: string;
      artifactThemeKey?: string;
      initPriority: number;
      artifactMaxBytes?: number;
      artifactTheme?: ArtifactThemeVariables;
      onArtifactAction?: (action: ArtifactActionMessage) => void;
    } = {
      language: props.language,
      source: props.source,
      initPriority: props.initPriority,
    };
    if (props.artifactThemeKey !== undefined) {
      flashcardProps.artifactThemeKey = props.artifactThemeKey;
    }
    if (props.artifactTheme) {
      flashcardProps.artifactTheme = props.artifactTheme;
    }
    if (props.artifactMaxBytes !== undefined) {
      flashcardProps.artifactMaxBytes = props.artifactMaxBytes;
    }
    if (props.onArtifactAction) {
      flashcardProps.onArtifactAction = props.onArtifactAction;
    }
    return <FlashcardPreviewCard {...flashcardProps} />;
  }

  if (decision.kind === 'render' || decision.kind === 'blocked') {
    // When capability is off, evaluate returned `code` for native html (because
    // htmlUiModeEnabled=false). Explicit artifact-* descriptors still parse,
    // but we must NOT offer the heavy path. Render as ordinary code using the
    // raw props so output stays byte-stable with the capability-on path.
    if (!props.artifactPreviewEnabled) {
      return (
        <div
          className="md-code-block"
          data-is-shell={isShell ? 'true' : undefined}
          data-testid="code-fence-source"
        >
          <div className="md-code-header">
            <div className="md-code-header-title">
              {isShell ? (
                <span className="md-code-shell-icon" aria-hidden="true">
                  $
                </span>
              ) : null}
              <span className="md-code-lang muted">
                {props.language || (isShell ? 'bash' : 'code')}
              </span>
            </div>
            <CopyCodeButton text={props.source} />
          </div>
          <CodeBodyWithLineNumbers
            source={props.source}
            language={props.language}
            highlightEnabled={!streamMode}
          />
        </div>
      );
    }

    if (
      decision.kind === 'render' &&
      decision.descriptor.surface === 'canvas' &&
      props.artifactOrigin &&
      props.onOpenArtifactCanvas
    ) {
      const target = createArtifactCanvasTarget({
        ...props.artifactOrigin,
        fenceIndex: props.fenceIndex,
        descriptor: decision.descriptor,
      });
      return (
        <ArtifactCanvasLauncher
          title={decision.descriptor.title}
          source={decision.descriptor.source}
          rawLanguage={decision.descriptor.rawLanguage}
          onOpenCanvas={() => props.onOpenArtifactCanvas?.(target)}
        />
      );
    }
    const previewLabel = decision.descriptor.type === 'svg' ? 'Preview SVG' : 'Preview';

    // Blocked: no render to show — display source + blocked strip, no toggle.
    if (decision.kind === 'blocked') {
      return (
        <div className="artifact-with-source">
          <div
            className="md-code-block"
            data-is-shell={isShell ? 'true' : undefined}
            data-testid="code-fence-source"
          >
            <div className="md-code-header">
              <div className="md-code-header-title">
                {isShell ? (
                  <span className="md-code-shell-icon" aria-hidden="true">
                    $
                  </span>
                ) : null}
                <span className="md-code-lang muted">{props.language || 'html'}</span>
              </div>
              <CopyCodeButton text={props.source} />
            </div>
            <CodeBodyWithLineNumbers
              source={props.source}
              language={props.language}
              highlightEnabled={!streamMode}
            />
          </div>
          <div className="artifact-blocked muted" data-testid="artifact-blocked" role="status">
            Artifact blocked
            {`: ${decision.reason}`}
          </div>
        </div>
      );
    }

    // render | preparing: in-place toggle. Closed → source code with Preview
    // affordance; open → rendered ArtifactFrame replaces the source in place
    // (no stacked second code block). "Show code" is a sibling side rail —
    // outside the iframe — so it never overlays the art surface.
    return (
      <div
        className={
          artifactPreviewOpen
            ? 'artifact-with-source artifact-with-source--preview'
            : 'artifact-with-source'
        }
      >
        {artifactPreviewOpen ? (
          <>
            <div className="artifact-preview-surface">
              <ArtifactFrame
                key={`${props.artifactThemeKey ?? 'default'}:${stickyFenceId}`}
                decision={decision}
                initPriority={props.initPriority}
                locale={props.locale}
                {...(props.artifactTheme ? { theme: props.artifactTheme } : {})}
                {...(props.onArtifactAction ? { onArtifactAction: props.onArtifactAction } : {})}
              />
            </div>
            <div className="artifact-side-rail">
              <Button
                variant="ghost"
                size="compact"
                className="artifact-frame-text-action"
                data-testid="artifact-preview-toggle"
                aria-expanded
                onClick={showArtifactSource}
              >
                Show code
              </Button>
            </div>
          </>
        ) : (
          <div
            className="md-code-block"
            data-is-shell={isShell ? 'true' : undefined}
            data-testid="code-fence-source"
          >
            <div className="md-code-header">
              <div className="md-code-header-title">
                {isShell ? (
                  <span className="md-code-shell-icon" aria-hidden="true">
                    $
                  </span>
                ) : null}
                <span className="md-code-lang muted">{props.language || 'html'}</span>
              </div>
              <div className="md-code-header-actions">
                <CopyCodeButton text={props.source} />
                <Button
                  size="compact"
                  data-testid="artifact-preview-toggle"
                  aria-expanded={false}
                  onClick={() => setArtifactPreviewOpen(true)}
                >
                  {previewLabel}
                </Button>
              </div>
            </div>
            <CodeBodyWithLineNumbers
              source={props.source}
              language={props.language}
              defaultCollapsed={!artifactSourceExpanded}
              highlightEnabled={!streamMode}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className="md-code-block"
      data-is-shell={isShell ? 'true' : undefined}
      data-testid="code-fence-source"
    >
      <div className="md-code-header">
        <div className="md-code-header-title">
          {isShell ? (
            <span className="md-code-shell-icon" aria-hidden="true">
              $
            </span>
          ) : null}
          <span className="md-code-lang muted">
            {props.language || (isShell ? 'bash' : 'code')}
          </span>
        </div>
        <CopyCodeButton text={props.source} />
      </div>
      <CodeBodyWithLineNumbers
        source={props.source}
        language={props.language}
        highlightEnabled={!streamMode}
      />
    </div>
  );
}

/**
 * Per-fence flashcard Preview card (design §6). Shown when global
 * artifactPreviewEnabled is off but the fence source contains a data-card-id.
 * Mounts the heavy path for this fence only; does not flip the global
 * preference.
 */
function FlashcardPreviewCard(props: {
  language: string;
  source: string;
  artifactTheme?: ArtifactThemeVariables;
  artifactThemeKey?: string;
  initPriority: number;
  artifactMaxBytes?: number;
  onArtifactAction?: (action: ArtifactActionMessage) => void;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const [sourceExpanded, setSourceExpanded] = useState(false);
  if (!open) {
    return (
      <div className="md-code-block" data-testid="code-fence-source">
        <div className="md-code-header">
          <span className="md-code-lang muted">{props.language || 'html'}</span>
          <div className="md-code-header-actions">
            <CopyCodeButton text={props.source} />
            <Button
              size="compact"
              data-testid="flashcard-preview-card"
              onClick={() => setOpen(true)}
            >
              Preview card
            </Button>
          </div>
        </div>
        <CodeBodyWithLineNumbers
          source={props.source}
          language={props.language}
          defaultCollapsed={!sourceExpanded}
        />
      </div>
    );
  }
  const evaluateOptions: Parameters<typeof evaluateCodeFence>[0] = {
    language: props.language,
    source: props.source,
    id: `flashcard-${props.initPriority}`,
    htmlUiModeEnabled: true,
    mode: 'interactive',
  };
  if (props.artifactMaxBytes !== undefined) {
    evaluateOptions.maxBytes = props.artifactMaxBytes;
  }
  if (props.artifactTheme) {
    evaluateOptions.theme = props.artifactTheme;
  }
  const decision = evaluateCodeFence(evaluateOptions);
  return (
    <div className="artifact-with-source artifact-with-source--preview">
      {decision.kind === 'render' ? (
        <>
          <div className="artifact-preview-surface">
            <ArtifactFrame
              key={`${props.artifactThemeKey ?? 'default'}:${decision.descriptor.id}`}
              decision={decision}
              initPriority={props.initPriority}
              {...(props.artifactTheme ? { theme: props.artifactTheme } : {})}
              {...(props.onArtifactAction ? { onArtifactAction: props.onArtifactAction } : {})}
            />
          </div>
          <div className="artifact-side-rail">
            <Button
              variant="ghost"
              size="compact"
              className="artifact-frame-text-action"
              data-testid="flashcard-preview-card"
              aria-expanded
              onClick={() => {
                setSourceExpanded(true);
                setOpen(false);
              }}
            >
              Show code
            </Button>
          </div>
        </>
      ) : decision.kind === 'blocked' ? (
        <div className="artifact-blocked muted" data-testid="artifact-blocked" role="status">
          Artifact blocked{`: ${decision.reason}`}
        </div>
      ) : null}
    </div>
  );
}

function CopyCodeButton(props: { text: string }): ReactElement {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  return (
    <Button
      variant="ghost"
      size="compact"
      data-testid="code-copy-button"
      onClick={() => {
        void (async () => {
          try {
            if (!navigator.clipboard?.writeText) {
              throw new Error('Clipboard unavailable');
            }
            await navigator.clipboard.writeText(props.text);
            setStatus('copied');
            window.setTimeout(() => setStatus('idle'), 1500);
          } catch {
            setStatus('failed');
            window.setTimeout(() => setStatus('idle'), 2000);
          }
        })();
      }}
    >
      {status === 'copied' ? 'Copied' : status === 'failed' ? 'Copy failed' : 'Copy'}
    </Button>
  );
}

function MathView(props: { tex: string; display: boolean }): ReactElement {
  const result = renderKatex(props.tex, props.display);
  if (!result.ok) {
    const fallback = props.display ? `$$${result.source}$$` : `$${result.source}$`;
    if (props.display) {
      return (
        <div
          className="md-math-error md-math-display"
          data-testid="math-error"
          title={result.error}
          role="alert"
        >
          {fallback}
        </div>
      );
    }
    return (
      <span className="md-math-error md-math-inline" data-testid="math-error" title={result.error}>
        {fallback}
      </span>
    );
  }

  if (props.display) {
    return (
      <div
        className="md-math md-math-display"
        data-testid="math-display"
        dangerouslySetInnerHTML={{ __html: result.html }}
      />
    );
  }

  return (
    <span
      className="md-math md-math-inline"
      data-testid="math-inline"
      dangerouslySetInnerHTML={{ __html: result.html }}
    />
  );
}
