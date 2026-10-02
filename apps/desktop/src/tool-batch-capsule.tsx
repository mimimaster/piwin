import { useState, type ReactElement, type ReactNode } from 'react';
import { useTranscriptLocalFoldMeasure } from './use-transcript-local-fold-measure.js';
import type { ToolCardUi } from './chat-reducer';
import type { ToolCallDensity } from './ui-preferences';
import type { DiffCardRequest } from './diff-card';
import {
  ToolCallCard,
  ToolStatusDot,
  type DocumentOpenInput,
} from './tool-call-card';
import { inkLineNodeClass, toolStatusToNodeStatus } from './session-node-status.js';
import {
  type ToolClusterKind,
  type BatchClusterSummary,
} from './tool-group-clustering';
export { formatActiveToolLabel, formatExploreCapsuleTitle, exploreFlowTitleParts } from './tool-batch-labels.js';
import { formatActiveToolLabel, exploreFlowTitleParts, getBatchTitle, getRunningBatchTitle } from './tool-batch-labels.js';
import { ActionMarquee } from './action-marquee';
import {
  IconAlertCircle,
  IconChevronDown,
} from './shell-icons';
import {
  ChainIconSearch,
  ChainIconRead,
  ChainIconShell,
  ChainIconWeb,
  ChainIconTool,
} from './inkstone-chain-icons.js';

export type ToolBatchCapsuleProps = {
  /** Backend workflows reuse the same disclosure, timeline and activity header. */
  title?: string;
  activeLabel?: string;
  meta?: ReactNode;
  children?: ReactNode;
  defaultOpenWhileRunning?: boolean;
  clusterKind: ToolClusterKind;
  tools: ToolCardUi[];
  summary: BatchClusterSummary;
  density?: ToolCallDensity;
  locale?: 'zh-CN' | 'en';
  projectPath?: string | null;
  request?: DiffCardRequest;
  onOpenFile?: (absolutePath: string, relativePath?: string) => void;
  onOpenDiff?: (absolutePath: string, relativePath?: string) => void;
  onOpenDocument?: ((input: DocumentOpenInput) => void) | undefined;
};

function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const seconds = ms / 1000;
  return seconds < 10 ? `${seconds.toFixed(1)}s` : `${Math.round(seconds)}s`;
}

function getClusterIcon(kind: ToolClusterKind): ReactElement {
  switch (kind) {
    case 'explore':
    case 'search':
      return <ChainIconSearch className="tool-batch-kind-icon" />;
    case 'read':
      return <ChainIconRead className="tool-batch-kind-icon" />;
    case 'command':
      return <ChainIconShell className="tool-batch-kind-icon" />;
    case 'web':
      return <ChainIconWeb className="tool-batch-kind-icon" />;
    default:
      return <ChainIconTool className="tool-batch-kind-icon" />;
  }
}

