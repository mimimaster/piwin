import type { ReactElement } from 'react';
import {
  evaluateCodeFence,
  normalizeStreamingArtifactFences,
  splitMarkdownBlocks,
  type ArtifactPreviewDecision,
  type ArtifactThemeVariables,
} from '@piwin/artifact';
import { ArtifactFrame } from './ArtifactFrame';
import { MermaidBlock } from './MermaidBlock';
import {
  extractStandaloneDisplayMath,
  isMathFenceLanguage,
  isMermaidFenceLanguage,
  renderKatex,
  tokenizeInlineWithMath,
} from './markdown-math';

type MarkdownViewProps = {
  text: string;
  /** When false, never promote ```html``` fences to artifacts. Default true. */
  htmlUiModeEnabled?: boolean;
  /**
   * false while the assistant message is still streaming.
   * Enables open-fence stream-preview for incomplete HTML artifacts.
   */
  streamComplete?: boolean;
  /** Optional artifact CSS vars from active desktop theme. */
  artifactTheme?: ArtifactThemeVariables;
  /** Base priority for init queue (higher = sooner). */
  initPriorityBase?: number;
  /** Bumped on theme switch so ArtifactFrame remounts with new tokens. */
  artifactThemeKey?: string;
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
  artifactTheme,
  initPriorityBase = 0,
  artifactThemeKey = 'default',
}: MarkdownViewProps): ReactElement {
  const normalized = normalizeStreamingArtifactFences(
    text,
    htmlUiModeEnabled,
    streamComplete,
  );
  const blocks = splitMarkdownBlocks(normalized);
  const streamMode = !streamComplete;

  return (
    <div className="markdown">
      {blocks.map((block, index) => {
        if (block.type === 'code') {
          const fenceProps: {
            language: string;
            source: string;
            htmlUiModeEnabled: boolean;
            fenceIndex: number;
            streamMode: boolean;
            initPriority: number;
            artifactThemeKey: string;
            artifactTheme?: ArtifactThemeVariables;
          } = {
            language: block.language,
            source: block.source,
            htmlUiModeEnabled,
            fenceIndex: index,
            streamMode,
            initPriority: initPriorityBase + index,
            artifactThemeKey,
          };
          if (artifactTheme) {
            fenceProps.artifactTheme = artifactTheme;
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
  streamMode: boolean;
  artifactTheme?: ArtifactThemeVariables;
  initPriority: number;
  artifactThemeKey?: string;
}): ReactElement {
  if (isMermaidFenceLanguage(props.language)) {
    // While streaming an incomplete fence, show source instead of partial mermaid.
    if (props.streamMode) {
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
    mode: props.streamMode ? 'stream-preview' : 'interactive',
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
        <ArtifactFrame
          key={`${props.artifactThemeKey ?? 'default'}:${decision.descriptor.id}`}
          decision={decision}
          initPriority={props.initPriority}
        />
      </div>
    );
  }

  return (
    <pre className="md-code">
      <code data-language={decision.language || undefined}>{decision.source}</code>
    </pre>
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
