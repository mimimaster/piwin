import { useState, type ReactElement } from 'react';
import type { ToolCardUi } from './chat-reducer';
import type { ToolCallDensity } from './ui-preferences';
import type { DiffCardRequest } from './diff-card';
import {
  ToolCallCard,
  ToolStatusDot,
  type DocumentOpenInput,
} from './tool-call-card';
import type { ToolClusterKind, BatchClusterSummary } from './tool-group-clustering';
import { ActionMarquee } from './action-marquee';
import {
  IconChevronDown,
  IconFile,
  IconSearch,
  IconTerminal,
  IconBrowser,
  IconMore,
  IconAlertCircle,
} from './shell-icons';

export type ToolBatchCapsuleProps = {
  clusterKind: ToolClusterKind;
  tools: ToolCardUi[];
  summary: BatchClusterSummary;
  density?: ToolCallDensity;
  locale?: 'zh-CN' | 'en';
  projectPath?: string | null;
  request?: DiffCardRequest;
  onOpenFile?: (absolutePath: string, relativePath?: string) => void;
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
      return <IconSearch className="tool-batch-kind-icon" />;
    case 'read':
      return <IconFile className="tool-batch-kind-icon" />;
    case 'command':
      return <IconTerminal className="tool-batch-kind-icon" />;
    case 'web':
      return <IconBrowser className="tool-batch-kind-icon" />;
    default:
      return <IconMore className="tool-batch-kind-icon" />;
  }
}

function formatActiveToolLabel(tool: ToolCardUi, isChinese: boolean): string {
  const verb = tool.presentation?.actionVerb || tool.toolName;
  const target =
    tool.presentation?.targetPaths?.[0]?.split(/[/\\]/).pop() ||
    tool.presentation?.summary ||
    tool.presentation?.title ||
    tool.toolName;

  if (isChinese) {
    if (verb === 'Read' || verb.includes('read') || verb.includes('view')) {
      return `正在读取: ${target}`;
    }
    if (verb === 'Searched' || verb.includes('grep') || verb.includes('search')) {
      return `正在检索: ${target}`;
    }
    if (verb.includes('command') || verb.includes('bash') || verb.includes('terminal')) {
      return `正在执行: ${target}`;
    }
    return `正在执行: ${target}`;
  }

  if (verb === 'Read' || verb.includes('read') || verb.includes('view')) {
    return `Reading ${target}`;
  }
  if (verb === 'Searched' || verb.includes('grep') || verb.includes('search')) {
    return `Searching ${target}`;
  }
  if (verb.includes('command') || verb.includes('bash') || verb.includes('terminal')) {
    return `Running ${target}`;
  }
  return `Executing ${target}`;
}

function getBatchTitle(
  kind: ToolClusterKind,
  summary: BatchClusterSummary,
  isChinese: boolean,
): string {
  const count = summary.totalCount;
  const fileCount = summary.fileCount ?? 0;
  const searchCount = summary.searchCount ?? 0;

  if (kind === 'explore' || kind === 'read' || kind === 'search') {
    if (isChinese) {
      if (fileCount > 0 && searchCount > 0) {
        return `已探索 ${fileCount} 个文件，${searchCount} 次检索`;
      }
      if (searchCount > 0 && fileCount === 0) {
        return `检索了 ${searchCount} 处代码与定义`;
      }
      if (fileCount > 0) {
        return `查看了 ${fileCount} 个文件与目录`;
      }
      return `已探索 ${count} 项上下文`;
    }

    if (fileCount > 0 && searchCount > 0) {
      return `Explored ${fileCount} files, ${searchCount} searches`;
    }
    if (searchCount > 0 && fileCount === 0) {
      return `Searched ${searchCount} code locations`;
    }
    if (fileCount > 0) {
      return `Read ${fileCount} files`;
    }
    return `Explored ${count} context items`;
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
  const fileCount = summary.fileCount ?? 0;
  const searchCount = summary.searchCount ?? 0;

  if (kind === 'explore' || kind === 'read' || kind === 'search') {
    if (isChinese) {
      if (fileCount > 0 || searchCount > 0) {
        return `正在探索 ${fileCount} 个文件，${searchCount} 次检索`;
      }
      return `正在检索与读取上下文…`;
    }
    if (fileCount > 0 || searchCount > 0) {
      return `Exploring ${fileCount} files, ${searchCount} searches`;
    }
    return `Exploring codebase…`;
  }

  if (isChinese) {
    return `正在执行 ${summary.totalCount} 项操作…`;
  }
  return `Executing ${summary.totalCount} actions…`;
}

export function ToolBatchCapsule(props: ToolBatchCapsuleProps): ReactElement {
  const isChinese = (props.locale ?? 'zh-CN') === 'zh-CN';
  const [expanded, setExpanded] = useState(false);
  const summary = props.summary;

  const defaultTitle = summary.hasRunning
    ? getRunningBatchTitle(props.clusterKind, summary, isChinese)
    : getBatchTitle(props.clusterKind, summary, isChinese);

  const activeLabel = summary.activeTool
    ? formatActiveToolLabel(summary.activeTool, isChinese)
    : undefined;

  return (
    <div
      className={`tool-batch-capsule${expanded ? ' is-expanded' : ' is-collapsed'}${
        summary.hasError ? ' has-error' : ''
      }${summary.hasRunning ? ' is-running' : ''}`}
      data-testid="tool-batch-capsule"
      data-cluster-kind={props.clusterKind}
      data-expanded={expanded ? 'true' : 'false'}
    >
      <button
        type="button"
        className="tool-batch-header"
        data-testid="tool-batch-header"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        <span className="tool-batch-icon-wrapper" aria-hidden="true">
          {getClusterIcon(props.clusterKind)}
        </span>

        <div className="tool-batch-title-group">
          <span className="tool-batch-title">{defaultTitle}</span>
          {summary.hasRunning && activeLabel ? (
            <ActionMarquee
              className="tool-batch-marquee"
              activeText={activeLabel}
            />
          ) : null}
        </div>

        {!summary.hasRunning && summary.keyTargets.length > 0 ? (
          <span className="tool-batch-pills" data-testid="tool-batch-pills">
            {summary.keyTargets.map((target, idx) => (
              <span key={`${target}-${idx}`} className="tool-batch-pill">
                {target}
              </span>
            ))}
          </span>
        ) : null}

        <div className="tool-batch-meta">
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
          ) : (
            <span className="tool-call-ok" aria-label="done" data-testid="tool-batch-ok" />
          )}

          {typeof summary.totalDurationMs === 'number' ? (
            <span className="tool-call-duration" data-testid="tool-batch-duration">
              {formatDuration(summary.totalDurationMs)}
            </span>
          ) : summary.hasRunning ? (
            <span className="tool-call-duration tool-call-duration-live">…</span>
          ) : null}

          <IconChevronDown
            className={expanded ? 'tool-batch-chevron open' : 'tool-batch-chevron'}
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
                density="compact"
                {...(props.projectPath !== undefined ? { projectPath: props.projectPath } : {})}
                {...(props.request !== undefined ? { request: props.request } : {})}
                {...(props.onOpenFile !== undefined ? { onOpenFile: props.onOpenFile } : {})}
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
