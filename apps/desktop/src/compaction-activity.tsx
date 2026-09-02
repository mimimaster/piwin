import { useEffect, useState, type ReactElement } from 'react';
import { Button } from '@piwin/ui-kit';
import { IconAlertCircle, IconCheckCircle, IconClose } from './shell-icons.js';
import { AgentLocator } from './agent-locator.js';
import type { CompactionActivityUi } from './chat-reducer.js';

export type CompactionActivityProps = {
  activity: CompactionActivityUi;
  locale: 'zh-CN' | 'en';
  onAbort?: () => void | Promise<void>;
  onDismiss?: () => void;
};

/**
 * One stable transcript node for the whole compaction lifecycle. Keeping the
 * operation id on the wrapper lets tests and assistive technology observe a
 * start → terminal transition without a detached banner replacing the node.
 */
export function CompactionActivity(props: CompactionActivityProps): ReactElement {
  const { activity, locale } = props;
  const isZh = locale === 'zh-CN';
  const [now, setNow] = useState(() => Date.now());
  const running = activity.phase === 'running';

  useEffect(() => {
    if (!running) {
      return;
    }
    const intervalId = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, [running]);

  const elapsedMs = running
    ? Math.max(0, now - activity.startedAt)
    : (activity.durationMs ??
      (activity.endedAt !== undefined
        ? Math.max(0, activity.endedAt - activity.startedAt)
        : undefined));

  if (running) {
    return (
      <div
        className="chat-compaction-activity"
        data-testid="compaction-activity"
        data-operation-id={activity.operationId}
        data-phase={activity.phase}
        data-reason={activity.reason}
      >
        <div className="chat-compaction-activity-main">
          <AgentLocator
            input={{
              kind: 'compacting',
              locale,
              ...(elapsedMs !== undefined ? { elapsedMs } : {}),
            }}
            animation="radial-bellow"
          />
        </div>
        <span className="chat-compaction-activity-copy">
          {isZh ? '正在整理上下文' : 'Compacting context'}
        </span>
        {props.onAbort ? (
          <Button
            size="compact"
            variant="ghost"
            className="chat-compaction-activity-action"
            onClick={() => void props.onAbort?.()}
          >
            {isZh ? '取消' : 'Cancel'}
          </Button>
        ) : null}
      </div>
    );
  }

  const terminalCopy = resolveTerminalCopy(activity, isZh);
  const Icon =
    activity.phase === 'succeeded'
      ? IconCheckCircle
      : activity.phase === 'cancelled'
        ? IconClose
        : IconAlertCircle;
  const durationLabel =
    elapsedMs !== undefined
      ? isZh
        ? `耗时 ${Math.round(elapsedMs)}ms`
        : `${Math.round(elapsedMs)}ms`
      : null;
  const tokenLabel =
    activity.tokensBefore !== undefined || activity.tokensAfter !== undefined
      ? `Tokens${
          activity.tokensBefore !== undefined ? ` ${activity.tokensBefore}` : ''
        }${activity.tokensAfter !== undefined ? ` → ${activity.tokensAfter}` : ''}`
      : null;

  return (
    <div
      className={`chat-compaction-activity is-${activity.phase}`}
      data-testid="compaction-activity"
      data-operation-id={activity.operationId}
      data-phase={activity.phase}
      data-reason={activity.reason}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <span className="chat-compaction-activity-icon" aria-hidden="true">
        <Icon width={16} height={16} />
      </span>
      <div className="chat-compaction-activity-body">
        <div className="chat-compaction-activity-line">
          <span className="chat-compaction-activity-copy">{terminalCopy}</span>
          {durationLabel || tokenLabel ? (
            <span className="chat-compaction-activity-meta">
              {[durationLabel, tokenLabel]
                .filter((value): value is string => value !== null)
                .join(' · ')}
            </span>
          ) : null}
        </div>
        {activity.summary ? (
          <details className="chat-compaction-activity-details">
            <summary>{isZh ? '查看整理摘要' : 'View compaction summary'}</summary>
            <pre>{activity.summary.slice(0, 8_000)}</pre>
          </details>
        ) : null}
      </div>
      {props.onDismiss ? (
        <Button
          size="compact"
          variant="ghost"
          className="chat-compaction-activity-action"
          onClick={props.onDismiss}
        >
          {isZh ? '收起' : 'Dismiss'}
        </Button>
      ) : null}
    </div>
  );
}

function resolveTerminalCopy(activity: CompactionActivityUi, isZh: boolean): string {
  if (activity.message?.trim()) {
    return activity.message;
  }
  switch (activity.phase) {
    case 'succeeded':
      return isZh ? '上下文已整理' : 'Context compacted';
    case 'cancelled':
      return isZh ? '已取消上下文整理' : 'Compaction cancelled';
    case 'failed':
      return isZh ? '上下文整理失败' : 'Compaction failed';
    case 'running':
      return isZh ? '正在整理上下文' : 'Compacting context';
  }
}
