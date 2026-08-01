/**
 * Collapsible tool-call card — Paper/Noir theme (proto-shell.css .tool block).
 * Write/edit tools with non-empty `changedPaths` render a DiffCard per path;
 * the original raw output is folded into a <details> below.
 */
import { useEffect, useState, type ReactElement } from 'react';
import type { ToolCardUi } from './chat-reducer';
import type { ToolCallDensity } from './ui-preferences';
import { CitationCards } from './CitationCards';
import { parseToolCitations } from './tool-citations';
import { DiffCard, type DiffCardRequest } from './diff-card';
import {
  IconChevronDown,
  IconFile,
  IconTerminal,
  IconGit,
  IconSearch,
  IconPlug,
  IconActivity,
  IconBook,
} from './shell-icons';
import type { ToolKind } from '@piwin/contracts';

export type ToolCallCardProps = {
  tool: ToolCardUi;
  /** Default expanded while running; collapsed when done. */
  defaultExpanded?: boolean;
  /** @deprecated prefer density */
  compact?: boolean;
  density?: ToolCallDensity;
  /** Project root for DiffCard git/diff-file requests. */
  projectPath?: string | null;
  /** Host request adapter for DiffCard (same signature as ChangesPanel). */
  request?: DiffCardRequest;
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

/** Map a ToolKind to a lucide-style outline icon (13px, --accent in CSS). */
function kindIcon(kind: ToolKind | 'unknown'): ReactElement {
  switch (kind) {
    case 'filesystem':
      return <IconFile className="tool-call-kind-icon" />;
    case 'shell':
    case 'process':
      return <IconTerminal className="tool-call-kind-icon" />;
    case 'git':
      return <IconGit className="tool-call-kind-icon" />;
    case 'web':
      return <IconSearch className="tool-call-kind-icon" />;
    case 'mcp':
      return <IconPlug className="tool-call-kind-icon" />;
    case 'other':
      return <IconActivity className="tool-call-kind-icon" />;
    default:
      return <IconBook className="tool-call-kind-icon" />;
  }
}

/** Short verb label for the head row (read / write / bash / web …). */
function kindVerb(kind: ToolKind | 'unknown', fallback: string): string {
  switch (kind) {
    case 'filesystem':
      return fallback.toLowerCase().includes('write') || fallback.toLowerCase().includes('edit')
        ? 'write'
        : 'read';
    case 'shell':
    case 'process':
      return 'bash';
    case 'git':
      return 'git';
    case 'web':
      return 'web';
    case 'mcp':
      return 'mcp';
    default:
      return fallback;
  }
}

export function ToolStatusDot(props: { status: ToolCardUi['status'] }): ReactElement {
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
  const kind = tool.presentation?.kind ?? 'unknown';
  // Prefer host changedPaths; fall back to write-like targetPaths so DiffCard
  // still works for older transcripts that only stored targetPaths.
  const changedPaths =
    tool.presentation?.changedPaths && tool.presentation.changedPaths.length > 0
      ? tool.presentation.changedPaths
      : tool.status !== 'error' &&
          (tool.presentation?.actionVerb === 'Edited' ||
            /write|edit|replace|patch/i.test(tool.toolName))
        ? (tool.presentation?.targetPaths ?? [])
        : [];
  const hasChangedPaths = changedPaths.length > 0;
  const canRenderDiffCard = hasChangedPaths && Boolean(props.projectPath) && Boolean(props.request);
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
    hasChangedPaths ||
    Boolean(tool.presentation?.error);

  return (
    <div
      className={`tool-call-card density-${density} status-${tool.status}${
        expanded ? ' is-expanded' : ''
      }`}
      data-testid="tool-call-card"
      data-tool-name={tool.toolName}
      data-tool-kind={kind}
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
        {kindIcon(kind)}
        <span className="tool-call-action-verb">
          {tool.presentation?.actionVerb ?? kindVerb(kind, displayName)}
        </span>
        {tool.presentation?.targetPaths && tool.presentation.targetPaths[0] ? (
          <span className="tool-call-file-pill">
            <span className="tool-call-file-name">
              {tool.presentation.targetPaths[0].split('/').pop()}
            </span>
            {tool.presentation.lineRange ? (
              <span className="tool-call-line-range">#{tool.presentation.lineRange}</span>
            ) : null}
          </span>
        ) : null}
        {tool.presentation?.countTag ? (
          <span className="tool-call-count-tag">{tool.presentation.countTag}</span>
        ) : null}
        <span className="tool-call-preview">
          {summary === displayName || !summary ? '' : summary}
        </span>
        {tool.status === 'done' ? (
          <span className="tool-call-ok" aria-label="done" data-testid="tool-call-ok" />
        ) : tool.status === 'error' ? (
          <span className="tool-call-err" aria-label="error" data-testid="tool-call-err" />
        ) : (
          <ToolStatusDot status={tool.status} />
        )}
        {typeof tool.presentation?.durationMs === 'number' ? (
          <span className="tool-call-duration" data-testid="tool-call-duration">
            {formatDuration(tool.presentation.durationMs)}
          </span>
        ) : tool.status === 'running' ? (
          <span className="tool-call-duration tool-call-duration-live">…</span>
        ) : null}
        <IconChevronDown className={expanded ? 'tool-call-chevron open' : 'tool-call-chevron'} />
      </button>
      {expanded && hasBody ? (
        <div className="tool-call-body">
          {canRenderDiffCard
            ? changedPaths.map((path) => (
                <DiffCard
                  key={path}
                  projectPath={props.projectPath as string}
                  path={path}
                  request={props.request as DiffCardRequest}
                />
              ))
            : null}
          {tool.presentation?.command ? (
            <div className="tool-call-command" data-testid="tool-call-command">
              <code>{tool.presentation.command}</code>
              {typeof tool.presentation.exitCode === 'number' ? (
                <span className="dim"> exit {tool.presentation.exitCode}</span>
              ) : null}
            </div>
          ) : null}
          {tool.presentation?.targetPaths && tool.presentation.targetPaths.length > 0 ? (
            <div className="tool-call-paths" data-testid="tool-call-paths">
              {tool.presentation.targetPaths.join(' · ')}
            </div>
          ) : null}
          {!canRenderDiffCard && hasChangedPaths ? (
            <div className="tool-call-paths" data-testid="tool-call-changed-paths">
              changed: {changedPaths.join(' · ')}
            </div>
          ) : null}
          {tool.presentation?.error ? (
            <div className="tool-call-error" data-testid="tool-call-error" role="status">
              {tool.presentation.error.category}: {tool.presentation.error.message}
            </div>
          ) : null}
          <CitationCards parsed={citations} />
          {displayOutput && citations.kind === 'none' ? (
            canRenderDiffCard ? (
              <details className="tool-call-raw-fold">
                <summary>raw output</summary>
                <pre className="tool-call-output">
                  {displayOutput.slice(0, density === 'compact' ? 2000 : 8000)}
                </pre>
              </details>
            ) : (
              <pre className="tool-call-output">
                {displayOutput.slice(0, density === 'compact' ? 2000 : 8000)}
              </pre>
            )
          ) : null}
          {displayOutput && citations.kind !== 'none' ? (
            <details open={density === 'detailed'} className="tool-call-raw-fold">
              <summary className="dim">raw tool output</summary>
              <pre className="tool-call-output">{displayOutput.slice(0, 4000)}</pre>
            </details>
          ) : null}
        </div>
      ) : null}
      {expanded && !hasBody ? (
        <div className="tool-call-body tool-call-empty">
          <span className="dim">{tool.status === 'running' ? 'Running…' : 'No output'}</span>
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
