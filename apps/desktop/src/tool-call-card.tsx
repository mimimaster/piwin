/**
 * Collapsible tool-call card — Paper/Noir theme (proto-shell.css .tool block).
 * Write/edit tools with non-empty `changedPaths` render a DiffCard per path;
 * the original raw output is folded into a <details> below.
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { ToolCardUi } from './chat-reducer';
import type { ToolCallDensity } from './ui-preferences';
import type { DocumentTargetRef } from '@piwin/contracts';
import { formatFilePillPath } from './activity-timeline';
import { CitationCards } from './CitationCards';
import { parseToolCitations } from './tool-citations';
import { DiffCard, type DiffCardRequest } from './diff-card';
import { CollapsibleContentBlock } from './collapsible-content-block';
import { TokenSpans, useHighlight } from './syntax-highlight';
import { IconChevronDown, IconFile, IconMore } from './shell-icons';
import { toolCallKindIcon } from './tool-call-kind-icon';
import {
  extractCommandDescription,
  formatToolDuration,
  isFetchLikeShellCommand,
  kindVerb,
  looksLikeArgsDumpSummary,
  recoverSummaryFromInputPreview,
  resolveFetchRequestPreview,
  resolveMcpHeaderPreview,
  resolveToolCallHeaderPreview,
  toolHasExpandableBody,
} from './tool-call-head';
import { formatToolOutputTruncation } from './tool-output-truncation-display.js';
import {
  behaviorTextClass,
  getBehaviorActivitySpec,
  localizeBehaviorAction,
  resolveToolBehaviorId,
  resolveToolBehaviorStateId,
} from './behavior-activity.js';
import {
  ContextMenuFromCatalog,
  useDesktopContextMenu,
  type ContextMenuTarget,
} from './context-menu';
import { recoverToolArgsFromInputPreview } from './tool-call-arg-recovery';
import { toolOutputDuplicatesError } from './tool-output-duplicates-error.js';
import { useToolEditDiffStats } from './use-tool-edit-diff-stats';
import { inkLineNodeClass, toolStatusToNodeStatus } from './session-node-status.js';
import { DesktopHealthToolCard } from './health-tool-card.js';
import { shouldShowApprovedSeal } from './tool-approved-seal.js';


export type ToolCallCardProps = {
  tool: ToolCardUi;
  /** Default expanded while running; collapsed when done. */
  defaultExpanded?: boolean | undefined;
  /** Controlled disclosure state for virtualized or otherwise remounted cards. */
  expanded?: boolean | undefined;
  /** Records an explicit user disclosure choice. */
  onExpandedChange?: ((expanded: boolean) => void) | undefined;
  /** Whether this card should automatically hold expanded focus while running. */
  expandWhileRunning?: boolean | undefined;
  /** Collapse both successful and failed terminal calls back to a timeline row. */
  collapseWhenTerminal?: boolean | undefined;
  /** @deprecated prefer density */
  compact?: boolean | undefined;
  density?: ToolCallDensity | undefined;
  /** Project root for DiffCard git/diff-file requests. */
  projectPath?: string | null | undefined;
  /** Host request adapter for DiffCard (same signature as ChangesPanel). */
  request?: DiffCardRequest | undefined;
  /** Callback when user clicks a matched file in tool results. */
  onOpenFile?: ((absolutePath: string, relativePath?: string) => void) | undefined;
  /** Open this edit's file diff in the right inspector (Cursor-style). */
  onOpenDiff?: ((absolutePath: string, relativePath?: string) => void) | undefined;
  /**
   * Callback when user clicks a logical document target (skill / project file).
   * Carries the owning message/tool identity so Doc Preview can recover the
   * persisted tool snapshot for historical reads.
   */
  onOpenDocument?: ((input: DocumentOpenInput) => void) | undefined;
  /** Locale for the stable behavior label. */
  locale?: 'zh-CN' | 'en';
  /** Compact sub-row on the same ink line (explore/batch children). */
  inkLineSubrow?: boolean | undefined;
  /** Show the 17px approved seal on auto-authorized rows (S5.8). */
  showApprovedSeal?: boolean | undefined;
};

