import type { QueuedTurnRecord, RunInterventionRecord } from '@piwin/contracts';
import type { ChatMessageUi } from './chat-ui-types';

type InstructionRecord = QueuedTurnRecord | RunInterventionRecord;

/** Rebuild the user row when a lifecycle push arrives before transcript hydration. */
export function projectInstructionUserMessage(record: InstructionRecord): ChatMessageUi {
  const queuedTurn = 'queuedTurnId' in record;
  const targetRunId = queuedTurn ? (record.startedRunId ?? record.replaceRunId) : record.runId;
  const instructionDelivery: NonNullable<ChatMessageUi['instructionDelivery']> = queuedTurn
    ? {
        kind: 'queued-turn',
        instructionId: record.queuedTurnId,
        status: record.status,
        revision: record.revision,
        ...(targetRunId ? { targetRunId } : {}),
      }
    : {
        kind: 'run-intervention',
        instructionId: record.interventionId,
        status: record.status,
        targetRunId: record.runId,
        revision: record.revision,
      };
  return {
    id: record.userMessageId,
    role: 'user',
    text: record.input.text,
    thinking: '',
    tools: [],
    attachments: record.input.attachments ?? [],
    ...(record.input.contextRefs && record.input.contextRefs.length > 0
      ? { contextRefs: record.input.contextRefs }
      : {}),
    status: 'done',
    createdAt: record.submittedAt,
    ...(targetRunId ? { runId: targetRunId } : {}),
    instructionDelivery,
  };
}
