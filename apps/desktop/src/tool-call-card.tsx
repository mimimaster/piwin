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
import { CollapsibleContentBlock } from './collapsible-content-block';
import {
  IconChevronDown,
  IconFile,
  IconTerminal,
  IconGit,
  IconSearch,
  IconPlug,
  IconActivity,
  IconBook,
  IconBrowser,
  IconSpark,
} from './shell-icons';
import type { ToolKind } from '@piwin/contracts';
import {
  ContextMenuFromCatalog,
  useDesktopContextMenu,
  type ContextMenuTarget,
} from './context-menu';

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

/** Map action verb / kind / tool name → head-row icon. Prefer presentation verb. */
function kindIcon(
  kind: ToolKind | 'unknown',
  toolName?: string,
  actionVerb?: string,
): ReactElement {
  const verb = (actionVerb ?? '').toLowerCase();
  const name = (toolName ?? '').toLowerCase();

  if (verb.startsWith('searched') || verb.startsWith('explored')) {
    return <IconSearch className="tool-call-kind-icon" />;
  }
  if (verb.startsWith('read') || verb.startsWith('edited')) {
    return <IconFile className="tool-call-kind-icon" />;
  }
  if (verb.startsWith('ran command') || verb === 'bash') {
    return <IconTerminal className="tool-call-kind-icon" />;
  }
  if (verb.startsWith('git')) {
    return <IconGit className="tool-call-kind-icon" />;
  }
  if (verb.startsWith('fetched') || verb.startsWith('searched') || verb.includes('web')) {
    return <IconBrowser className="tool-call-kind-icon" />;
  }
  if (verb.startsWith('mcp') || verb.includes('mcp')) {
    return <IconPlug className="tool-call-kind-icon" />;
  }
  if (verb.includes('image') || verb.includes('generated')) {
    return <IconSpark className="tool-call-kind-icon" />;
  }

  if (
    name.includes('web') ||
    name.includes('url') ||
    name.includes('fetch') ||
    name.includes('http')
  ) {
    return <IconBrowser className="tool-call-kind-icon" />;
  }
  if (
    name.includes('search') ||
    name.includes('grep') ||
    name.includes('glob') ||
    name.includes('find')
  ) {
    return <IconSearch className="tool-call-kind-icon" />;
  }
  if (
    name.includes('read') ||
    name.includes('view') ||
    name.includes('write') ||
    name.includes('edit')
  ) {
    return <IconFile className="tool-call-kind-icon" />;
  }
  if (
    name.includes('bash') ||
    name.includes('command') ||
    name.includes('exec') ||
    name === 'shell'
  ) {
    return <IconTerminal className="tool-call-kind-icon" />;
  }
  if (name.includes('git')) {
    return <IconGit className="tool-call-kind-icon" />;
  }
  if (name.includes('image')) {
    return <IconSpark className="tool-call-kind-icon" />;
  }

  switch (kind) {
    case 'filesystem':
      return <IconFile className="tool-call-kind-icon" />;
    case 'shell':
    case 'process':
      return <IconTerminal className="tool-call-kind-icon" />;
    case 'git':
      return <IconGit className="tool-call-kind-icon" />;
    case 'web':
      return <IconBrowser className="tool-call-kind-icon" />;
    case 'mcp':
      return <IconPlug className="tool-call-kind-icon" />;
    case 'other':
      return <IconActivity className="tool-call-kind-icon" />;
    default:
      return <IconBook className="tool-call-kind-icon" />;
  }
}

