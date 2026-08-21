/**
 * Cursor-style "Explored N files" capsule for a cross-message explore flow.
 *
 * Live groups stay expanded so rows stream in with the running shimmer; when
 * the flow closes the capsule auto-collapses to a one-line summary (unless the
 * user toggled it, or a grouped tool failed). Thought segments render as
 * expandable "Thought for Ns" rows between tool rows, matching the causal
 * order of the underlying assistant messages.
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { DiffCardRequest } from './diff-card';
import type { ExploreFlowGroup, ExploreFlowItem } from './explore-flow';
import { ToolCallCard, ToolStatusDot, type DocumentOpenInput } from './tool-call-card';
import { ActionMarquee } from './action-marquee';
import { formatActiveToolLabel, formatExploreCapsuleTitle } from './tool-batch-capsule';
import {
  IconAlertCircle,
  IconBrain,
  IconChevronDown,
  IconSearch,
} from './shell-icons';

export type ExploreFlowCapsuleProps = {
  group: ExploreFlowGroup;
  locale?: 'zh-CN' | 'en';
  /** Hide thought rows when the user disabled thinking display. */
  showThinking?: boolean;
  projectPath?: string | null;
  request?: DiffCardRequest;
  onOpenFile?: (absolutePath: string, relativePath?: string) => void;
  onOpenDiff?: (absolutePath: string, relativePath?: string) => void;
  onOpenDocument?: ((input: DocumentOpenInput) => void) | undefined;
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  return seconds < 10 ? `${seconds.toFixed(1)}s` : `${Math.round(seconds)}s`;
}

export function exploreFlowTitle(group: ExploreFlowGroup, isChinese: boolean): string {
  return formatExploreCapsuleTitle({
    fileCount: group.fileCount,
    searchCount: group.searchCount,
    totalCount: group.toolCount,
    live: group.isLive,
    isChinese,
  });
}

function thoughtLabel(
  item: Extract<ExploreFlowItem, { kind: 'thought' }>,
  isChinese: boolean,
): string {
  if (item.live) {
    return isChinese ? '思考中' : 'Thinking';
  }
  if (item.seconds !== undefined) {
    return isChinese ? `已思考 ${item.seconds} 秒` : `Thought for ${item.seconds}s`;
  }
  return isChinese ? '思考过程' : 'Thoughts';
}

function ThoughtFlowRow(props: {
  item: Extract<ExploreFlowItem, { kind: 'thought' }>;
  isChinese: boolean;
}): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <div className={`explore-thought${props.item.live ? ' is-live' : ''}`}>
      <button
        type="button"
        className="explore-thought-row"
        data-testid="explore-thought-row"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <IconBrain className="explore-thought-icon" />
        <span
          className={`explore-thought-label${
            props.item.live ? ' behavior-thinking-active' : ''
          }`}
        >
          {thoughtLabel(props.item, props.isChinese)}
        </span>
        <IconChevronDown
          className={open ? 'explore-thought-chevron open' : 'explore-thought-chevron'}
          aria-hidden="true"
        />
      </button>
      {open ? (
        <div className="turn-thinking explore-thought-body" data-testid="explore-thought-body">
          <pre>{props.item.text}</pre>
        </div>
      ) : null}
    </div>
  );
}

