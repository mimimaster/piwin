import { useState, type ReactElement } from 'react';
import {
  evaluateCodeFence,
  normalizeStreamingArtifactFences,
  splitMarkdownBlocks,
  type ArtifactActionMessage,
  type ArtifactPreviewDecision,
  type ArtifactThemeVariables,
} from '@piwin/artifact';
import { Button } from '@piwin/ui-kit';
import { ArtifactFrame } from './ArtifactFrame';
import { MermaidBlock } from './MermaidBlock';
import {
  extractStandaloneDisplayMath,
  isMathFenceLanguage,
  isMermaidFenceLanguage,
  renderKatex,
  tokenizeInlineWithMath,
} from './markdown-math';

/** C5: explicit rendering phases for coding-agent transcript policy. */
export type MarkdownRenderingPhase =
  | 'streaming'
  | 'completed'
  | 'explicit-artifact-review';

type MarkdownViewProps = {
  text: string;
  /** When false, never promote ```html``` fences to artifacts. Default true. */
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
};

/**
 * Markdown renderer with optional HTML Artifact previews, KaTeX, and Mermaid.
 * Model HTML never runs in the parent document — only via sandboxed ArtifactFrame.
 * Math/Mermaid failures soft-degrade (show source); they must not crash the shell.
 */
export function MarkdownView({
  text,
  htmlUiModeEnabled = true,
  streamComplete = true,
  renderingPhase,
  artifactTheme,
  initPriorityBase = 0,
  artifactThemeKey = 'default',
  onArtifactAction,
}: MarkdownViewProps): ReactElement {
  const phase: MarkdownRenderingPhase =
    renderingPhase ?? (streamComplete ? 'completed' : 'streaming');
  const streamMode = phase === 'streaming';
  const normalized = normalizeStreamingArtifactFences(
    text,
    htmlUiModeEnabled,
    !streamMode,
  );
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
          } = {
            language: block.language,
            source: block.source,
            htmlUiModeEnabled,
            fenceIndex: index,
            renderingPhase: phase,
            initPriority: initPriorityBase + index,
            artifactThemeKey,
          };
          if (artifactTheme) {
            fenceProps.artifactTheme = artifactTheme;
          }
          if (onArtifactAction) {
            fenceProps.onArtifactAction = onArtifactAction;
          }
          return <CodeFenceView key={index} {...fenceProps} />;
        }
        if (block.type === 'list') {
          return (
            <ul key={index} className="md-list">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{renderInline(item)}</li>
              ))}
            </ul>
          );
        }
        return <ParagraphView key={index} value={block.value} />;
      })}
    </div>
  );
}

function ParagraphView(props: { value: string }): ReactElement {
  const standaloneMath = extractStandaloneDisplayMath(props.value);
  if (standaloneMath !== null) {
    return <MathView tex={standaloneMath} display />;
  }
  return <p className="md-p">{renderInline(props.value)}</p>;
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
}): ReactElement {
  const streamMode = props.renderingPhase === 'streaming';
  const [artifactPreviewOpen, setArtifactPreviewOpen] = useState(
    props.renderingPhase === 'explicit-artifact-review',
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

  // Streaming: always show source for code fences — never mount ArtifactFrame.
  if (streamMode) {
    return (
      <div className="md-code-block" data-testid="code-fence-streaming">
        <div className="md-code-header">
          <span className="md-code-lang muted">{props.language || 'code'}</span>
        </div>
        <pre className="md-code">
          <code data-language={props.language || undefined}>{props.source}</code>
        </pre>
      </div>
    );
  }

  const evaluateOptions: Parameters<typeof evaluateCodeFence>[0] = {
    language: props.language,
    source: props.source,
    id: `fence-${props.fenceIndex}`,
    htmlUiModeEnabled: props.htmlUiModeEnabled,
    mode: 'interactive',
  };
  if (props.artifactTheme) {
    evaluateOptions.theme = props.artifactTheme;
  }

  const decision: ArtifactPreviewDecision = evaluateCodeFence(evaluateOptions);

  if (
    decision.kind === 'render' ||
    decision.kind === 'blocked' ||
    decision.kind === 'preparing'
  ) {
    return (
      <div className="artifact-with-source">
        <div className="md-code-block">
          <div className="md-code-header">
            <span className="md-code-lang muted">{props.language || 'html'}</span>
            <div className="md-code-header-actions">
              <CopyCodeButton text={props.source} />
              {decision.kind === 'render' || decision.kind === 'preparing' ? (
                <Button
                  size="compact"
                  data-testid="artifact-preview-toggle"
                  aria-expanded={artifactPreviewOpen}
                  onClick={() => setArtifactPreviewOpen((previous) => !previous)}
                >
                  {artifactPreviewOpen ? 'Hide preview' : 'Preview artifact'}
                </Button>
              ) : null}
            </div>
          </div>
          <pre className="md-code">
            <code data-language={props.language || undefined}>{props.source}</code>
          </pre>
        </div>
        {decision.kind === 'blocked' ? (
          <div className="artifact-blocked muted" data-testid="artifact-blocked" role="status">
            Artifact blocked
            {`: ${decision.reason}`}
          </div>
        ) : null}
        {artifactPreviewOpen &&
        (decision.kind === 'render' || decision.kind === 'preparing') ? (
          <ArtifactFrame
            key={`${props.artifactThemeKey ?? 'default'}:${decision.descriptor.id}`}
            decision={decision}
            initPriority={props.initPriority}
            {...(props.onArtifactAction ? { onArtifactAction: props.onArtifactAction } : {})}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="md-code-block" data-testid="code-fence-source">
      <div className="md-code-header">
        <span className="md-code-lang muted">{decision.language || 'code'}</span>
        <CopyCodeButton text={decision.source} />
      </div>
      <pre className="md-code">
        <code data-language={decision.language || undefined}>{decision.source}</code>
      </pre>
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
      <span
        className="md-math-error md-math-inline"
        data-testid="math-error"
        title={result.error}
      >
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

function renderInline(text: string): Array<string | ReactElement> {
  const parts: Array<string | ReactElement> = [];
  let key = 0;
  for (const segment of tokenizeInlineWithMath(text)) {
    if (segment.kind === 'text') {
      parts.push(segment.value);
      continue;
    }
    if (segment.kind === 'code') {
      parts.push(
        <code key={key++} className="md-inline-code">
          {segment.value}
        </code>,
      );
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
