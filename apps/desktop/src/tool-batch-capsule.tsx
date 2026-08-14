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

function getBatchTitle(
  kind: ToolClusterKind,
  count: number,
  isChinese: boolean,
): string {
  if (isChinese) {
    switch (kind) {
      case 'search':
        return `检索了 ${count} 处代码与定义`;
      case 'read':
        return `查看了 ${count} 个文件与目录`;
      case 'command':
        return `执行了 ${count} 条排查命令`;
      case 'web':
        return `进行了 ${count} 次网络检索与抓取`;
      default:
        return `执行了 ${count} 项操作`;
    }
  }
  switch (kind) {
    case 'search':
      return `Searched ${count} code locations`;
    case 'read':
      return `Read ${count} files`;
    case 'command':
      return `Executed ${count} diagnostic commands`;
    case 'web':
      return `Fetched ${count} web resources`;
    default:
      return `Executed ${count} actions`;
  }
}

export function ToolBatchCapsule(props: ToolBatchCapsuleProps): ReactElement {
  const isChinese = (props.locale ?? 'zh-CN') === 'zh-CN';
  const [expanded, setExpanded] = useState(false);
  const summary = props.summary;

  const defaultTitle = getBatchTitle(props.clusterKind, summary.totalCount, isChinese);
  const activeLabel = summary.activeTool?.presentation?.title || summary.activeTool?.toolName;

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

        <span className="tool-batch-title">
          {summary.hasRunning && activeLabel
            ? isChinese
              ? `正在执行: ${activeLabel}`
              : `Executing: ${activeLabel}`
            : defaultTitle}
        </span>

        {summary.keyTargets.length > 0 ? (
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
