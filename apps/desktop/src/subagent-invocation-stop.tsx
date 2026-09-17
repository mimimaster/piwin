/**
 * Stop control for a running transcript subagent card. Rendered beside the
 * card (the card itself is a button) and hidden outside the workbench stop
 * provider, so nested and test transcripts stay read-only.
 */
import type { ReactElement } from 'react';
import type { SubagentInvocationStatus } from '@piwin/contracts';
import { IconStop } from './shell-icons';
import { useSubagentStop } from './subagent-stop-controller';

/** Statuses whose batch can still be stopped. */
export function isStoppableSubagentStatus(status: SubagentInvocationStatus | undefined): boolean {
  return status === 'queued' || status === 'starting' || status === 'running';
}

export function SubagentInvocationStop(props: {
  runId: string | undefined;
  status: SubagentInvocationStatus | undefined;
  locale: 'zh-CN' | 'en';
}): ReactElement | null {
  const controller = useSubagentStop();
  const { runId } = props;
  if (controller === null || runId === undefined || !isStoppableSubagentStatus(props.status)) {
    return null;
  }
  const zh = props.locale === 'zh-CN';
  const stopping = controller.isStopping(runId);
  const wholeBatch = controller.activeTaskCount(runId) > 1;
  const label = stopping
    ? zh
      ? '停止中…'
      : 'Stopping…'
    : wholeBatch
      ? zh
        ? '停止整个批次'
        : 'Stop whole batch'
      : zh
        ? '停止子任务'
        : 'Stop subagent';
  return (
    <button
      type="button"
      className="subagent-invocation-stop"
      data-testid="subagent-invocation-stop"
      data-stopping={stopping}
      aria-label={label}
      aria-busy={stopping}
      title={label}
      disabled={stopping}
      onClick={() => {
        void controller.stop(runId);
      }}
    >
      <IconStop width={12} height={12} />
    </button>
  );
}
