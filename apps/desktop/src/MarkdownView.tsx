import type { ReactElement } from 'react';
import {
  evaluateCodeFence,
  normalizeStreamingArtifactFences,
  splitMarkdownBlocks,
  type ArtifactPreviewDecision,
  type ArtifactThemeVariables,
} from '@piwin/artifact';
import { ArtifactFrame } from './ArtifactFrame';

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
 * Markdown renderer with optional HTML Artifact previews.
 * Model HTML never runs in the parent document — only via sandboxed ArtifactFrame.
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
        return (
          <p key={index} className="md-p">
            {renderInline(block.value)}
          </p>
        );
      })}
    </div>
  );
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

function renderInline(text: string): Array<string | ReactElement> {
  const parts: Array<string | ReactElement> = [];
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) {
      parts.push(text.slice(last, match.index));
    }
    const token = match[0];
    if (token.startsWith('**')) {
      parts.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('*')) {
      parts.push(<em key={key++}>{token.slice(1, -1)}</em>);
    } else if (token.startsWith('`')) {
      parts.push(
        <code key={key++} className="md-inline-code">
          {token.slice(1, -1)}
        </code>,
      );
    }
    last = match.index + token.length;
  }
  if (last < text.length) {
    parts.push(text.slice(last));
  }
  return parts;
}
