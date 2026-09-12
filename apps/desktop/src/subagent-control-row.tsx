import { useId, useState, type KeyboardEvent, type ReactElement } from 'react';
import { Button, StatusBadge, type StatusTone } from '@piwin/ui-kit';
import type {
  SubagentControlDisplay,
  SubagentControlRunDisplay,
  SubagentInvocation,
} from '@piwin/contracts';
import { formatToolDuration } from './tool-call-head';
import { subagentInvocationDomId } from './subagent-orchestration-view';

export type SubagentControlRowProps = {
  control: SubagentControlDisplay;
  locale: 'zh-CN' | 'en';
  durationMs?: number;
  toolCallId?: string;
  invocations?: Record<string, SubagentInvocation>;
};

type WaitCancelControl = Exclude<SubagentControlDisplay, { phase: 'accepted' }>;

function isWaitCancelControl(control: SubagentControlDisplay): control is WaitCancelControl {
  return control.phase !== 'accepted';
}

function phaseVerb(phase: WaitCancelControl['phase'], locale: 'zh-CN' | 'en'): string {
  const zh = locale === 'zh-CN';
  switch (phase) {
    case 'waiting':
    case 'waited':
      return zh ? '等待' : 'Wait';
    case 'cancelling':
    case 'cancelled':
      return zh ? '取消' : 'Cancel';
  }
}

function phaseBadge(
  phase: WaitCancelControl['phase'],
  locale: 'zh-CN' | 'en',
): { tone: StatusTone; label: string } {
  const zh = locale === 'zh-CN';
  switch (phase) {
    case 'waiting':
      return { tone: 'running', label: zh ? '等待中' : 'Waiting' };
    case 'waited':
      return { tone: 'success', label: zh ? '已等待' : 'Waited' };
    case 'cancelling':
      return { tone: 'warning', label: zh ? '取消中' : 'Cancelling' };
    case 'cancelled':
      return { tone: 'neutral', label: zh ? '已取消' : 'Cancelled' };
  }
}

function aggregateCopy(control: WaitCancelControl, locale: 'zh-CN' | 'en'): string {
  const zh = locale === 'zh-CN';
  switch (control.phase) {
    case 'waiting':
      return zh
        ? `正在等待 ${control.total} 个子任务`
        : `Waiting for ${control.total} subtasks`;
    case 'waited':
      return zh
        ? `已收集 ${control.completed} · 失败 ${control.failed} · 已取消 ${control.cancelled} · 待处理 ${control.needsIntegration}`
        : `Collected ${control.completed}, failed ${control.failed}, cancelled ${control.cancelled}, integration attention ${control.needsIntegration}`;
    case 'cancelling':
      return zh
        ? `正在取消 ${control.total} 个子任务`
        : `Cancelling ${control.total} subtasks`;
    case 'cancelled':
      return zh
        ? `已取消 ${control.cancelled} · 已结束 ${control.alreadyTerminal}`
        : `${control.cancelled} cancelled, ${control.alreadyTerminal} already finished`;
  }
}

function runTitle(
  run: SubagentControlRunDisplay,
  invocations: Record<string, SubagentInvocation> | undefined,
  locale: 'zh-CN' | 'en',
): string {
  const stored = run.invocationId !== undefined ? invocations?.[run.invocationId] : undefined;
  const titled =
    run.title?.trim() ||
    stored?.title?.trim() ||
    stored?.task?.trim() ||
    run.activity?.trim();
  if (titled) return titled;
  return locale === 'zh-CN' ? '子任务' : 'Subtask';
}

function runStatusLabel(run: SubagentControlRunDisplay, locale: 'zh-CN' | 'en'): string {
  const zh = locale === 'zh-CN';
  switch (run.executionStatus) {
    case 'queued':
      return zh ? '排队中' : 'Queued';
    case 'running':
      return zh ? '运行中' : 'Running';
    case 'completed':
      return zh ? '已完成' : 'Completed';
    case 'failed':
      return zh ? '失败' : 'Failed';
    case 'cancelled':
      return zh ? '已取消' : 'Cancelled';
  }
}

function runStatusTone(run: SubagentControlRunDisplay): StatusTone {
  switch (run.executionStatus) {
    case 'running':
    case 'queued':
      return 'running';
    case 'completed':
      return 'success';
    case 'failed':
      return 'danger';
    case 'cancelled':
      return 'neutral';
  }
}

export function SubagentControlRow(props: SubagentControlRowProps): ReactElement | null {
  const [expanded, setExpanded] = useState(false);
  const rosterDomId = useId();
  if (!isWaitCancelControl(props.control)) {
    return null;
  }
  const control = props.control;
  const badge = phaseBadge(control.phase, props.locale);
  const copy = aggregateCopy(control, props.locale);
  const duration =
    typeof props.durationMs === 'number' && props.durationMs > 0
      ? formatToolDuration(props.durationMs)
      : undefined;
  const isLive = control.phase === 'waiting' || control.phase === 'cancelling';

  const toggleExpanded = (): void => {
    setExpanded((current) => !current);
  };

  const onToggleKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggleExpanded();
    }
  };

  return (
    <div
      className="subagent-control-row"
      data-testid="subagent-control-row"
      data-phase={control.phase}
      {...(props.toolCallId !== undefined ? { 'data-tool-call-id': props.toolCallId } : {})}
    >
      <Button
        type="button"
        variant="ghost"
        size="compact"
        className="subagent-control-toggle"
        data-testid="subagent-control-expand"
        aria-expanded={expanded}
        aria-controls={rosterDomId}
        onClick={toggleExpanded}
        onKeyDown={onToggleKeyDown}
      >
        <span className="subagent-control-verb">{phaseVerb(control.phase, props.locale)}</span>
        <span className="subagent-control-copy" role="status" aria-live="polite">
          {isLive ? <span className="subagent-grind-spinner" aria-hidden="true" /> : null}
          <span>{copy}</span>
        </span>
        <StatusBadge tone={badge.tone} label={badge.label} testId="subagent-control-status" />
        {duration ? (
          <span className="subagent-control-duration" data-testid="subagent-control-duration">
            {duration}
          </span>
        ) : null}
      </Button>
      {expanded ? (
        <ul
          id={rosterDomId}
          className="subagent-control-roster"
          data-testid="subagent-control-roster"
        >
          {control.runs.map((run) => {
            const title = runTitle(run, props.invocations, props.locale);
            const href =
              run.invocationId !== undefined
                ? `#${subagentInvocationDomId(run.invocationId)}`
                : undefined;
            return (
              <li
                key={`${run.runId}:${run.invocationId ?? run.childSessionId ?? title}`}
                className="subagent-control-run"
                data-testid="subagent-control-run"
                data-execution-status={run.executionStatus}
              >
                {href ? (
                  <a className="subagent-control-anchor" href={href}>
                    {title}
                  </a>
                ) : (
                  <span className="subagent-control-run-title">{title}</span>
                )}
                <StatusBadge
                  tone={runStatusTone(run)}
                  label={runStatusLabel(run, props.locale)}
                  testId="subagent-control-run-status"
                />
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
