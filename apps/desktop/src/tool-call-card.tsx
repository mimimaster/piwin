/**
 * Collapsible tool-call card — Cursor Agent style density + status row.
 */

import { useEffect, useState, type ReactElement } from 'react';
import type { ToolCardUi } from './chat-reducer';
import type { ToolCallDensity } from './ui-preferences';
import { CitationCards } from './CitationCards';
import { parseToolCitations } from './tool-citations';
import {
  IconChevronDown,
  IconFolder,
  IconPlug,
  IconSearch,
  IconSpark,
} from './shell-icons';

export type ToolCallCardProps = {
  tool: ToolCardUi;
  /** Default expanded while running; collapsed when done. */
  defaultExpanded?: boolean;
  /** @deprecated prefer density */
  compact?: boolean;
  density?: ToolCallDensity;
};

function summarizeToolOutput(toolName: string, output: string, maxLength: number): string {
  const trimmed = output.replace(/\s+/g, ' ').trim();
  if (!trimmed) {
    return toolName;
  }
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength - 1)}…`;
}

function toolKindIcon(toolName: string): ReactElement {
  const lower = toolName.toLowerCase();
  if (lower.includes('bash') || lower.includes('shell') || lower.includes('terminal')) {
    return <IconSpark />;
  }
  if (lower.includes('search') || lower.includes('grep') || lower.includes('glob')) {
    return <IconSearch />;
  }
  if (
    lower.includes('read') ||
    lower.includes('write') ||
    lower.includes('edit') ||
    lower.includes('file')
  ) {
    return <IconFolder />;
  }
  if (lower.includes('mcp') || lower.includes('web_')) {
    return <IconPlug />;
  }
  return <IconSpark />;
}

export function ToolStatusDot(props: {
  status: ToolCardUi['status'];
}): ReactElement {
  return (
    <span
      className={`tool-status-dot status-${props.status}`}
      title={props.status}
      aria-label={props.status}
    />
  );
}

function resolveDensity(
  density: ToolCallDensity | undefined,
  compact: boolean | undefined,
): ToolCallDensity {
  if (density) {
    return density;
  }
  if (compact) {
    return 'compact';
  }
  return 'comfortable';
}

export function ToolCallCard(props: ToolCallCardProps): ReactElement {
  const { tool } = props;
  const density = resolveDensity(props.density, props.compact);
  const autoExpand =
    props.defaultExpanded ??
    (tool.status === 'running' ||
      (density === 'detailed' && Boolean(tool.output) && tool.status !== 'error'));
  const [expanded, setExpanded] = useState(autoExpand);

  useEffect(() => {
    if (tool.status === 'running') {
      setExpanded(true);
    } else if (density === 'compact') {
      setExpanded(false);
    } else if (density === 'detailed' && tool.output) {
      setExpanded(true);
    }
  }, [tool.status, tool.output, density]);

  const citations = parseToolCitations(tool.toolName, tool.output);
  const previewMax = density === 'compact' ? 48 : density === 'detailed' ? 160 : 96;
  const summary = summarizeToolOutput(tool.toolName, tool.output, previewMax);
  const hasBody = Boolean(tool.output) || citations.kind !== 'none';
  const showPreview = density !== 'compact' || expanded;

  return (
    <div
      className={`tool-call-card density-${density} status-${tool.status}${
        expanded ? ' is-expanded' : ''
      }`}
      data-testid="tool-call-card"
      data-tool-name={tool.toolName}
      data-tool-status={tool.status}
      data-density={density}
    >
      <button
        type="button"
        className="tool-call-summary"
        onClick={() => setExpanded((previous) => !previous)}
        aria-expanded={expanded}
      >
        <span className="tool-call-icon-wrap">
          <span className="tool-call-icon">{toolKindIcon(tool.toolName)}</span>
          <ToolStatusDot status={tool.status} />
        </span>
        <span className="tool-call-meta">
          <span className="tool-call-name">{tool.toolName}</span>
          {showPreview ? (
            <span className="tool-call-preview muted">
              {summary === tool.toolName ? tool.status : summary}
            </span>
          ) : (
            <span className="tool-call-preview muted">{tool.status}</span>
          )}
        </span>
        <IconChevronDown className={expanded ? 'tool-call-chevron open' : 'tool-call-chevron'} />
      </button>
      {expanded && hasBody ? (
        <div className="tool-call-body">
          <CitationCards parsed={citations} />
          {tool.output && citations.kind === 'none' ? (
            <pre className="tool-call-output">
              {tool.output.slice(0, density === 'compact' ? 2000 : 8000)}
            </pre>
          ) : null}
          {tool.output && citations.kind !== 'none' ? (
            <details open={density === 'detailed'}>
              <summary className="muted">raw tool output</summary>
              <pre className="tool-call-output">{tool.output.slice(0, 4000)}</pre>
            </details>
          ) : null}
        </div>
      ) : null}
      {expanded && !hasBody ? (
        <div className="tool-call-body muted tool-call-empty">
          {tool.status === 'running' ? 'Running…' : 'No output'}
        </div>
      ) : null}
    </div>
  );
}

export function collectSessionTools(messages: { tools: ToolCardUi[] }[]): ToolCardUi[] {
  const collected: ToolCardUi[] = [];
  for (const message of messages) {
    for (const tool of message.tools) {
      collected.push(tool);
    }
  }
  return collected;
}
