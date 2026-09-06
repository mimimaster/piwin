import type { ReactElement, ReactNode } from 'react';

export type WorkFoldHeaderState = 'done' | 'running' | 'waiting';

export type WorkFoldHeaderProps = {
  state: WorkFoldHeaderState;
  locale: 'zh-CN' | 'en';
  open?: boolean;
  onToggle?: () => void;
  elapsedMs?: number;
  toolCount?: number;
  fileCount?: number;
  failureCount?: number;
  runningToolIndex?: number;
  runningCode?: string;
  waitingAction?: string;
  waitingCode?: string;
  className?: string;
  testId?: string;
  ariaLabel?: string;
  /** Extra nodes before the label (Deck RadialBellow, kept for non-Inkstone). */
  leading?: ReactNode;
  children?: ReactNode;
};

export function formatWorkDuration(elapsedMs: number, locale: 'zh-CN' | 'en'): string {
  let remainingSeconds = Math.max(1, Math.round(elapsedMs / 1_000));
  const hours = Math.floor(remainingSeconds / 3_600);
  remainingSeconds -= hours * 3_600;
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds - minutes * 60;

  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);

  if (locale === 'zh-CN') {
    return `已工作 ${parts.join(' ')}`;
  }
  return `Worked for ${parts.join(' ')}`;
}

export function fileNameFromDetail(detail: string): string | undefined {
  const trimmed = detail.trim();
  if (!trimmed) return undefined;
  const slash = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return slash >= 0 ? (trimmed.slice(slash + 1) || trimmed) : trimmed;
}

export function resolveWorkFoldCode(tool: {
  presentation?:
    | {
        command?: string;
        targetPaths?: readonly string[];
        changedPaths?: readonly string[];
        summary?: string;
      }
    | undefined;
}): string | undefined {
  const presentation = tool.presentation;
  if (!presentation) return undefined;
  const command = presentation.command?.trim();
  if (command) return command;
  const path = presentation.changedPaths?.[0] ?? presentation.targetPaths?.[0];
  if (path?.trim()) return fileNameFromDetail(path);
  const summary = presentation.summary?.trim();
  if (summary && !summary.startsWith('{')) return summary;
  return undefined;
}

function IconBulb(): ReactElement {
  return (
    <svg
      className="i"
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 2.5A4.2 4.2 0 0 0 3.8 6.7c0 1.7 1 2.6 1.7 3.4.4.5.5.9.5 1.4h4c0-.5.1-.9.5-1.4.7-.8 1.7-1.7 1.7-3.4A4.2 4.2 0 0 0 8 2.5zM6.5 13.5h3" />
    </svg>
  );
}