export function ToolBatchCapsule(props: ToolBatchCapsuleProps): ReactElement {
  const isChinese = (props.locale ?? 'zh-CN') === 'zh-CN';
  const summary = props.summary;
  type BatchDisclosure = 'automatic' | 'live-open' | 'settled-open' | 'closed';
  const [disclosure, setDisclosure] = useState<BatchDisclosure>('automatic');
  const expanded =
    disclosure === 'closed'
      ? false
      : summary.hasError ||
        (summary.hasRunning
          ? disclosure === 'live-open' || (disclosure === 'automatic' && props.defaultOpenWhileRunning === true)
          : disclosure === 'settled-open');
  const foldMeasure = useTranscriptLocalFoldMeasure(expanded);

  function toggleExpanded(): void {
    foldMeasure.onUserToggle();
    if (expanded) {
      setDisclosure('closed');
      return;
    }
    setDisclosure(summary.hasRunning ? 'live-open' : 'settled-open');
  }

  const isExploreLike =
    props.clusterKind === 'explore' ||
    props.clusterKind === 'read' ||
    props.clusterKind === 'search';

  const parts = props.title ? { lead: props.title, rest: null } : isExploreLike
    ? exploreFlowTitleParts(
        {
          fileCount: summary.fileCount ?? 0,
          searchCount: summary.searchCount ?? 0,
          totalCount: summary.totalCount,
          isLive: Boolean(summary.hasRunning),
        },
        isChinese,
      )
    : {
        lead: summary.hasRunning
          ? getRunningBatchTitle(props.clusterKind, summary, isChinese)
          : getBatchTitle(props.clusterKind, summary, isChinese),
        rest: null,
      };

  const activeLabel = props.activeLabel ?? (summary.activeTool
    ? formatActiveToolLabel(summary.activeTool, isChinese)
    : undefined);

  const headerStatus = summary.hasError ? 'error' : summary.hasRunning ? 'running' : 'done';
  const headerNodeKind = toolStatusToNodeStatus(headerStatus);
  const headerNodeClass = inkLineNodeClass(headerNodeKind);
  return (
    <div
      ref={foldMeasure.setRoot}
      className={`tr tool-batch-capsule${expanded ? ' is-expanded' : ' is-collapsed'}${
        summary.hasError ? ' has-error fail' : ''
      }${summary.hasRunning ? ' is-running' : ''}`}
      data-testid="tool-batch-capsule"
      data-cluster-kind={props.clusterKind}
      data-expanded={expanded ? 'true' : 'false'}
    >
      <span
        className={`node${headerNodeClass ? ` ${headerNodeClass}` : ''}`}
        data-kind={headerNodeKind}
        aria-hidden="true"
      />
      <button
        type="button"
        className="tool-batch-header"
        data-testid="tool-batch-header"
        aria-expanded={expanded}
        onClick={toggleExpanded}
      >
        <span className="tool-batch-icon-wrapper" aria-hidden="true">
          {getClusterIcon(props.clusterKind)}
        </span>

        <div className="tool-batch-title-group" data-testid="tool-batch-title">
          <b
            className={`tool-batch-title${summary.hasRunning ? ' behavior-explore-active' : ''}`}
          >
            {parts.lead}
          </b>
          {parts.rest ? <span className="tool-batch-title-rest">{parts.rest}</span> : null}
          {summary.hasRunning && activeLabel ? (
            <ActionMarquee
              className="tool-batch-marquee"
              activeText={activeLabel}
            />
          ) : null}
        </div>

        <div className="tool-batch-meta meta">
          {summary.hasRunning ? (
            <span className="tool-batch-status-running" aria-label="running">
              <ToolStatusDot status="running" />
            </span>
          ) : summary.hasError ? (
            <span
              className="tool-batch-status-error"
              aria-label="error"
              title={`${summary.errorCount} failed`}
            >
              <IconAlertCircle className="tool-batch-error-icon" />
              <span className="tool-batch-error-count">
                {isChinese ? `${summary.errorCount} 项失败` : `${summary.errorCount} failed`}
              </span>
            </span>
          ) : null}

          {props.meta ?? (!summary.hasRunning ? (
            <span className="tool-call-duration" data-testid="tool-batch-duration">
              {isExploreLike
                ? isChinese
                  ? `${summary.totalCount} 工具`
                  : `${summary.totalCount} tools`
                : ''}
              {typeof summary.totalDurationMs === 'number'
                ? `${isExploreLike ? ' · ' : ''}${formatDuration(summary.totalDurationMs)}`
                : ''}
            </span>
          ) : (
            <span className="tool-call-duration tool-call-duration-live">…</span>
          ))}

          <IconChevronDown
            className={`i s12 chev tool-batch-chevron${expanded ? ' open' : ''}`}
            aria-hidden="true"
          />
        </div>
      </button>

      {expanded ? (
        <div className="tool-batch-body" data-testid="tool-batch-body">
          <div className="tool-batch-timeline-track" aria-hidden="true" />
          <div className="tool-batch-items">
            {props.children ?? props.tools.map((tool) => (
              <ToolCallCard
                key={tool.toolCallId}
                tool={tool}
                // Honour the setting literally. Pinning nested rows to
                // `compact` meant 详细 never actually showed more than 平衡.
                density={props.density ?? 'compact'}
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
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
