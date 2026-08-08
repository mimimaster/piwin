import { type ReactElement } from 'react';
import { AgentLocator, SkillActivityChip } from './agent-locator.js';
import { sessionRunPhaseToActivityKind } from './run-activity-mappers.js';
import type { RunRecordUi, SkillActivityView } from './chat-reducer.js';
import type { RunActivityInput } from './run-activity-types.js';
import type { AgentLocatorAnimation } from './ui-preferences.js';

export type RunActivitySlotProps = {
  activeRunId: string | null;
  runRecordsById: Record<string, RunRecordUi>;
  activeToolName?: string;
  planStep?: string;
  locale?: 'zh-CN' | 'en';
  animation?: AgentLocatorAnimation;
  skill?: SkillActivityView | null;
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
    ...(props.activeToolName ? { activeToolName: props.activeToolName } : {}),
    ...(props.planStep ? { planStep: props.planStep } : {}),
    ...(elapsedMs !== undefined ? { elapsedMs } : {}),
  };

  return (
    <div
      className="chat-run-activity-line"
      data-testid="run-activity-slot"
      {...(props.activeRunId ? { 'data-run-id': props.activeRunId } : {})}
    >
      <div className="agent-locator-stack">
        {props.skill ? <SkillActivityChip skill={props.skill} loading locale={input.locale} /> : null}
        <AgentLocator input={input} {...(props.animation ? { animation: props.animation } : {})} />
      </div>
    </div>
  );
}
