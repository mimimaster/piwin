import { useMemo, useState, type ReactElement, type ReactNode } from 'react';
import {
  evaluateCodeFence,
  normalizeStreamingArtifactFences,
  splitMarkdownBlocks,
  type ArtifactActionMessage,
  type ArtifactPreviewDecision,
  type ArtifactThemeVariables,
  type TableAlignment,
} from '@piwin/artifact';
import { Button } from '@piwin/ui-kit';
import { useHighlight, TokenSpans, normalizeLanguage, type TokenLine } from './syntax-highlight';
import { fileNameFromPath, PathChip } from './path-chip';
import { ArtifactFrame } from './ArtifactFrame';
import { isFlashcardArtifactSource } from './flashcard-artifact';
import { MermaidBlock } from './MermaidBlock';
import {
  extractStandaloneDisplayMath,
  isMathFenceLanguage,
  isMermaidFenceLanguage,
  renderKatex,
  tokenizeInlineWithMath,
} from './markdown-math';
import { parseUnifiedDiff } from './diff-view';
import { computeDiffLineNumbers } from './diff-line-numbers';
import { CollapsibleContentBlock } from './collapsible-content-block';

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
  /**
   * When true (default), HTML Artifact capability is enabled.
   */
  artifactPreviewEnabled?: boolean;
  /**
   * When true, artifact blocks display source code first with a preview toggle.
   * When false (default), artifact blocks immediately render dynamic UI.
   */
  artifactCodeFirst?: boolean;
  /** Security byte cap forwarded to evaluateCodeFence when heavy path runs. */
  artifactMaxBytes?: number;
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

