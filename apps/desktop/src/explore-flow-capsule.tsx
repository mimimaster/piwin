/**
 * Cursor-style "Explored N files" capsule for a cross-message explore flow.
 *
 * Stays collapsed by default — including while live — so the call chain stays
 * a one-line summary (marquee shows the active tool). Only a grouped failure
 * auto-opens; the user can still pin it open. Thought segments render as
 * expandable thought rows (title left, duration on the far right) between
 * tool rows, matching the causal order of the underlying assistant messages.
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useTranscriptLocalFoldMeasure } from './use-transcript-local-fold-measure.js';
import type { DiffCardRequest } from './diff-card';
import type { ExploreFlowGroup, ExploreFlowItem } from './explore-flow';
import { ToolCallCard, ToolStatusDot, type DocumentOpenInput } from './tool-call-card';
import { ActionMarquee } from './action-marquee';
import {
  formatActiveToolLabel,
  formatExploreCapsuleTitle,
  exploreFlowTitleParts,
} from './tool-batch-capsule';
import { inkLineNodeClass, toolStatusToNodeStatus } from './session-node-status.js';
import {
  IconAlertCircle,
  IconBrain,
  IconChevronDown,
} from './shell-icons';
import { ChainIconSearch } from './inkstone-chain-icons.js';
import { WorkElapsed } from './work-fold-header.js';

export { exploreFlowTitleParts } from './tool-batch-capsule';

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
  return isChinese ? '思考过程' : 'Thoughts';
}

function thoughtElapsedProps(
  item: Extract<ExploreFlowItem, { kind: 'thought' }>,
): { startedAt: number } | { elapsedMs: number } | undefined {
  if (item.live && item.startedAt !== undefined) {
    return { startedAt: item.startedAt };
  }
  if (item.seconds !== undefined) {
    return { elapsedMs: item.seconds * 1000 };
  }
  return undefined;
}

function ThoughtFlowRow(props: {
  item: Extract<ExploreFlowItem, { kind: 'thought' }>;
  isChinese: boolean;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const foldMeasure = useTranscriptLocalFoldMeasure(open);
  const elapsed = thoughtElapsedProps(props.item);
  return (
    <div
      ref={foldMeasure.setRoot}
      className={`tr sub explore-thought${props.item.live ? ' is-live' : ''}${open ? ' is-open' : ''}`}
    >
      <button
        type="button"
        className="explore-thought-row"
        data-testid="explore-thought-row"
        aria-expanded={open}
        onClick={() => {
          foldMeasure.onUserToggle();
          setOpen((current) => !current);
        }}
      >
        <span
          className={`node sm ${props.item.live ? 'run' : 'done'}`}
          data-kind={props.item.live ? 'running' : 'success'}
          aria-hidden="true"
        />
        <IconBrain className="explore-thought-icon i s14" />
        <span
          className={`explore-thought-label${
            props.item.live ? ' behavior-thinking-active' : ''
          }`}
        >
          {thoughtLabel(props.item, props.isChinese)}
        </span>
        <span className="meta">
          {elapsed ? <WorkElapsed {...elapsed} /> : null}
          <IconChevronDown
            className={open ? 'explore-thought-chevron chev open' : 'explore-thought-chevron chev'}
            aria-hidden="true"
          />
        </span>
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
  const cancelledOnly = !hasError && group.cancelledCount > 0;
  const [internalExpanded, setInternalExpanded] = useState(hasError);
  const disclosureIntentRef = useRef<'automatic' | 'user-open' | 'user-closed'>('automatic');
  const expanded = internalExpanded;
  const foldMeasure = useTranscriptLocalFoldMeasure(expanded);

  // Explore stays folded unless a grouped tool failed (or the user pinned it).
  // Collapsing unmounts the list — `isLive` must not flicker across empty
  // `message/start` placeholders (see buildExploreFlowRoles).
  useEffect(() => {
    if (disclosureIntentRef.current !== 'automatic') {
      return;
    }
    if (hasError) {
      setInternalExpanded(true);
    }
  }, [hasError]);

  function toggleExpanded(): void {
    foldMeasure.onUserToggle();
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

  const headerStatus = hasError ? 'error' : group.isLive ? 'running' : 'done';
  const headerNodeKind = toolStatusToNodeStatus(headerStatus);
  const headerNodeClass = inkLineNodeClass(headerNodeKind);
  return (
    <div
      ref={foldMeasure.setRoot}
      className={`tr tool-batch-capsule explore-flow-capsule${
        expanded ? ' is-expanded' : ' is-collapsed'
      }${hasError ? ' has-error fail' : ''}${cancelledOnly ? ' is-cancelled' : ''}${
        group.isLive ? ' is-running' : ''
      }`}
      data-testid="explore-flow-capsule"
      data-expanded={expanded ? 'true' : 'false'}
      data-live={group.isLive ? 'true' : 'false'}
    >
      <span
        className={`node${headerNodeClass ? ` ${headerNodeClass}` : ''}`}
        data-kind={headerNodeKind}
        aria-hidden="true"
      />
      <button
        type="button"
        className="tool-batch-header"
        data-testid="explore-flow-header"
        aria-expanded={expanded}
        onClick={toggleExpanded}
      >
        <span className="tool-batch-icon-wrapper" aria-hidden="true">
          <ChainIconSearch className="tool-batch-kind-icon" />
        </span>

        <div className="tool-batch-title-group" data-testid="explore-flow-title">
          {(() => {
            const parts = exploreFlowTitleParts(group, isChinese);
            return (
              <>
                <b
                  className={`tool-batch-title${group.isLive ? ' behavior-explore-active' : ''}`}
                >
                  {parts.lead}
                </b>
                {parts.rest ? <span className="tool-batch-title-rest">{parts.rest}</span> : null}
              </>
            );
          })()}
          {group.isLive && !expanded && activeLabel ? (
            <ActionMarquee className="tool-batch-marquee" activeText={activeLabel} />
          ) : null}
        </div>

        <div className="tool-batch-meta meta">
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

          {!group.isLive ? (
            <span className="tool-call-duration" data-testid="explore-flow-duration">
              {isChinese ? `${group.toolCount} 工具` : `${group.toolCount} tools`}
              {typeof group.totalDurationMs === 'number'
                ? ` · ${formatDuration(group.totalDurationMs)}`
                : ''}
            </span>
          ) : null}

          <IconChevronDown
            className={`i s12 chev${expanded ? ' tool-batch-chevron open' : ' tool-batch-chevron'}`}
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
                  inkLineSubrow
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