function IconChevronDown(props: { isOpen: boolean }): ReactElement {
  return (
    <svg
      className={`i s12 chev${props.isOpen ? ' is-open' : ''}`}
      viewBox="0 0 16 16"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}

function WorkFoldIcon(props: { state: WorkFoldHeaderState }): ReactElement {
  if (props.state === 'running') {
    return <span className="lamp" aria-hidden="true" />;
  }
  if (props.state === 'waiting') {
    return <span className="sq" aria-hidden="true" />;
  }
  return <IconBulb />;
}

function DoneLabel(props: {
  locale: 'zh-CN' | 'en';
  elapsedMs?: number;
  toolCount?: number;
  fileCount?: number;
  failureCount?: number;
}): ReactElement {
  const durationText =
    props.elapsedMs === undefined
      ? props.locale === 'zh-CN'
        ? '已工作'
        : 'Work'
      : formatWorkDuration(props.elapsedMs, props.locale);
  const toolCount = props.toolCount ?? 0;
  const fileCount = props.fileCount ?? 0;
  const failureCount = props.failureCount ?? 0;
  return (
    <span className="turn-work-disclosure-label">
      <b>{durationText}</b>
      {toolCount > 0
        ? props.locale === 'zh-CN'
          ? ` · ${toolCount} 个工具`
          : ` · ${toolCount} tool${toolCount === 1 ? '' : 's'}`
        : null}
      {fileCount > 0
        ? props.locale === 'zh-CN'
          ? ` · ${fileCount} 个文件`
          : ` · ${fileCount} file${fileCount === 1 ? '' : 's'}`
        : null}
      {failureCount > 0 ? (
        <>
          {' · '}
          <span className="fail">
            {props.locale === 'zh-CN'
              ? `${failureCount} 次失败`
              : `${failureCount} failure${failureCount === 1 ? '' : 's'}`}
          </span>
        </>
      ) : null}
    </span>
  );
}

function RunningLabel(props: {
  locale: 'zh-CN' | 'en';
  runningToolIndex?: number;
  runningCode?: string;
}): ReactElement {
  return (
    <span className="turn-work-details-label">
      <b>{props.locale === 'zh-CN' ? '正在运行' : 'Running'}</b>
      {props.runningToolIndex !== undefined && props.runningToolIndex > 0
        ? props.locale === 'zh-CN'
          ? ` · 第 ${props.runningToolIndex} 个工具`
          : ` · tool ${props.runningToolIndex}`
        : null}
      {props.runningCode ? (
        <>
          {' · '}
          <code>{props.runningCode}</code>
        </>
      ) : null}
    </span>
  );
}

function WaitingLabel(props: {
  locale: 'zh-CN' | 'en';
  waitingAction?: string;
  waitingCode?: string;
}): ReactElement {
  const action =
    props.waitingAction?.trim() || (props.locale === 'zh-CN' ? '写入' : 'Write');
  return (
    <span className="turn-work-details-label">
      <b>{props.locale === 'zh-CN' ? '等待你批准' : 'Waiting for you'}</b>
      {` · ${action}`}
      {props.waitingCode ? (
        <>
          {' '}
          <code>{props.waitingCode}</code>
        </>
      ) : null}
    </span>
  );
}

/** Proto-01 `.work-h` — bulb / lamp / zhu square, then status · code · chevron. */
export function WorkFoldHeader(props: WorkFoldHeaderProps): ReactElement {
  const open = props.open === true;
  const className = [
    'work-h',
    props.className,
    open ? 'is-open' : undefined,
  ]
    .filter((value): value is string => Boolean(value))
    .join(' ');
  const label =
    props.children !== undefined ? (
      <span className="turn-work-details-label">{props.children}</span>
    ) : props.state === 'running' ? (
      <RunningLabel
        locale={props.locale}
        {...(props.runningToolIndex !== undefined
          ? { runningToolIndex: props.runningToolIndex }
          : {})}
        {...(props.runningCode !== undefined ? { runningCode: props.runningCode } : {})}
      />
    ) : props.state === 'waiting' ? (
      <WaitingLabel
        locale={props.locale}
        {...(props.waitingAction !== undefined ? { waitingAction: props.waitingAction } : {})}
        {...(props.waitingCode !== undefined ? { waitingCode: props.waitingCode } : {})}
      />
    ) : (
      <DoneLabel
        locale={props.locale}
        {...(props.elapsedMs !== undefined ? { elapsedMs: props.elapsedMs } : {})}
        {...(props.toolCount !== undefined ? { toolCount: props.toolCount } : {})}
        {...(props.fileCount !== undefined ? { fileCount: props.fileCount } : {})}
        {...(props.failureCount !== undefined ? { failureCount: props.failureCount } : {})}
      />
    );

  const inner = (
    <>
      <WorkFoldIcon state={props.state} />
      {props.leading}
      {label}
      <IconChevronDown isOpen={open} />
    </>
  );

  if (props.onToggle) {
    return (
      <button
        type="button"
        className={className}
        data-fold=""
        data-fold-state={props.state}
        aria-expanded={open}
        {...(props.ariaLabel !== undefined ? { 'aria-label': props.ariaLabel } : {})}
        {...(props.testId !== undefined ? { 'data-testid': props.testId } : {})}
        onClick={props.onToggle}
      >
        {inner}
      </button>
    );
  }

  return (
    <div
      className={className}
      data-fold=""
      data-fold-state={props.state}
      style={{ cursor: 'default' }}
      {...(props.testId !== undefined ? { 'data-testid': props.testId } : {})}
    >
      {inner}
    </div>
  );
}