export function ExploreFlowCapsule(props: ExploreFlowCapsuleProps): ReactElement {
  const isChinese = (props.locale ?? 'zh-CN') === 'zh-CN';
  const group = props.group;
  const hasError = group.errorCount > 0;
  const autoOpen = group.isLive || hasError;
  const [internalExpanded, setInternalExpanded] = useState(autoOpen);
  const disclosureIntentRef = useRef<'automatic' | 'user-open' | 'user-closed'>('automatic');
  const expanded = internalExpanded;

  // Live flows stay open so rows stream in; once the flow closes it folds back
  // to the summary line unless the user pinned it (or an op failed).
  useEffect(() => {
    if (disclosureIntentRef.current !== 'automatic') {
      return;
    }
    setInternalExpanded(group.isLive || hasError);
  }, [group.isLive, hasError]);

  function toggleExpanded(): void {
    const nextExpanded = !expanded;
    disclosureIntentRef.current = nextExpanded ? 'user-open' : 'user-closed';
    setInternalExpanded(nextExpanded);
  }

  const runningToolItem = group.hasRunning
    ? group.items.find(
        (item): item is Extract<ExploreFlowItem, { kind: 'tool' }> =>
          item.kind === 'tool' && item.tool.status === 'running',
      )
    : undefined;
  const activeLabel = runningToolItem
    ? formatActiveToolLabel(runningToolItem.tool, isChinese)
    : undefined;

  const visibleItems =
    props.showThinking === false
      ? group.items.filter((item) => item.kind !== 'thought')
      : group.items;

  return (
    <div
      className={`tool-batch-capsule explore-flow-capsule${
        expanded ? ' is-expanded' : ' is-collapsed'
      }${hasError ? ' has-error' : ''}${group.isLive ? ' is-running' : ''}`}
      data-testid="explore-flow-capsule"
      data-expanded={expanded ? 'true' : 'false'}
      data-live={group.isLive ? 'true' : 'false'}
    >
      <button
        type="button"
        className="tool-batch-header"
        data-testid="explore-flow-header"
        aria-expanded={expanded}
        onClick={toggleExpanded}
      >
        <span className="tool-batch-icon-wrapper" aria-hidden="true">
          <IconSearch className="tool-batch-kind-icon" />
        </span>

        <div className="tool-batch-title-group">
          <span
            className={`tool-batch-title${group.isLive ? ' behavior-explore-active' : ''}`}
            data-testid="explore-flow-title"
          >
            {exploreFlowTitle(group, isChinese)}
          </span>
          {group.isLive && !expanded && activeLabel ? (
            <ActionMarquee className="tool-batch-marquee" activeText={activeLabel} />
          ) : null}
        </div>

        <div className="tool-batch-meta">
          {group.isLive ? (
            <span className="tool-batch-status-running" aria-label="running">
              <ToolStatusDot status="running" />
            </span>
          ) : hasError ? (
            <span
              className="tool-batch-status-error"
              aria-label="error"
              title={`${group.errorCount} failed`}
            >
              <IconAlertCircle className="tool-batch-error-icon" />
              <span className="tool-batch-error-count">
                {isChinese ? `${group.errorCount} 项失败` : `${group.errorCount} failed`}
              </span>
            </span>
          ) : null}

          {!group.isLive && typeof group.totalDurationMs === 'number' ? (
            <span className="tool-call-duration" data-testid="explore-flow-duration">
              {formatDuration(group.totalDurationMs)}
            </span>
          ) : null}

          <IconChevronDown
            className={expanded ? 'tool-batch-chevron open' : 'tool-batch-chevron'}
            aria-hidden="true"
          />
        </div>
      </button>

      {expanded ? (
        <div className="tool-batch-body" data-testid="explore-flow-body">
          <div className="tool-batch-timeline-track" aria-hidden="true" />
          <div className="tool-batch-items">
            {visibleItems.map((item, index) =>
              item.kind === 'thought' ? (
                <ThoughtFlowRow
                  key={`thought-${item.messageId}-${index}`}
                  item={item}
                  isChinese={isChinese}
                />
              ) : (
                <ToolCallCard
                  key={item.tool.toolCallId}
                  tool={item.tool}
                  density="compact"
                  expandWhileRunning={false}
                  {...(props.projectPath !== undefined ? { projectPath: props.projectPath } : {})}
                  {...(props.request !== undefined ? { request: props.request } : {})}
                  {...(props.onOpenFile !== undefined ? { onOpenFile: props.onOpenFile } : {})}
                  {...(props.onOpenDiff !== undefined ? { onOpenDiff: props.onOpenDiff } : {})}
                  {...(props.onOpenDocument !== undefined
                    ? { onOpenDocument: props.onOpenDocument }
                    : {})}
                  {...(props.locale !== undefined ? { locale: props.locale } : {})}
                />
              ),
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