export type DocumentOpenInput = {
  title: string;
  path?: string;
  /** Explicit inline content; empty string is a legal empty document. */
  content?: string;
  target?: DocumentTargetRef;
  /** Owning assistant message id (tool snapshot recovery). */
  messageId?: string;
  toolCallId?: string;
};

/**
 * Resolve a tool path (absolute or project-relative) into open-file args.
 * Reuses the same absolute/relative rules as search result pills.
 */
export function resolveToolOpenPath(
  filePath: string,
  projectPath?: string | null,
): { absolutePath: string; relativePath: string } {
  const formatted = formatFilePillPath(filePath, undefined, projectPath);
  return {
    absolutePath: formatted.absolutePath,
    relativePath: formatted.relativePath,
  };
}

function openResolvedToolPath(
  filePath: string,
  projectPath: string | null | undefined,
  onOpenFile: ((absolutePath: string, relativePath?: string) => void) | undefined,
): void {
  if (!onOpenFile) {
    return;
  }
  const resolved = resolveToolOpenPath(filePath, projectPath);
  onOpenFile(resolved.absolutePath, resolved.relativePath);
}

/** Clickable path list for expanded tool body (targetPaths / changedPaths). */
function ToolPathLinkList(props: {
  paths: string[];
  projectPath?: string | null | undefined;
  onOpenFile?: ((absolutePath: string, relativePath?: string) => void) | undefined;
  testId: string;
  prefix?: string | undefined;
}): ReactElement {
  const canOpen = Boolean(props.onOpenFile);
  return (
    <div className="tool-call-paths" data-testid={props.testId}>
      {props.prefix ? <span className="tool-call-paths-prefix">{props.prefix}</span> : null}
      {props.paths.map((filePath) => {
        const resolved = resolveToolOpenPath(filePath, props.projectPath);
        if (!canOpen) {
          return (
            <span key={filePath} className="pc tool-call-path-link static" title={resolved.absolutePath}>
              <IconFile className="i s12" />
              <span>{filePath}</span>
            </span>
          );
        }
        return (
          <button
            key={filePath}
            type="button"
            className="pc tool-call-path-link"
            title={resolved.absolutePath}
            data-testid="tool-call-path-link"
            data-full-path={resolved.absolutePath}
            onClick={() => {
              openResolvedToolPath(filePath, props.projectPath, props.onOpenFile);
            }}
          >
            <IconFile className="i s12" />
            <span>{filePath}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Logical document targets (skill:xxx / project-relative) for the expanded
 * tool body. Prefer these over raw absolute targetPaths — Host already
 * resolved identity and scope for us.
 */
function ToolDocumentTargetList(props: {
  targets: DocumentTargetRef[];
  toolCallId: string;
  onOpenDocument?: ((input: DocumentOpenInput) => void) | undefined;
  testId: string;
}): ReactElement {
  const canOpen = Boolean(props.onOpenDocument);
  return (
    <div className="tool-call-doc-targets" data-testid={props.testId}>
      {props.targets.map((target) => {
        const label = target.displayRef;
        if (!canOpen) {
          return (
            <span key={target.displayRef} className="pc tool-call-doc-target-link static" title={label}>
              <IconFile className="i s12" />
              <span>{label}</span>
            </span>
          );
        }
        return (
          <button
            key={target.displayRef}
            type="button"
            className="pc tool-call-doc-target-link"
            data-testid="tool-call-doc-target"
            data-target-ref={label}
            title={label}
            onClick={() => {
              const title =
                target.kind === 'skill'
                  ? target.skillId
                  : target.kind === 'media'
                    ? target.displayRef
                    : target.relativePath.split(/[\\/]/).pop() || target.relativePath;
              props.onOpenDocument?.({
                title,
                target,
                toolCallId: props.toolCallId,
              });
            }}
          >
            <IconFile className="i s12" />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * `data-kind` carries the shared six-state vocabulary (session-node-status.ts)
 * so this dot and the sidebar's InkLineNode are provably the same language,
 * not just coincidentally matching colors. Visual treatment (size, color,
 * breath) stays on the existing `.tool-status-dot`/`.status-*` classes —
 * unchanged, since it already renders identically to the shared node states.
 */
export function ToolStatusDot(props: {
  status: ToolCardUi['status'];
  /** Prototype ink-line node (`.node` / `.node.sm`). */
  inkLine?: boolean | undefined;
  small?: boolean | undefined;
}): ReactElement {
  const kind = toolStatusToNodeStatus(props.status);
  const protoClass = inkLineNodeClass(kind);
  if (props.inkLine === true) {
    return (
      <span
        className={`node${props.small === true ? ' sm' : ''}${protoClass ? ` ${protoClass}` : ''} tool-status-dot status-${props.status}`}
        data-kind={kind}
        title={props.status}
        aria-label={props.status}
      />
    );
  }
  return (
    <span
      className={`tool-status-dot status-${props.status}`}
      data-kind={kind}
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

function FetchCommandCode(props: { source: string }): ReactElement {
  const tokenLines = useHighlight(props.source, 'bash');
  return (
    <code>
      {tokenLines
        ? tokenLines.map((line, index) => (
            <span key={index} className="tool-call-command-line">
              <TokenSpans tokens={line} />
              {index < tokenLines.length - 1 ? '\n' : null}
            </span>
          ))
        : props.source}
    </code>
  );
}

export function ToolCallCard(props: ToolCallCardProps): ReactElement {
  const { tool } = props;
  const contextMenu = useDesktopContextMenu();
  const density = resolveDensity(props.density, props.compact);
  const expandWhileRunning = props.expandWhileRunning !== false;
  const terminalMustCollapse = props.collapseWhenTerminal === true && tool.status !== 'running';
  const hasExpandableBody = toolHasExpandableBody(tool);
  const autoExpand = terminalMustCollapse
    ? false
    : (props.defaultExpanded ??
      ((tool.status === 'running' && expandWhileRunning && hasExpandableBody) ||
        tool.status === 'error' ||
        (density === 'detailed' && hasExpandableBody)));
  const [internalExpanded, setInternalExpanded] = useState(autoExpand);
  const disclosureIntentRef = useRef<'automatic' | 'user-open' | 'user-closed'>('automatic');
  const expanded = props.expanded ?? internalExpanded;

  useEffect(() => {
    if (props.expanded !== undefined) {
      return;
    }
    if (disclosureIntentRef.current !== 'automatic') {
      return;
    }
    if (tool.status === 'running') {
      setInternalExpanded(expandWhileRunning && toolHasExpandableBody(tool));
    } else if (props.collapseWhenTerminal === true) {
      setInternalExpanded(false);
    } else if (tool.status === 'error') {
      setInternalExpanded(true);
    } else if (tool.status === 'done' && (density !== 'detailed' || !toolHasExpandableBody(tool))) {
      setInternalExpanded(false);
    } else if (density === 'compact') {
      setInternalExpanded(false);
    } else if (density === 'detailed' && toolHasExpandableBody(tool)) {
      setInternalExpanded(true);
    }
  }, [
    tool.status,
    tool.output,
    density,
    props.collapseWhenTerminal,
    props.defaultExpanded,
    props.expanded,
    expandWhileRunning,
  ]);

  function toggleExpanded(): void {
    const nextExpanded = !expanded;
    disclosureIntentRef.current = nextExpanded ? 'user-open' : 'user-closed';
    if (props.expanded === undefined) {
      setInternalExpanded(nextExpanded);
    }
    props.onExpandedChange?.(nextExpanded);
  }

  const displayOutput = tool.presentation?.output?.text ?? tool.output;
  const outputTruncation = tool.presentation?.output?.truncation;
  const outputTruncated =
    tool.presentation?.output?.truncated === true || outputTruncation !== undefined;
  // Prefer the structured error row; hide the body pre when it only repeats that text.
  const bodyOutput = toolOutputDuplicatesError(displayOutput, tool.presentation?.error)
    ? undefined
    : displayOutput;
  const citations = parseToolCitations(tool.toolName, displayOutput);
  const displayName = tool.presentation?.title ?? tool.toolName;
  const kind = tool.presentation?.kind ?? 'unknown';
  const recoveredArgs = recoverToolArgsFromInputPreview(tool.presentation?.inputPreview);
  const targetPaths =
    tool.presentation?.targetPaths && tool.presentation.targetPaths.length > 0
      ? tool.presentation.targetPaths
      : recoveredArgs.paths;
  const command = tool.presentation?.command ?? recoveredArgs.command;
  // Prefer host changedPaths; fall back to write-like targetPaths so DiffCard
  // still works for older transcripts that only stored targetPaths.
  const isWriteLikeTool =
    tool.presentation?.actionVerb === 'Edited' || /write|edit|replace|patch/i.test(tool.toolName);
  const changedPaths =
    tool.status !== 'error' &&
    tool.presentation?.changedPaths &&
    tool.presentation.changedPaths.length > 0
      ? tool.presentation.changedPaths
      : tool.status !== 'error' && isWriteLikeTool
        ? targetPaths
        : [];
  const hasChangedPaths = changedPaths.length > 0;
  const canRenderDiffCard =
    tool.status !== 'error' &&
    hasChangedPaths &&
    Boolean(props.projectPath) &&
    Boolean(props.request);
  const rawActionVerb = tool.presentation?.actionVerb ?? kindVerb(kind, tool.toolName);
  const baseBehaviorId = resolveToolBehaviorId({
    kind,
    toolName: tool.toolName,
    actionVerb: rawActionVerb,
  });
  const behaviorId = resolveToolBehaviorStateId(baseBehaviorId, tool.status);
  const behaviorSpec = getBehaviorActivitySpec(behaviorId);
  const locale = props.locale ?? 'en';
  const truncationCopy = outputTruncated
    ? formatToolOutputTruncation({
        locale,
        isRead: baseBehaviorId === 'read',
        isWeb: kind === 'web' || baseBehaviorId === 'web.fetch',
        ...(outputTruncation !== undefined ? { truncation: outputTruncation } : {}),
      })
    : undefined;
  const actionVerb = localizeBehaviorAction(behaviorId, locale, rawActionVerb);
  const multiPath = targetPaths.length > 1;
  const isQueryLike =
    baseBehaviorId === 'search' ||
    baseBehaviorId === 'explore' ||
    baseBehaviorId === 'web.search' ||
    baseBehaviorId === 'web.fetch' ||
    baseBehaviorId === 'image' ||
    baseBehaviorId === 'mcp.call' ||
    baseBehaviorId === 'mcp.discovery';
  const isPathLike =
    baseBehaviorId === 'read' || baseBehaviorId === 'edit' || baseBehaviorId === 'git';
  const isEditTool = baseBehaviorId === 'edit';
  const lineRange = tool.presentation?.lineRange ?? recoveredArgs.lineRange;
  const rawSummary =
    tool.status === 'error'
      ? (command ??
        (targetPaths.length > 0 ? targetPaths.join(', ') : displayName))
      : (tool.presentation?.summary ??
        command ??
        (targetPaths.length > 0 ? targetPaths.join(', ') : displayName));
  // Prefer host inputPreview; fall back when legacy presentations stuffed JSON into summary.
  const inputPreview =
    tool.presentation?.inputPreview ||
    (looksLikeArgsDumpSummary(rawSummary) ? rawSummary : undefined);
  // Legacy image_gen rows stored paths JSON as summary after tool/end; recover the
  // prompt from inputPreview so the header stays human-readable on old transcripts.
  const recoveredSummary =
    looksLikeArgsDumpSummary(rawSummary) || !rawSummary
      ? recoverSummaryFromInputPreview(tool.presentation?.inputPreview)
      : undefined;
  const summary = recoveredSummary ?? rawSummary;

  // Cursor-style head:
  //  - Read/Edited/Git path tools → file pill (single or "a and N other files")
  //  - Searched/Explored/Fetched/shell → mono query/command preview
  // Prefer the full Host path in the pill; basename-only hid too much for remote.
  const primaryPathLabel = targetPaths[0] ?? '';
  const summaryLooksLikeToolName = summary === displayName || summary === tool.toolName;
  const showFilePill =
    !isQueryLike &&
    (targetPaths.length >= 1 ||
      (isPathLike && Boolean(summary) && !summaryLooksLikeToolName));
  const pillLabel = multiPath || (isPathLike && !targetPaths[0]) ? summary : primaryPathLabel;
  const primaryTargetPath = targetPaths[0];
  const primaryOpenPath = primaryTargetPath
    ? resolveToolOpenPath(primaryTargetPath, props.projectPath)
    : null;
  const canOpenPath = Boolean(primaryTargetPath && (props.onOpenFile || props.onOpenDiff));
  const diffStats = useToolEditDiffStats({
    enabled:
      isEditTool &&
      tool.status !== 'error' &&
      Boolean(primaryOpenPath) &&
      Boolean(props.projectPath) &&
      Boolean(props.request),
    projectPath: props.projectPath,
    path: primaryOpenPath?.relativePath,
    request: props.request,
    fallback: isEditTool && tool.status !== 'error' ? recoveredArgs.diffStats : undefined,
  });
  const isArgsDumpSummary =
    !recoveredSummary &&
    (Boolean(inputPreview && summary === inputPreview) || looksLikeArgsDumpSummary(summary));
  const isMcpBehavior = baseBehaviorId === 'mcp.call' || baseBehaviorId === 'mcp.discovery';
  const isFetchStyle =
    baseBehaviorId === 'web.fetch' ||
    (baseBehaviorId === 'shell' && isFetchLikeShellCommand(command));
  const fetchRequestPreview = isFetchStyle
    ? (command ?? resolveFetchRequestPreview(inputPreview, summary))
    : undefined;
  const shellHeaderSummary =
    baseBehaviorId === 'shell' ? (extractCommandDescription(command) ?? summary) : summary;
  const headerSummary = isMcpBehavior
    ? resolveMcpHeaderPreview({
        displayName,
        toolName: tool.toolName,
        summary: shellHeaderSummary,
        ...(inputPreview !== undefined ? { inputPreview } : {}),
      })
    : shellHeaderSummary;
  const displayActionVerb = actionVerb;
  const previewText = resolveToolCallHeaderPreview({
    summary: headerSummary,
    displayName,
    showFilePill,
    pillLabel: pillLabel || '',
    singleBasename: primaryPathLabel || '',
    isPathLike,
    expanded,
    isArgsDumpSummary: isMcpBehavior ? false : isArgsDumpSummary,
    keepTitlePreview: isMcpBehavior,
  });
  const previewClassName =
    isQueryLike || baseBehaviorId === 'shell' ? 'tool-call-preview is-query' : 'tool-call-preview';
  const behaviorClassName =
    tool.status === 'error'
      ? 'behavior-error'
      : behaviorTextClass(baseBehaviorId, tool.status === 'running');

  const hasBody =
    Boolean(bodyOutput) ||
    citations.kind !== 'none' ||
    Boolean(command) ||
    Boolean(inputPreview) ||
    targetPaths.length > 0 ||
    hasChangedPaths ||
    Boolean(tool.presentation?.error) ||
    Boolean(outputTruncation);

  function activateSummary(): void {
    const path = primaryTargetPath;
    if (isEditTool && path) {
      if (props.onOpenDiff) {
        const resolved = resolveToolOpenPath(path, props.projectPath);
        props.onOpenDiff(resolved.absolutePath, resolved.relativePath);
        return;
      }
      if (props.onOpenFile) {
        openResolvedToolPath(path, props.projectPath, props.onOpenFile);
        return;
      }
      if (canRenderDiffCard) {
        toggleExpanded();
        return;
      }
    }
    if (isPathLike && path && props.onOpenFile) {
      openResolvedToolPath(path, props.projectPath, props.onOpenFile);
      return;
    }
    if (hasBody) {
      toggleExpanded();
    }
  }

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

  if (kind === 'health') {
    return (
      <div data-testid="tool-call-card" data-tool-kind="health" data-tool-name={tool.toolName}>
        <DesktopHealthToolCard
          {...(tool.presentation === undefined ? {} : { presentation: tool.presentation })}
          toolStatus={tool.status}
        />
      </div>
    );
  }

  const inkNodeKind = toolStatusToNodeStatus(tool.status);
  const inkNodeClass = inkLineNodeClass(inkNodeKind);
  const showApprovedSeal =
    props.showApprovedSeal !== false && shouldShowApprovedSeal(tool);
  const card = (
    <div
      className={`tr tool-call-card density-${density} status-${tool.status}${
        expanded ? ' is-expanded' : ''
      }${isFetchStyle ? ' is-fetch-style' : ''}${props.inkLineSubrow === true ? ' sub' : ''}${
        tool.status === 'error' ? ' fail' : ''
      }`}
      data-testid="tool-call-card"
      data-tool-name={tool.toolName}
      data-tool-kind={kind}
      data-tool-status={tool.status}
      data-action-verb={displayActionVerb}
      data-activity-id={behaviorId}
      data-activity-animation={behaviorSpec.animation}
      data-density={density}
      data-tool-visual={isFetchStyle ? 'fetch' : undefined}
    >
      {/*
        Summary is a div (not a <button>) so the openable file pill can be a
        real button without illegal nested interactive content.
      */}
      <div
        className="tool-call-summary"
        onClick={activateSummary}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            activateSummary();
          }
        }}
        role="button"
        aria-expanded={expanded}
        aria-label={`${displayActionVerb} ${headerSummary || displayName} ${tool.status}`}
        tabIndex={0}
      >
        <span
          className={`node${props.inkLineSubrow === true ? ' sm' : ''}${inkNodeClass ? ` ${inkNodeClass}` : ''}`}
          data-kind={inkNodeKind}
          aria-hidden="true"
        />
        {toolCallKindIcon(kind, tool.toolName, rawActionVerb, baseBehaviorId)}
        <b className={`tool-call-action-verb ${behaviorClassName}`}>{displayActionVerb}</b>
        {!expanded && showFilePill && pillLabel ? (
          <span
            className={`tool-call-file-pill${canOpenPath ? ' is-link' : ''}`}
            data-testid="tool-call-file-pill"
            title={primaryOpenPath?.absolutePath ?? pillLabel}
          >
            <span className="tool-call-file-name">{pillLabel}</span>
            {!multiPath && lineRange ? (
              <span className="tool-call-line-range" data-testid="tool-call-line-range">
                {lineRange}
              </span>
            ) : null}
          </span>
        ) : null}
        {!expanded && previewText ? (
          <code className={previewClassName}>
            {previewText}
            {tool.presentation?.countTag ? (
              <span className="tool-call-count-inline" data-testid="tool-call-count-inline">
                {' · '}
                {tool.presentation.countTag}
              </span>
            ) : null}
          </code>
        ) : !expanded && tool.presentation?.countTag ? (
          <span className="tool-call-count-tag">{tool.presentation.countTag}</span>
        ) : null}
        {tool.status === 'done' ? (
          <span
            className="tool-call-ok"
            data-kind="success"
            aria-label="done"
            data-testid="tool-call-ok"
          />
        ) : tool.status === 'error' ? (
          <span
            className="tool-call-err"
            data-kind="failed"
            aria-label="error"
            data-testid="tool-call-err"
          />
        ) : (
          <ToolStatusDot status={tool.status} />
        )}
        <span className="meta tool-call-meta">
          {diffStats && (diffStats.added > 0 || diffStats.removed > 0) ? (
            <span className="pm tool-call-diff-stats" data-testid="tool-call-diff-stats">
              {diffStats.added > 0 ? <span className="plus add">+{diffStats.added}</span> : null}
              {diffStats.removed > 0 ? (
                <span className="minus del">−{diffStats.removed}</span>
              ) : null}
            </span>
          ) : null}
          {truncationCopy ? (
            <span
              className="tool-call-truncated-tag"
              data-testid="tool-call-output-truncated"
              aria-label={truncationCopy.ariaLabel}
              title={truncationCopy.notice}
            >
              {truncationCopy.summary}
            </span>
          ) : null}
          {showApprovedSeal ? (
            <span className="seal mini" title="已批准 · 允许一次" data-testid="tool-approved-seal">
              允
            </span>
          ) : null}
          {typeof tool.presentation?.durationMs === 'number' ? (
            <span className="tool-call-duration" data-testid="tool-call-duration">
              {formatToolDuration(tool.presentation.durationMs)}
            </span>
          ) : tool.status === 'running' ? (
            <span className="tool-call-duration tool-call-duration-live">…</span>
          ) : null}
          {hasBody ? (
            <span
              className="tool-call-chevron-hit chev"
              role="button"
              tabIndex={0}
              aria-label={expanded ? 'Collapse' : 'Expand'}
              onClick={(event) => {
                event.stopPropagation();
                toggleExpanded();
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  event.stopPropagation();
                  toggleExpanded();
                }
              }}
            >
              <IconChevronDown
                className={expanded ? 'tool-call-chevron open' : 'tool-call-chevron'}
              />
            </span>
          ) : null}
        </span>
      </div>
      {expanded && hasBody ? (
        <div className={`tool-call-body tb${tool.status === 'error' ? ' err' : ''}`}>
          {truncationCopy ? (
            <div
              className="tool-call-output-notice"
              data-testid="tool-call-output-notice"
              role="status"
            >
              {truncationCopy.notice}
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
          {tool.presentation?.documentTargets && tool.presentation.documentTargets.length > 0 ? (
            <ToolDocumentTargetList
              targets={tool.presentation.documentTargets}
              toolCallId={tool.toolCallId}
              onOpenDocument={props.onOpenDocument}
              testId="tool-call-doc-targets"
            />
          ) : null}
          {tool.presentation?.targetPaths && tool.presentation.targetPaths.length > 0 ? (
            <ToolPathLinkList
              paths={tool.presentation.targetPaths}
              projectPath={props.projectPath}
              onOpenFile={props.onOpenFile}
              testId="tool-call-paths"
            />
          ) : null}
          {!canRenderDiffCard && hasChangedPaths ? (
            <ToolPathLinkList
              paths={changedPaths}
              projectPath={props.projectPath}
              onOpenFile={props.onOpenFile}
              testId="tool-call-changed-paths"
              prefix="changed: "
            />
          ) : null}
          {tool.presentation?.error ? (
            <div className="tool-call-error" data-testid="tool-call-error" role="status">
              {tool.presentation.error.category}: {tool.presentation.error.message}
            </div>
          ) : null}
          {isFetchStyle && fetchRequestPreview ? (
            <div className="tool-call-fetch-panel" data-testid="tool-call-fetch-panel">
              <div className="tool-call-command is-fetch-command" data-testid="tool-call-command">
                <span className="tool-call-command-prompt" aria-hidden="true">
                  $
                </span>
                <FetchCommandCode source={fetchRequestPreview} />
                <span className="tool-call-command-menu" aria-hidden="true">
                  <IconMore />
                </span>
              </div>
            </div>
          ) : null}
          <CitationCards parsed={citations} />
          {!isFetchStyle &&
          (command ||
            inputPreview ||
            (bodyOutput && citations.kind === 'none' && !canRenderDiffCard)) ? (
            <CollapsibleContentBlock maxCollapsedHeight={130} defaultCollapsed>
              {command ? (
                <div className="tool-call-command" data-testid="tool-call-command">
                  <code>{command}</code>
                  {typeof tool.presentation?.exitCode === 'number' ? (
                    <span className="dim"> exit {tool.presentation.exitCode}</span>
                  ) : null}
                </div>
              ) : null}
              {!command && inputPreview ? (
                <div className="tool-call-command" data-testid="tool-call-input-preview">
                  <code>{inputPreview}</code>
                </div>
              ) : null}
              {bodyOutput && citations.kind === 'none' && !canRenderDiffCard ? (
                <pre className="tool-call-output">
                  {(bodyOutput ?? '').slice(0, density === 'compact' ? 2000 : 8000)}
                </pre>
              ) : null}
            </CollapsibleContentBlock>
          ) : null}
          {isFetchStyle && bodyOutput && citations.kind === 'none' && !canRenderDiffCard ? (
            <CollapsibleContentBlock maxCollapsedHeight={130} defaultCollapsed>
              <pre className="tool-call-output">
                {(bodyOutput ?? '').slice(0, density === 'compact' ? 2000 : 8000)}
              </pre>
            </CollapsibleContentBlock>
          ) : null}
          {bodyOutput && citations.kind === 'none' && canRenderDiffCard ? (
            <details className="tool-call-raw-fold">
              <summary>raw output</summary>
              <pre className="tool-call-output">
                {(bodyOutput ?? '').slice(0, density === 'compact' ? 2000 : 8000)}
              </pre>
            </details>
          ) : null}
          {bodyOutput && citations.kind !== 'none' ? (
            <details open={density === 'detailed'} className="tool-call-raw-fold">
              <summary className="dim">raw tool output</summary>
              <pre className="tool-call-output">{(bodyOutput ?? '').slice(0, 4000)}</pre>
            </details>
          ) : null}
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