/** Fallback verb when host presentation is missing (legacy transcripts). */
function kindVerb(kind: ToolKind | 'unknown', toolName: string): string {
  const name = toolName.toLowerCase();
  if (name.includes('grep') || name.includes('search')) return 'Searched';
  if (name.includes('glob') || name.includes('list_dir') || name === 'ls') return 'Explored';
  if (name.includes('read') || name.includes('view')) return 'Read';
  if (name.includes('write') || name.includes('edit') || name.includes('replace')) return 'Edited';
  if (name.includes('bash') || name.includes('shell') || name.includes('command'))
    return 'Ran command';
  if (name.includes('git')) return 'Git';
  if (name.includes('fetch')) return 'Fetched';
  if (name.includes('image')) return 'Generated image';
  switch (kind) {
    case 'filesystem':
      return 'Read';
    case 'shell':
    case 'process':
      return 'Ran command';
    case 'git':
      return 'Git';
    case 'web':
      return 'Fetched';
    case 'mcp':
      return 'MCP';
    default:
      return toolName;
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

/** True when a head summary is really a raw args/JSON dump, not a tool/query label. */
export function looksLikeArgsDumpSummary(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 2) return false;
  return (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  );
}

/**
 * Header mono preview (query / command / path summary).
 * Detail payloads (shell command / MCP args) are shown only while collapsed —
 * expanded body already owns the full detail block.
 */
export function resolveToolCallHeaderPreview(input: {
  summary: string;
  displayName: string;
  showFilePill: boolean;
  pillLabel: string;
  singleBasename: string;
  isPathLike: boolean;
  expanded: boolean;
  /** True when body will render command and/or inputPreview. */
  hasDetailInBody: boolean;
  /** True when summary is just a raw args dump (same text as inputPreview). */
  isArgsDumpSummary?: boolean;
}): string {
  const {
    summary,
    displayName,
    showFilePill,
    pillLabel,
    singleBasename,
    isPathLike,
    expanded,
    hasDetailInBody,
    isArgsDumpSummary = false,
  } = input;
  if (!summary || summary === displayName) return '';
  // Never promote raw JSON/args dumps into the title row (MCP legacy presentations).
  if (isArgsDumpSummary) return '';
  // Expanded body already renders the full detail — keep the head as verb-only
  // so long shell/MCP lines do not wrap into a multi-line "title".
  if (expanded && hasDetailInBody) return '';
  if (showFilePill && pillLabel && (summary === pillLabel || summary === singleBasename)) {
    return '';
  }
  if (showFilePill && isPathLike) return '';
  return summary;
}

export function ToolCallCard(props: ToolCallCardProps): ReactElement {
  const { tool } = props;
  const contextMenu = useDesktopContextMenu();
  const density = resolveDensity(props.density, props.compact);
  const autoExpand =
    props.defaultExpanded ??
    (tool.status === 'running' ||
      tool.status === 'error' ||
      (density === 'detailed' && Boolean(tool.output)));
  const [expanded, setExpanded] = useState(autoExpand);

  useEffect(() => {
    if (tool.status === 'running' || tool.status === 'error') {
      setExpanded(true);
    } else if (tool.status === 'done' && density !== 'detailed') {
      setExpanded(false);
    } else if (density === 'compact') {
      setExpanded(false);
    } else if (density === 'detailed' && tool.output) {
      setExpanded(true);
    }
  }, [tool.status, tool.output, density]);

  const displayOutput = tool.presentation?.output?.text ?? tool.output;
  const outputTruncated = tool.presentation?.output?.truncated === true;
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
  const actionVerb = tool.presentation?.actionVerb ?? kindVerb(kind, tool.toolName);
  const targetPaths = tool.presentation?.targetPaths ?? [];
  const multiPath = targetPaths.length > 1;
  const isQueryLike =
    actionVerb === 'Searched' ||
    actionVerb === 'Explored' ||
    actionVerb === 'Fetched' ||
    actionVerb === 'Generated image' ||
    actionVerb.startsWith('MCP');
  const isPathLike =
    actionVerb === 'Read' || actionVerb === 'Edited' || actionVerb.startsWith('Git');
  const summary =
    tool.presentation?.summary ??
    tool.presentation?.command ??
    (targetPaths.length > 0
      ? targetPaths.map((path) => path.split(/[\\/]/).pop() || path).join(', ')
      : summarizeToolOutput(tool.toolName, tool.output, previewMax));

  // Cursor-style head:
  //  - Read/Edited/Git path tools → file pill (single or "a and N other files")
  //  - Searched/Explored/Fetched/shell → mono query/command preview
  const singleBasename = targetPaths[0]?.split(/[\\/]/).pop() || targetPaths[0] || '';
  const showFilePill = isPathLike && (targetPaths.length >= 1 || Boolean(summary));
  const pillLabel = multiPath || (isPathLike && !targetPaths[0]) ? summary : singleBasename;
  // Prefer host inputPreview; fall back when legacy presentations stuffed JSON into summary.
  const inputPreview =
    tool.presentation?.inputPreview || (looksLikeArgsDumpSummary(summary) ? summary : undefined);
  const hasDetailInBody = Boolean(tool.presentation?.command || inputPreview);
  const isArgsDumpSummary =
    Boolean(inputPreview && summary === inputPreview) || looksLikeArgsDumpSummary(summary);
  const previewText = resolveToolCallHeaderPreview({
    summary,
    displayName,
    showFilePill,
    pillLabel: pillLabel || '',
    singleBasename: singleBasename || '',
    isPathLike,
    expanded,
    hasDetailInBody,
    isArgsDumpSummary,
  });
  const previewClassName =
    isQueryLike || actionVerb === 'Ran command'
      ? 'tool-call-preview is-query'
      : 'tool-call-preview';

  const hasBody =
    Boolean(displayOutput) ||
    citations.kind !== 'none' ||
    Boolean(tool.presentation?.command) ||
    Boolean(inputPreview) ||
    targetPaths.length > 0 ||
    hasChangedPaths ||
    Boolean(tool.presentation?.error);

  // CM-13: tool-card surface menu. relatedPath prefers the first changed path.
  const toolTarget: ContextMenuTarget | null = contextMenu
    ? {
        surface: 'tool-card',
        toolCallId: tool.toolCallId,
        toolName: tool.toolName,
        outputText: displayOutput,
        ...(changedPaths[0] ? { relatedPath: changedPaths[0] as string } : {}),
        label: displayName,
        canRerun: false,
      }
    : null;

  const card = (
    <div
      className={`tool-call-card density-${density} status-${tool.status}${
        expanded ? ' is-expanded' : ''
      }`}
      data-testid="tool-call-card"
      data-tool-name={tool.toolName}
      data-tool-kind={kind}
      data-tool-status={tool.status}
      data-action-verb={actionVerb}
      data-density={density}
    >
      <button
        type="button"
        className="tool-call-summary"
        onClick={() => setExpanded((previous) => !previous)}
        aria-expanded={expanded}
        aria-label={`${actionVerb} ${summary || displayName} ${tool.status}`}
      >
        {kindIcon(kind, tool.toolName, actionVerb)}
        <span className="tool-call-action-verb">{actionVerb}</span>
        {showFilePill && pillLabel ? (
          <span className="tool-call-file-pill">
            <span className="tool-call-file-name">{pillLabel}</span>
            {!multiPath && tool.presentation?.lineRange ? (
              <span className="tool-call-line-range">#{tool.presentation.lineRange}</span>
            ) : null}
          </span>
        ) : null}
        {tool.presentation?.countTag ? (
          <span className="tool-call-count-tag">{tool.presentation.countTag}</span>
        ) : null}
        {outputTruncated ? (
          <span
            className="tool-call-truncated-tag"
            data-testid="tool-call-output-truncated"
            aria-label="Output truncated"
          >
            truncated
          </span>
        ) : null}
        <span className={previewClassName}>{previewText}</span>
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
          {outputTruncated ? (
            <div
              className="tool-call-output-notice"
              data-testid="tool-call-output-notice"
              role="status"
            >
              {kind === 'web'
                ? 'The web response was too large; only a bounded partial result is shown.'
                : 'The tool output was too large; only a bounded partial result is shown.'}
            </div>
          ) : null}
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
          {tool.presentation?.command ||
          inputPreview ||
          (displayOutput && citations.kind === 'none' && !canRenderDiffCard) ? (
            <CollapsibleContentBlock
              maxCollapsedHeight={130}
              defaultCollapsed={tool.status === 'done'}
            >
              {tool.presentation?.command ? (
                <div className="tool-call-command" data-testid="tool-call-command">
                  <code>{tool.presentation.command}</code>
                  {typeof tool.presentation.exitCode === 'number' ? (
                    <span className="dim"> exit {tool.presentation.exitCode}</span>
                  ) : null}
                </div>
              ) : null}
              {!tool.presentation?.command && inputPreview ? (
                <div className="tool-call-command" data-testid="tool-call-input-preview">
                  <code>{inputPreview}</code>
                </div>
              ) : null}
              {displayOutput && citations.kind === 'none' && !canRenderDiffCard ? (
                <pre className="tool-call-output">
                  {displayOutput.slice(0, density === 'compact' ? 2000 : 8000)}
                </pre>
              ) : null}
            </CollapsibleContentBlock>
          ) : null}
          {displayOutput && citations.kind === 'none' && canRenderDiffCard ? (
            <details className="tool-call-raw-fold">
              <summary>raw output</summary>
              <pre className="tool-call-output">
                {displayOutput.slice(0, density === 'compact' ? 2000 : 8000)}
              </pre>
            </details>
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

  if (!toolTarget || !contextMenu) {
    return card;
  }
  return (
    <ContextMenuFromCatalog
      testId="tool-card-context-menu"
      target={toolTarget}
      caps={contextMenu.caps}
      dispatchers={contextMenu.dispatchers}
    >
      {card}
    </ContextMenuFromCatalog>
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
