import { useState, type ReactElement } from 'react';
import {
  IconTerminal,
  IconFile,
  IconSearch,
  IconSpark,
  IconCheck,
  IconClose,
  IconChevronDown,
  IconCopy,
} from '@piwin/ui-kit';
import { MobileDiffViewer } from './MobileDiffViewer.js';
import type { MobileToolCall } from '../../hooks/use-mobile-host.js';
import {
  formatMobileFlashcardResult,
  resolveMobileFlashcardDisplay,
} from '../../mobile-flashcard-result.js';

export type MobileToolCallCardProps = {
  tool: MobileToolCall;
  defaultExpanded?: boolean;
};

export function resolveToolIcon(name: string): (props: { size?: number | string }) => ReactElement {
  const lower = name.toLowerCase();
  if (
    lower.includes('bash') ||
    lower.includes('command') ||
    lower.includes('exec') ||
    lower.includes('terminal')
  ) {
    return IconTerminal;
  }
  if (
    lower.includes('read') ||
    lower.includes('write') ||
    lower.includes('edit') ||
    lower.includes('file')
  ) {
    return IconFile;
  }
  if (lower.includes('search') || lower.includes('grep') || lower.includes('find')) {
    return IconSearch;
  }
  if (lower.includes('mcp') || lower.includes('plugin') || lower.includes('tool')) {
    return IconSpark;
  }
  return IconSpark;
}

export function resolveToolVerb(name: string, actionVerb?: string): string {
  if (actionVerb) return actionVerb;
  const lower = name.toLowerCase();
  if (lower.includes('bash') || lower.includes('command') || lower.includes('exec'))
    return '执行命令';
  if (lower.includes('read')) return '读取文件';
  if (lower.includes('write') || lower.includes('edit') || lower.includes('replace'))
    return '编辑文件';
  if (lower.includes('search') || lower.includes('grep')) return '搜索代码';
  if (lower.includes('web')) return 'Web 搜索';
  if (lower.includes('subagent')) return '子代理任务';
  return '调用工具';
}

export function formatDuration(durationMs?: number): string | null {
  if (durationMs === undefined || durationMs < 0) return null;
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}

export function MobileToolCallCard({
  tool,
  defaultExpanded = false,
}: MobileToolCallCardProps): ReactElement {
  const [expanded, setExpanded] = useState(defaultExpanded || tool.status === 'running');
  const [copied, setCopied] = useState(false);

  const ToolIcon = resolveToolIcon(tool.name);
  const verb = resolveToolVerb(tool.name, tool.actionVerb);
  const durationText = formatDuration(tool.durationMs);

  const primaryTarget = tool.targetPaths?.[0] ?? tool.command ?? tool.summary ?? tool.name;
  const flashcardDisplay = resolveMobileFlashcardDisplay(tool);
  const flashcardText = flashcardDisplay ? formatMobileFlashcardResult(flashcardDisplay) : null;

  const handleCopyOutput = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const content = tool.output ?? tool.error ?? '';
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <div
      className={`mobile-tool-call-card ${tool.status} ${expanded ? 'is-expanded' : 'is-collapsed'}`}
      data-testid="mobile-tool-call-card"
    >
      {/* 1. Header Accordion Bar */}
      <button
        type="button"
        className="mobile-tool-summary-btn"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        aria-label={`${verb}: ${primaryTarget}`}
      >
        <span className="mobile-tool-kind-icon">
          <ToolIcon size={14} />
        </span>

        <span className="mobile-tool-verb">{verb}</span>

        {primaryTarget ? (
          <code className="mobile-tool-pill" title={primaryTarget}>
            {primaryTarget}
          </code>
        ) : null}

        <div className="mobile-tool-status-meta">
          {tool.status === 'running' ? (
            <span className="mobile-tool-status-badge running">
              <span className="mobile-tool-pulse-dot" />
              <span>运行中</span>
            </span>
          ) : tool.status === 'done' ? (
            <span className="mobile-tool-status-badge done">
              <IconCheck size={12} className="mobile-tool-ok-icon" />
              {durationText ? <span className="mobile-tool-duration">{durationText}</span> : null}
            </span>
          ) : (
            <span className="mobile-tool-status-badge error">
              <IconClose size={12} className="mobile-tool-err-icon" />
              <span>失败</span>
            </span>
          )}

          <span className={`mobile-tool-chevron ${expanded ? 'open' : ''}`}>
            <IconChevronDown size={14} />
          </span>
        </div>
      </button>

      {/* 2. Expanded Terminal Body */}
      {expanded ? (
        <div className="mobile-tool-body">
          {tool.command && tool.command !== primaryTarget ? (
            <div className="mobile-tool-command-preview">
              <span className="mobile-tool-subhead">指令：</span>
              <code>{tool.command}</code>
            </div>
          ) : null}

          {tool.targetPaths && tool.targetPaths.length > 1 ? (
            <div className="mobile-tool-paths-preview">
              <span className="mobile-tool-subhead">目标路径：</span>
              <div className="mobile-tool-paths-list">
                {tool.targetPaths.map((p) => (
                  <code key={p}>{p}</code>
                ))}
              </div>
            </div>
          ) : null}

          {flashcardText ? (
            <pre className="mobile-tool-output-pre" data-testid="mobile-flashcard-result">
              {flashcardText}
            </pre>
          ) : null}

          {/* Terminal Output */}
          {!flashcardText && (tool.output || tool.error) ? (
            <div className="mobile-tool-terminal-wrapper">
              <div className="mobile-tool-terminal-header">
                <span className="mobile-tool-terminal-label">
                  {tool.error ? '错误详情' : '执行输出'}
                </span>
                <button
                  type="button"
                  className="mobile-tool-copy-btn"
                  onClick={handleCopyOutput}
                  aria-label="复制输出"
                >
                  {copied ? <span className="copied-tag">已复制 ✓</span> : <IconCopy size={12} />}
                </button>
              </div>
              {tool.output &&
              (tool.output.includes('@@') ||
                (tool.output.includes('\n+') && tool.output.includes('\n-'))) ? (
                <MobileDiffViewer diffText={tool.output} />
              ) : (
                <pre className={`mobile-tool-output-pre ${tool.error ? 'has-error' : ''}`}>
                  {tool.error ?? tool.output}
                </pre>
              )}
            </div>
          ) : tool.status === 'running' ? (
            <div className="mobile-tool-running-placeholder">
              <span className="mobile-tool-pulse-dot" />
              <span>正在执行中，等待输出…</span>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
