import { useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import {
  evaluateCodeFence,
  resolveArtifactPresentation,
  type ArtifactActionMessage,
  type ArtifactPreviewDecision,
  type ArtifactThemeVariables,
} from '@piwin/artifact';
import { Button, IconButton, IconCode } from '@piwin/ui-kit';
import { ArtifactFrame } from './ArtifactFrame';
import { ArtifactCanvasLauncher } from './artifact-canvas-launcher';
import { createArtifactCanvasTarget, type ArtifactCanvasTarget } from './artifact-canvas-model';
import { CodeBlockContextMenu } from './code-block-context-menu.js';
import { CollapsibleContentBlock } from './collapsible-content-block';
import { computeDiffLineNumbers } from './diff-line-numbers';
import { parseUnifiedDiff } from './diff-view';
import { isFlashcardArtifactSource } from './flashcard-artifact';
import { isMathFenceLanguage, isMermaidFenceLanguage, renderKatex } from './markdown-math';
import { MermaidBlock } from './MermaidBlock';
import { normalizeLanguage, TokenSpans, useHighlight, type TokenLine } from './syntax-highlight';

export type MarkdownRenderingPhase = 'streaming' | 'completed' | 'explicit-artifact-review';

export type MarkdownCodeFenceProps = {
  language: string;
  /** Full fence info string including title/surface metadata. */
  fenceInfo: string;
  source: string;
  htmlUiModeEnabled: boolean;
  /** Canonical index ordinal. Null means this fence is not bound — render as ordinary code. */
  fenceIndex: number | null;
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
const CODE_FENCE_COLLAPSED_HEIGHT_PX = 200;
const CODE_FENCE_PREVIEW_LINES = 8;

export function MarkdownCodeFence(props: MarkdownCodeFenceProps): ReactElement {
  return (
    <CodeBlockContextMenu source={props.source} language={props.language}>
      <CodeFenceView {...props} />
    </CodeBlockContextMenu>
  );
}

function isShellLanguage(language?: string): boolean {
  return language ? SHELL_LANGUAGES.has(language.trim().toLowerCase()) : false;
}

function CodeLinesRenderer({
  lines,
  source,
  language,
  isDiff,
  highlightEnabled,
}: {
  lines: string[];
  source: string;
  language: string;
  isDiff: boolean;
  highlightEnabled: boolean;
}): ReactElement {
  const normalizedLanguage = normalizeLanguage(language);
  const tokenLines = useHighlight(source, normalizedLanguage, highlightEnabled);
  const diffLineNumbers = useMemo(() => {
    if (!isDiff) return null;
    return computeDiffLineNumbers(parseUnifiedDiff(source));
  }, [isDiff, source]);

  return (
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
            const numbers = diffLineNumbers[index];
            gutter = (
              <>
                <span className="md-code-line-num md-code-line-num-old" aria-hidden>
                  {numbers?.old ?? ''}
                </span>
                <span className="md-code-line-num md-code-line-num-new" aria-hidden>
                  {numbers?.new ?? ''}
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
}

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
  const normalizedLanguage = normalizeLanguage(language);
  const isDiff = normalizedLanguage === 'diff';
  const lines = useMemo(() => source.split('\n'), [source]);
  const isTall = lines.length > 12;
  const previewLines = useMemo(
    () => (isTall ? lines.slice(0, CODE_FENCE_PREVIEW_LINES) : lines),
    [isTall, lines],
  );
  const previewSource = useMemo(
    () => (isTall ? previewLines.join('\n') : source),
    [isTall, previewLines, source],
  );

  return (
    <CollapsibleContentBlock
      maxCollapsedHeight={CODE_FENCE_COLLAPSED_HEIGHT_PX}
      defaultCollapsed={defaultCollapsed}
      expandable={isTall}
      className="md-code-collapsible"
      renderCollapsed={() => (
        <CodeLinesRenderer
          lines={previewLines}
          source={previewSource}
          language={language}
          isDiff={isDiff}
          highlightEnabled={highlightEnabled}
        />
      )}
      renderExpanded={() => (
        <CodeLinesRenderer
          lines={lines}
          source={source}
          language={language}
          isDiff={isDiff}
          highlightEnabled={highlightEnabled}
        />
      )}
    >
      <CodeLinesRenderer
        lines={lines}
        source={source}
        language={language}
        isDiff={isDiff}
        highlightEnabled={highlightEnabled}
      />
    </CollapsibleContentBlock>
  );
}

function CodeFenceView(props: MarkdownCodeFenceProps): ReactElement {
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

  if (isMermaidFenceLanguage(props.language)) {
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

  if (boundFenceIndex === null || stickyFenceId === null) {
    return (
      <SourceCodeBlock
        language={props.language}
        source={props.source}
        isShell={isShellLanguage(props.language)}
        streaming={streamMode}
      />
    );
  }

  const evaluateOptions: Parameters<typeof evaluateCodeFence>[0] = {
    language: props.fenceInfo,
    source: props.source,
    id: stickyFenceId,
    htmlUiModeEnabled: props.htmlUiModeEnabled,
    mode: streamMode ? 'stream-preview' : 'interactive',
  };
  if (props.artifactMaxBytes !== undefined) evaluateOptions.maxBytes = props.artifactMaxBytes;
  if (props.artifactTheme) evaluateOptions.theme = props.artifactTheme;

  const decision: ArtifactPreviewDecision = evaluateCodeFence(evaluateOptions);
  const presentation =
    decision.kind === 'render'
      ? resolveArtifactPresentation({
          descriptor: decision.descriptor,
          mode: decision.mode,
          source: decision.renderSource,
        })
      : null;
  const isFlashcard = isFlashcardArtifactSource(props.source);
  const decisionLanguage = decision.kind === 'code' ? decision.language : undefined;
  const isShell = isShellLanguage(props.language || decisionLanguage);

  if (streamMode) {
    if (
      props.artifactPreviewEnabled &&
      artifactPreviewOpen &&
      !artifactCodeFirst &&
      presentation?.kind === 'inline-sandbox' &&
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
              key={`${props.artifactThemeKey ?? 'default'}:${stickyFenceId}`}
              decision={decision}
              initPriority={props.initPriority}
              locale={props.locale}
              {...(props.artifactTheme ? { theme: props.artifactTheme } : {})}
              {...(props.onArtifactAction ? { onArtifactAction: props.onArtifactAction } : {})}
            />
          </div>
          <div className="artifact-floating-actions">
            <IconButton
              label="Show code"
              title="Show code"
              className="artifact-floating-action-button"
              data-testid="artifact-preview-toggle"
              aria-expanded
              onClick={showArtifactSource}
            >
              <IconCode size={14} />
            </IconButton>
          </div>
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

  if (!props.artifactPreviewEnabled && isFlashcard) {
    return (
      <FlashcardPreviewCard
        language={props.language}
        source={props.source}
        initPriority={props.initPriority}
        {...(props.artifactThemeKey !== undefined
          ? { artifactThemeKey: props.artifactThemeKey }
          : {})}
        {...(props.artifactTheme ? { artifactTheme: props.artifactTheme } : {})}
        {...(props.artifactMaxBytes !== undefined
          ? { artifactMaxBytes: props.artifactMaxBytes }
          : {})}
        {...(props.onArtifactAction ? { onArtifactAction: props.onArtifactAction } : {})}
      />
    );
  }

  if (decision.kind === 'render' || decision.kind === 'blocked') {
    if (!props.artifactPreviewEnabled) {
      return <SourceCodeBlock language={props.language} source={props.source} isShell={isShell} />;
    }

    if (
      decision.kind === 'render' &&
      presentation?.kind === 'canvas' &&
      props.artifactOrigin &&
      props.onOpenArtifactCanvas
    ) {
      const target = createArtifactCanvasTarget({
        ...props.artifactOrigin,
        fenceIndex: boundFenceIndex,
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

    const previewInCanvas =
      presentation?.kind === 'inline-incompatible' ||
      (presentation?.kind === 'source' && presentation.previewSurface === 'canvas');
    const canPreviewInline =
      presentation?.kind === 'inline-static' ||
      presentation?.kind === 'inline-sandbox' ||
      (presentation?.kind === 'source' && presentation.previewSurface === 'inline');
    const openCanvasPreview = (): void => {
      if (!props.artifactOrigin || !props.onOpenArtifactCanvas) return;
      props.onOpenArtifactCanvas(
        createArtifactCanvasTarget({
          ...props.artifactOrigin,
          fenceIndex: boundFenceIndex,
          descriptor: decision.descriptor,
        }),
      );
    };
    const previewLabel = decision.descriptor.type === 'svg' ? 'Preview SVG' : 'Preview';

    if (decision.kind === 'blocked') {
      return (
        <div className="artifact-with-source">
          <SourceCodeBlock
            language={props.language}
            source={props.source}
            isShell={isShell}
            blockedReason={decision.reason}
          />
        </div>
      );
    }

    return (
      <div
        className={
          artifactPreviewOpen && canPreviewInline
            ? 'artifact-with-source artifact-with-source--preview'
            : 'artifact-with-source'
        }
        data-artifact-id={stickyFenceId}
      >
        {artifactPreviewOpen && canPreviewInline ? (
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
            <div className="artifact-floating-actions">
              <IconButton
                label="Show code"
                title="Show code"
                className="artifact-floating-action-button"
                data-testid="artifact-preview-toggle"
                aria-expanded
                onClick={showArtifactSource}
              >
                <IconCode size={14} />
              </IconButton>
            </div>
          </>
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
                onClick={previewInCanvas ? openCanvasPreview : () => setArtifactPreviewOpen(true)}
                disabled={previewInCanvas && (!props.artifactOrigin || !props.onOpenArtifactCanvas)}
              >
                {previewInCanvas ? 'Preview in Canvas' : previewLabel}
              </Button>
            }
            incompatible={presentation?.kind === 'inline-incompatible'}
          />
        )}
      </div>
    );
  }

  return <SourceCodeBlock language={props.language} source={props.source} isShell={isShell} />;
}

function SourceCodeBlock(props: {
  language: string;
  source: string;
  isShell: boolean;
  streaming?: boolean;
  defaultCollapsed?: boolean;
  previewAction?: ReactElement;
  blockedReason?: string;
  incompatible?: boolean;
}): ReactElement {
  return (
    <div
      className="md-code-block"
      data-is-shell={props.isShell ? 'true' : undefined}
      data-testid={props.streaming ? 'code-fence-streaming' : 'code-fence-source'}
    >
      <div className="md-code-header">
        <div className="md-code-header-title">
          {props.isShell ? (
            <span className="md-code-shell-icon" aria-hidden="true">
              $
            </span>
          ) : null}
          <span className="md-code-lang muted">
            {props.language || (props.isShell ? 'bash' : 'code')}
          </span>
        </div>
        {!props.streaming ? (
          <div className="md-code-header-actions">
            <CopyCodeButton text={props.source} />
            {props.previewAction}
          </div>
        ) : null}
      </div>
      <CodeBodyWithLineNumbers
        source={props.source}
        language={props.language}
        highlightEnabled={!props.streaming}
        {...(props.streaming
          ? { defaultCollapsed: false }
          : props.defaultCollapsed !== undefined
            ? { defaultCollapsed: props.defaultCollapsed }
            : {})}
      />
      {props.blockedReason ? (
        <div className="artifact-blocked muted" data-testid="artifact-blocked" role="status">
          Artifact blocked{`: ${props.blockedReason}`}
        </div>
      ) : null}
      {props.incompatible ? (
        <p className="artifact-inline-incompatible" data-testid="artifact-inline-incompatible">
          Full-page or viewport-sized HTML cannot use Inline sizing. Preview it in Canvas.
        </p>
      ) : null}
    </div>
  );
}

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
      <SourceCodeBlock
        language={props.language}
        source={props.source}
        isShell={false}
        defaultCollapsed={!sourceExpanded}
        previewAction={
          <Button size="compact" data-testid="flashcard-preview-card" onClick={() => setOpen(true)}>
            Preview card
          </Button>
        }
      />
    );
  }

  const evaluateOptions: Parameters<typeof evaluateCodeFence>[0] = {
    language: props.language,
    source: props.source,
    id: `flashcard-${props.initPriority}`,
    htmlUiModeEnabled: true,
    mode: 'interactive',
  };
  if (props.artifactMaxBytes !== undefined) evaluateOptions.maxBytes = props.artifactMaxBytes;
  if (props.artifactTheme) evaluateOptions.theme = props.artifactTheme;
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
          <div className="artifact-floating-actions">
            <IconButton
              label="Show code"
              title="Show code"
              className="artifact-floating-action-button"
              data-testid="flashcard-preview-card"
              aria-expanded
              onClick={() => {
                setSourceExpanded(true);
                setOpen(false);
              }}
            >
              <IconCode size={14} />
            </IconButton>
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
            if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
            await navigator.clipboard.writeText(props.text);
            setStatus('copied');
            window.setTimeout(() => setStatus('idle'), 1_500);
          } catch {
            setStatus('failed');
            window.setTimeout(() => setStatus('idle'), 2_000);
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
    return props.display ? (
      <div
        className="md-math-error md-math-display"
        data-testid="math-error"
        title={result.error}
        role="alert"
      >
        {fallback}
      </div>
    ) : (
      <span className="md-math-error md-math-inline" data-testid="math-error" title={result.error}>
        {fallback}
      </span>
    );
  }

  return props.display ? (
    <div
      className="md-math md-math-display"
      data-testid="math-display"
      dangerouslySetInnerHTML={{ __html: result.html }}
    />
  ) : (
    <span
      className="md-math md-math-inline"
      data-testid="math-inline"
      dangerouslySetInnerHTML={{ __html: result.html }}
    />
  );
}