function getTextAlign(alignment?: TableAlignment): 'left' | 'center' | 'right' | undefined {
  if (!alignment || alignment === 'default') return undefined;
  return alignment;
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
}: {
  source: string;
  language: string;
  /** When false (e.g. streaming), keep expanded so new lines stay visible. */
  defaultCollapsed?: boolean;
}): ReactElement {
  const normalizedLang = normalizeLanguage(language);
  const isDiff = normalizedLang === 'diff';
  const lines = useMemo(() => source.split('\n'), [source]);
  const tokenLines = useHighlight(source, normalizedLang);
  const diffLineNumbers = useMemo(() => {
    if (!isDiff) return null;
    return computeDiffLineNumbers(parseUnifiedDiff(source));
  }, [isDiff, source]);

  const body = (
    <pre className={`md-code${isDiff ? ' md-code-diff' : ''}`}>
      <div className="md-code-content" data-language={language || undefined}>
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
 * Model HTML never runs in the parent document — only via sandboxed ArtifactFrame.
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
  artifactPreviewEnabled = true,
  artifactCodeFirst = false,
  artifactMaxBytes,
  onOpenDocument,
}: MarkdownViewProps): ReactElement {
  const phase: MarkdownRenderingPhase =
    renderingPhase ?? (streamComplete ? 'completed' : 'streaming');
  const streamMode = phase === 'streaming';
  // Parser flag mirrors the product capability: when off, native html/htm
  // fences fall through to `code` in evaluate (byte-stable normalization).
  const effectiveHtmlUiMode = htmlUiModeEnabled ?? artifactPreviewEnabled;
  const normalized = normalizeStreamingArtifactFences(text, effectiveHtmlUiMode, !streamMode);
  const blocks = splitMarkdownBlocks(normalized);

  return (
    <div className="markdown" data-rendering-phase={phase}>
      {blocks.map((block, index) => {
        if (block.type === 'code') {
          const fenceProps: {
            language: string;
            source: string;
            htmlUiModeEnabled: boolean;
            fenceIndex: number;
            renderingPhase: MarkdownRenderingPhase;
            initPriority: number;
            artifactThemeKey: string;
            artifactTheme?: ArtifactThemeVariables;
            onArtifactAction?: (action: ArtifactActionMessage) => void;
            artifactPreviewEnabled: boolean;
            artifactCodeFirst?: boolean;
            artifactMaxBytes?: number;
          } = {
            language: block.language,
            source: block.source,
            htmlUiModeEnabled: effectiveHtmlUiMode,
            fenceIndex: index,
            renderingPhase: phase,
            initPriority: initPriorityBase + index,
            artifactThemeKey,
            artifactPreviewEnabled,
            artifactCodeFirst,
          };
          if (artifactTheme) {
            fenceProps.artifactTheme = artifactTheme;
          }
          if (onArtifactAction) {
            fenceProps.onArtifactAction = onArtifactAction;
          }
          if (artifactMaxBytes !== undefined) {
            fenceProps.artifactMaxBytes = artifactMaxBytes;
          }
          return <CodeFenceView key={index} {...fenceProps} />;
        }
        if (block.type === 'heading') {
          const HeadingTag = `h${Math.min(6, Math.max(1, block.level))}` as
            'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
          return (
            <HeadingTag key={index} className={`md-h md-h${block.level}`}>
              {renderInline(block.text, onOpenDocument)}
            </HeadingTag>
          );
        }
        if (block.type === 'table') {
          return (
            <div key={index} className="md-table-wrapper" data-testid="md-table">
              <table className="md-table">
                <thead>
                  <tr>
                    {block.headers.map((header, hIdx) => (
                      <th key={hIdx} style={{ textAlign: getTextAlign(block.alignments[hIdx]) }}>
                        {renderInline(header, onOpenDocument)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, rIdx) => (
                    <tr key={rIdx}>
                      {row.map((cell, cIdx) => (
                        <td key={cIdx} style={{ textAlign: getTextAlign(block.alignments[cIdx]) }}>
                          {renderInline(cell, onOpenDocument)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        if (block.type === 'blockquote') {
          if (block.kind) {
            return (
              <div
                key={index}
                className={`md-callout md-callout-${block.kind}`}
                data-testid={`callout-${block.kind}`}
              >
                <div className="md-callout-header">
                  <span className="md-callout-badge">{block.kind.toUpperCase()}</span>
                </div>
                <div className="md-callout-body">{renderInline(block.text, onOpenDocument)}</div>
              </div>
            );
          }
          return (
            <blockquote key={index} className="md-blockquote">
              {renderInline(block.text, onOpenDocument)}
            </blockquote>
          );
        }
        if (block.type === 'list') {
          if (block.ordered) {
            return (
              <ol key={index} className="md-list md-list-ordered">
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>{renderInline(item, onOpenDocument)}</li>
                ))}
              </ol>
            );
          }
          return (
            <ul key={index} className="md-list">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{renderInline(item, onOpenDocument)}</li>
              ))}
            </ul>
          );
        }
        return <ParagraphView key={index} value={block.value} onOpenDocument={onOpenDocument} />;
      })}
      {phase === 'streaming' && text.length > 0 ? (
        <span className="streaming-cursor-pulse" aria-hidden="true" />
      ) : null}
    </div>
  );
}

function ParagraphView(props: {
  value: string;
  onOpenDocument?: ((doc: { title: string; path?: string; content?: string }) => void) | undefined;
}): ReactElement {
  const standaloneMath = extractStandaloneDisplayMath(props.value);
  if (standaloneMath !== null) {
    return <MathView tex={standaloneMath} display />;
  }
  return <p className="md-p">{renderInline(props.value, props.onOpenDocument)}</p>;
}

function CodeFenceView(props: {
  language: string;
  source: string;
  htmlUiModeEnabled: boolean;
  fenceIndex: number;
  renderingPhase: MarkdownRenderingPhase;
  artifactTheme?: ArtifactThemeVariables;
  initPriority: number;
  artifactThemeKey?: string;
  onArtifactAction?: (action: ArtifactActionMessage) => void;
  artifactPreviewEnabled: boolean;
  artifactCodeFirst?: boolean;
  artifactMaxBytes?: number;
}): ReactElement {
  const streamMode = props.renderingPhase === 'streaming';
  const artifactCodeFirst = props.artifactCodeFirst ?? false;
  const [artifactPreviewOpen, setArtifactPreviewOpen] = useState(
    props.renderingPhase === 'explicit-artifact-review' || !artifactCodeFirst,
  );

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

  const evaluateOptions: Parameters<typeof evaluateCodeFence>[0] = {
    language: props.language,
    source: props.source,
    id: `fence-${props.fenceIndex}`,
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
  const decisionLanguage = decision.kind === 'code' ? decision.language : undefined;
  const isShell = isShellLanguage(props.language || decisionLanguage);

  if (streamMode && decision.kind === 'code') {
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

  if (decision.kind === 'render' || decision.kind === 'blocked' || decision.kind === 'preparing') {
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
          <CodeBodyWithLineNumbers source={props.source} language={props.language} />
        </div>
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
            <CodeBodyWithLineNumbers source={props.source} language={props.language} />
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
    // (no stacked second code block). The "Show code" action lives inside the
    // ArtifactFrame header via `extraHeaderAction`.
    return (
      <div
        className={
          artifactPreviewOpen
            ? 'artifact-with-source artifact-with-source--full-bleed'
            : 'artifact-with-source'
        }
      >
        {artifactPreviewOpen ? (
          <ArtifactFrame
            key={`${props.artifactThemeKey ?? 'default'}:${decision.descriptor.id}`}
            decision={decision}
            initPriority={props.initPriority}
            extraHeaderAction={
              <Button
                size="compact"
                data-testid="artifact-preview-toggle"
                aria-expanded
                onClick={() => setArtifactPreviewOpen(false)}
              >
                Show code
              </Button>
            }
            {...(props.onArtifactAction ? { onArtifactAction: props.onArtifactAction } : {})}
          />
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
            <CodeBodyWithLineNumbers source={props.source} language={props.language} />
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
            {decision.language || (isShell ? 'bash' : 'code')}
          </span>
        </div>
        <CopyCodeButton text={decision.source} />
      </div>
      <CodeBodyWithLineNumbers
        source={decision.source}
        language={decision.language ?? props.language}
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
        <CodeBodyWithLineNumbers source={props.source} language={props.language} />
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
    <div className="artifact-with-source">
      {decision.kind === 'render' || decision.kind === 'preparing' ? (
        <ArtifactFrame
          key={`${props.artifactThemeKey ?? 'default'}:${decision.descriptor.id}`}
          decision={decision}
          initPriority={props.initPriority}
          extraHeaderAction={
            <Button
              size="compact"
              data-testid="flashcard-preview-card"
              aria-expanded
              onClick={() => setOpen(false)}
            >
              Show code
            </Button>
          }
          {...(props.onArtifactAction ? { onArtifactAction: props.onArtifactAction } : {})}
        />
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

function renderInline(
  text: string,
  onOpenDocument?: ((doc: { title: string; path?: string; content?: string }) => void) | undefined,
): Array<string | ReactElement> {
  const parts: Array<string | ReactElement> = [];
  let key = 0;

  // Regex pattern to tokenize inline links `[title](url)` alongside normal segments
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;

  for (const segment of tokenizeInlineWithMath(text)) {
    if (segment.kind === 'text') {
      let lastIdx = 0;
      let match: RegExpExecArray | null;

      while ((match = linkRegex.exec(segment.value)) !== null) {
        if (match.index > lastIdx) {
          const subText = segment.value.slice(lastIdx, match.index);
          pushTextWithFilePaths(subText, parts, key, onOpenDocument);
          key += 100;
        }

        const title = match[1] ?? 'Document';
        const url = match[2] ?? '';
        const isDocLink =
          url.endsWith('.md') ||
          title.includes('Plan') ||
          title.includes('Document') ||
          title.startsWith('📄');

        if (isDocLink && onOpenDocument) {
          parts.push(
            <PathChip
              key={key++}
              fullPath={url}
              label={title}
              onOpen={() => onOpenDocument({ title, path: url })}
            />,
          );
        } else {
          parts.push(
            <a key={key++} href={url} target="_blank" rel="noopener noreferrer" className="md-link">
              {title}
            </a>,
          );
        }
        lastIdx = linkRegex.lastIndex;
      }

      if (lastIdx < segment.value.length) {
        const remaining = segment.value.slice(lastIdx);
        pushTextWithFilePaths(remaining, parts, key, onOpenDocument);
        key += 100;
      }
      continue;
    }
    if (segment.kind === 'code') {
      const codeVal = segment.value.trim();
      // Only convert inline code to chip if it contains a path (e.g. /path/to/file.md or ./file.md or file://)
      const isPathMd =
        (codeVal.includes('/') || codeVal.includes('\\') || codeVal.startsWith('file://')) &&
        codeVal.endsWith('.md');

      if (isPathMd && onOpenDocument) {
        parts.push(
          <PathChip
            key={key++}
            fullPath={codeVal}
            onOpen={() => onOpenDocument({ title: fileNameFromPath(codeVal), path: codeVal })}
          />,
        );
      } else {
        parts.push(
          <code key={key++} className="md-inline-code">
            {segment.value}
          </code>,
        );
      }
      continue;
    }
    if (segment.kind === 'strong') {
      parts.push(<strong key={key++}>{segment.value}</strong>);
      continue;
    }
    if (segment.kind === 'em') {
      parts.push(<em key={key++}>{segment.value}</em>);
      continue;
    }
    parts.push(<MathView key={key++} tex={segment.value} display={segment.display} />);
  }
  return parts;
}

function pushTextWithFilePaths(
  text: string,
  parts: Array<string | ReactElement>,
  keyBase: number,
  onOpenDocument?: ((doc: { title: string; path?: string; content?: string }) => void) | undefined,
): void {
  if (!onOpenDocument) {
    parts.push(text);
    return;
  }
  // Match full absolute or relative file paths with slashes ending in .md
  // e.g. /Users/yorickjue/.piwin/workspace/自我介绍.md, ./docs/guide.md, file:///...
  const pathRegex = /(?:file:\/\/|\/|[A-Za-z]:[\\/]|(?:\.\.?\/))+[\w\u4e00-\u9fa5_./-]+\.md\b/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = keyBase;

  while ((match = pathRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const fullPath = match[0];
    parts.push(
      <PathChip
        key={key++}
        fullPath={fullPath}
        onOpen={() => onOpenDocument({ title: fileNameFromPath(fullPath), path: fullPath })}
      />,
    );
    lastIndex = pathRegex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
}
