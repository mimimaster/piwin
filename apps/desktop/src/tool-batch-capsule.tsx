import { useState, type ReactElement } from 'react';
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
  resolveToolClusterKind,
  type ToolClusterKind,
  type BatchClusterSummary,
} from './tool-group-clustering';
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

function isArgsDumpText(text: string | undefined): boolean {
  const trimmed = text?.trim() ?? '';
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}

export function formatActiveToolLabel(tool: ToolCardUi, isChinese: boolean): string {
  const presentation = tool.presentation;
  // Streaming summaries can still be a half-parsed args dump (`{"pattern":…`).
  const summary = isArgsDumpText(presentation?.summary) ? undefined : presentation?.summary?.trim();
  const target =
    presentation?.targetPaths?.[0] ||
    summary ||
    presentation?.command?.trim() ||
    presentation?.title ||
    tool.toolName;
  const clusterKind = resolveToolClusterKind(tool);

  if (clusterKind === 'read') {
    return isChinese ? `正在读取: ${target}` : `Reading ${target}`;
  }
  if (clusterKind === 'search') {
    return isChinese ? `正在检索: ${target}` : `Searching ${target}`;
  }
  if (clusterKind === 'web') {
    return isChinese ? `正在抓取: ${target}` : `Fetching ${target}`;
  }
  if (clusterKind === 'command') {
    return isChinese ? `正在执行: ${target}` : `Running ${target}`;
  }
  return isChinese ? `正在执行: ${target}` : `Executing ${target}`;
}

/**
 * One collapsed-title wording shared by both capsule variants (within-message
 * batch + cross-message explore flow) so the transcript never shows two
 * different phrasings for the same idea.
 */
export function formatExploreCapsuleTitle(input: {
  fileCount: number;
  searchCount: number;
  totalCount: number;
  live: boolean;
  isChinese: boolean;
}): string {
  if (input.live) {
    return input.isChinese ? '正在探索代码库' : 'Exploring codebase';
  }
  const files = input.fileCount;
  const searches = input.searchCount;
  if (input.isChinese) {
    if (files > 0 && searches > 0) return `探索了 ${files} 个文件 · ${searches} 次搜索`;
    if (files > 0) return `探索了 ${files} 个文件`;
    if (searches > 0) return `搜索了 ${searches} 处代码`;
    return `探索了 ${input.totalCount} 项`;
  }
  if (files > 0 && searches > 0) {
    return `Explored ${files} file${files === 1 ? '' : 's'} · ${searches} search${
      searches === 1 ? '' : 'es'
    }`;
  }
  if (files > 0) return `Explored ${files} file${files === 1 ? '' : 's'}`;
  if (searches > 0) return `Searched ${searches} location${searches === 1 ? '' : 's'}`;
  return `Explored ${input.totalCount} items`;
}

/** Proto: `<b>探索了 N 个文件</b><span>· M 次搜索</span>` — bold lead, quiet rest. */
export function exploreFlowTitleParts(
  group: {
    fileCount: number;
    searchCount: number;
    totalCount?: number;
    toolCount?: number;
    isLive?: boolean;
    cancelledCount?: number;
    errorCount?: number;
  },
  isChinese: boolean,
): { lead: string; rest: string | null } {
  const isLive = Boolean(group.isLive);
  const totalCount = group.totalCount ?? group.toolCount ?? 0;
  if (!isLive && (group.cancelledCount ?? 0) > 0 && (group.errorCount ?? 0) === 0) {
    return { lead: isChinese ? '已停止' : 'Stopped', rest: null };
  }
  if (isLive) {
    return {
      lead: formatExploreCapsuleTitle({
        fileCount: group.fileCount,
        searchCount: group.searchCount,
        totalCount,
        live: true,
        isChinese,
      }),
      rest: null,
    };
  }
  const files = group.fileCount;
  const searches = group.searchCount;
  if (isChinese) {
    if (files > 0 && searches > 0) {
      return { lead: `探索了 ${files} 个文件`, rest: ` · ${searches} 次搜索` };
    }
    return {
      lead: formatExploreCapsuleTitle({
        fileCount: files,
        searchCount: searches,
        totalCount,
        live: false,
        isChinese,
      }),
      rest: null,
    };
  }
  if (files > 0 && searches > 0) {
    return {
      lead: `Explored ${files} file${files === 1 ? '' : 's'}`,
      rest: ` · ${searches} search${searches === 1 ? '' : 'es'}`,
    };
  }
  return {
    lead: formatExploreCapsuleTitle({
      fileCount: files,
      searchCount: searches,
      totalCount,
      live: false,
      isChinese,
    }),
    rest: null,
  };
}

function getBatchTitle(
  kind: ToolClusterKind,
  summary: BatchClusterSummary,
  isChinese: boolean,
): string {
  const count = summary.totalCount;

  if (kind === 'explore' || kind === 'read' || kind === 'search') {
    return formatExploreCapsuleTitle({
      fileCount: summary.fileCount ?? 0,
      searchCount: summary.searchCount ?? 0,
      totalCount: count,
      live: false,
      isChinese,
    });
  }

  if (isChinese) {
    switch (kind) {
      case 'command':
        return `执行了 ${count} 条排查命令`;
      case 'web':
        return `进行了 ${count} 次网络检索与抓取`;
      default:
        return `执行了 ${count} 项操作`;
    }
  }

  switch (kind) {
    case 'command':
      return `Executed ${count} diagnostic commands`;
    case 'web':
      return `Fetched ${count} web resources`;
    default:
      return `Executed ${count} actions`;
  }
}

function getRunningBatchTitle(
  kind: ToolClusterKind,
  summary: BatchClusterSummary,
  isChinese: boolean,
): string {
  if (kind === 'explore' || kind === 'read' || kind === 'search') {
    return formatExploreCapsuleTitle({
      fileCount: summary.fileCount ?? 0,
      searchCount: summary.searchCount ?? 0,
      totalCount: summary.totalCount,
      live: true,
      isChinese,
    });
  }

  if (isChinese) {
    return `正在执行 ${summary.totalCount} 项操作…`;
  }
  return `Executing ${summary.totalCount} actions…`;
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
        (summary.hasRunning ? disclosure === 'live-open' : disclosure === 'settled-open');
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

  const parts = isExploreLike
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

  const activeLabel = summary.activeTool
    ? formatActiveToolLabel(summary.activeTool, isChinese)
    : undefined;

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

          {!summary.hasRunning ? (
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
          )}

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
            {props.tools.map((tool) => (
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
