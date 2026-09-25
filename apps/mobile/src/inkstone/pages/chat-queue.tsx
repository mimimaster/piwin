import { useState, type ReactElement } from 'react';
import { useInkstone } from '../inkstone-context.js';
import { Pill } from '../inkstone-ui.js';
import type { SessionQueueState } from '../host/use-session-queue.js';

/**
 * Follow-ups waiting on the live run. 插话 converts a queued turn into an
 * intervention for the running run; × withdraws it. Both are Host commands.
 */
export function ChatQueueStrip({
  queue,
  activeRunId,
}: {
  queue: SessionQueueState;
  activeRunId: string | undefined;
}): ReactElement | null {
  const { dispatch } = useInkstone();
  const [busyId, setBusyId] = useState<string | undefined>();
  if (queue.queued.length === 0 && queue.interventions.length === 0) {
    return null;
  }

  const run = (id: string, action: () => Promise<string | undefined>, done: string): void => {
    setBusyId(id);
    action()
      .then((error) => dispatch({ type: 'toast', message: error ?? done }))
      .catch((error: unknown) =>
        dispatch({ type: 'toast', message: error instanceof Error ? error.message : '操作失败' }),
      )
      .finally(() => setBusyId(undefined));
  };

  return (
    <div className="queue-stack" aria-live="polite">
      {queue.interventions.map((intervention) => (
        <div className="queue-strip" key={intervention.interventionId}>
          <Pill variant="zhu">插话</Pill>
          <span className="queue-text">{intervention.input.text}</span>
          <small>{intervention.status === 'applying' ? '正在送达' : '等下一步'}</small>
        </div>
      ))}
      {queue.queued.map((record, index) => (
        <div className="queue-strip" key={record.queuedTurnId}>
          <Pill>排队 {index + 1}</Pill>
          <span className="queue-text">{record.input.text}</span>
          {activeRunId !== undefined && record.status === 'pending' ? (
            <button
              type="button"
              disabled={busyId === record.queuedTurnId}
              onClick={() =>
                run(record.queuedTurnId, () => queue.interveneNow(record, activeRunId), '已插话 · 下一步生效')
              }
            >
              插话
            </button>
          ) : null}
          {record.status === 'pending' ? (
            <button
              type="button"
              aria-label="撤回排队消息"
              disabled={busyId === record.queuedTurnId}
              onClick={() => run(record.queuedTurnId, () => queue.cancelQueued(record), '已撤回')}
            >
              ×
            </button>
          ) : (
            <small>即将开始</small>
          )}
        </div>
      ))}
    </div>
  );
}
