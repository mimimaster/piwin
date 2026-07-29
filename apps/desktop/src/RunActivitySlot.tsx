import { type ReactElement } from 'react';
import { RunActivitySplash } from './RunActivitySplash.js';
import { sessionRunPhaseToActivityKind } from './run-activity-mappers.js';
import { IconAgent } from './shell-icons.js';
import type { RunRecordUi } from './chat-reducer.js';
import type { RunActivityInput } from './run-activity-types.js';

export type RunActivitySlotProps = {
  activeRunId: string | null;
  runRecordsById: Record<string, RunRecordUi>;
  locale?: 'zh-CN' | 'en';
};

export function RunActivitySlot(props: RunActivitySlotProps): ReactElement | null {
  const runRecord = props.activeRunId ? props.runRecordsById[props.activeRunId] : undefined;
  const latestPhase = runRecord?.phaseHistory[runRecord.phaseHistory.length - 1]?.phase;
  const kind = latestPhase ? sessionRunPhaseToActivityKind(latestPhase) : 'connecting-model';
  // Round to nearest second so `input.elapsedMs` is stable across sub-second re-renders
  // (text deltas) and the 15s taking-too-long timer is not constantly reset.
  const elapsedMs =
    typeof runRecord?.startedAt === 'number'
      ? Math.floor((Math.max(0, Date.now() - runRecord.startedAt)) / 1000) * 1000
      : undefined;

  const input: RunActivityInput = {
    kind,
    locale: props.locale ?? 'zh-CN',
    ...(elapsedMs !== undefined ? { elapsedMs } : {}),
  };

  return (
    <article
      className="bubble role-assistant is-streaming"
      data-testid="run-activity-slot"
      {...(props.activeRunId ? { 'data-run-id': props.activeRunId } : {})}
    >
      <header className="bubble-header">
        <span className="bubble-agent-icon" aria-hidden>
          <IconAgent />
        </span>
        <strong className="bubble-role">piwin</strong>
        <span className="stream-dot" aria-label="Streaming" />
      </header>
      <RunActivitySplash input={input} />
    </article>
  );
}
