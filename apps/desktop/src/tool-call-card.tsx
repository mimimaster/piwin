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

function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const seconds = ms / 1000;
  return seconds < 10 ? `${seconds.toFixed(1)}s` : `${Math.round(seconds)}s`;
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

  const displayOutput = tool.presentation?.output?.text ?? tool.output;
  const citations = parseToolCitations(tool.toolName, displayOutput);
  const previewMax = density === 'compact' ? 48 : density === 'detailed' ? 160 : 96;
  const displayName = tool.presentation?.title ?? tool.toolName;
  const summary =
    tool.presentation?.summary ??
    tool.presentation?.command ??
    (tool.presentation?.targetPaths?.length
      ? tool.presentation.targetPaths.join(', ')
      : summarizeToolOutput(tool.toolName, tool.output, previewMax));
  const hasBody =
    Boolean(displayOutput) ||
    citations.kind !== 'none' ||
    Boolean(tool.presentation?.command) ||
    Boolean(tool.presentation?.targetPaths?.length) ||
    Boolean(tool.presentation?.changedPaths?.length) ||
    Boolean(tool.presentation?.error);

  return (
    <div
      className={`tool-call-card density-${density} status-${tool.status}${
        expanded ? ' is-expanded' : ''
      }`}
      data-testid="tool-call-card"
      data-tool-name={tool.toolName}
      data-tool-kind={tool.presentation?.kind ?? 'unknown'}
      data-tool-status={tool.status}
      data-density={density}
    >
      <button
        type="button"
        className="tool-call-summary"
        onClick={() => setExpanded((previous) => !previous)}
        aria-expanded={expanded}
        aria-label={`${displayName} ${tool.status}`}
      >
        <span className="tool-call-name">{displayName}</span>
        <span className="tool-call-preview muted">
          {summary === displayName || !summary ? '' : summary}
        </span>
        {typeof tool.presentation?.durationMs === 'number' ? (
          <span className="tool-call-duration" data-testid="tool-call-duration">
            {formatDuration(tool.presentation.durationMs)}
          </span>
        ) : tool.status === 'running' ? (
          <span className="tool-call-duration tool-call-duration-live">…</span>
        ) : null}
        {tool.status === 'done' ? (
          <span className="tool-call-ok" aria-label="done" data-testid="tool-call-ok">
            ✓
          </span>
        ) : tool.status === 'error' ? (
          <span className="tool-call-err" aria-label="error" data-testid="tool-call-err">
            !
          </span>
        ) : (
          <ToolStatusDot status={tool.status} />
        )}
        <IconChevronDown className={expanded ? 'tool-call-chevron open' : 'tool-call-chevron'} />
      </button>
      {expanded && hasBody ? (
        <div className="tool-call-body">
          {tool.presentation?.command ? (
            <div className="tool-call-command" data-testid="tool-call-command">
              <code>{tool.presentation.command}</code>
              {typeof tool.presentation.exitCode === 'number' ? (
                <span className="muted"> exit {tool.presentation.exitCode}</span>
              ) : null}
            </div>
          ) : null}
          {tool.presentation?.targetPaths && tool.presentation.targetPaths.length > 0 ? (
            <div className="tool-call-paths muted" data-testid="tool-call-paths">
              {tool.presentation.targetPaths.join(' · ')}
            </div>
          ) : null}
          {tool.presentation?.changedPaths && tool.presentation.changedPaths.length > 0 ? (
            <div className="tool-call-paths muted" data-testid="tool-call-changed-paths">
              changed: {tool.presentation.changedPaths.join(' · ')}
            </div>
          ) : null}
          {tool.presentation?.error ? (
            <div className="tool-call-error" data-testid="tool-call-error" role="status">
              {tool.presentation.error.category}: {tool.presentation.error.message}
            </div>
          ) : null}
          <CitationCards parsed={citations} />
          {displayOutput && citations.kind === 'none' ? (
            <pre className="tool-call-output">
              {displayOutput.slice(0, density === 'compact' ? 2000 : 8000)}
            </pre>
          ) : null}
          {displayOutput && citations.kind !== 'none' ? (
            <details open={density === 'detailed'}>
              <summary className="muted">raw tool output</summary>
              <pre className="tool-call-output">{displayOutput.slice(0, 4000)}</pre>
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
