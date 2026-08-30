import { assistantHasWorkTools } from './assistant-text-role.js';
import type { ChatMessageUi, RunRecordUi } from './chat-reducer.js';
import type { TranscriptTurn } from './transcript-turns.js';

export type TurnWorkDisclosureProjection = {
  /** Inclusive index of the first intermediate row hidden by the disclosure. */
  startIndex: number;
  /** Inclusive index immediately before the settled user-facing Assistant answer. */
  endIndex: number;
  elapsedMs?: number;
  failureCount: number;
};

export type ProjectTurnWorkDisclosureInput = {
  turn: TranscriptTurn;
  runRecordsById: Readonly<Record<string, RunRecordUi>>;
  activeRunId: string | null;
  /** Global streaming is relevant only to the newest/current turn. */
  currentTurnStreaming: boolean;
};

function hasVisibleFinalContent(message: ChatMessageUi): boolean {
  return (
    message.text.trim().length > 0 ||
    message.attachments.length > 0 ||
    (message.searchEvidence?.citations.length ?? 0) > 0
  );
}

function hasIntermediateWork(message: ChatMessageUi): boolean {
  return (
    message.role === 'assistant' &&
    (message.thinking.trim().length > 0 ||
      message.tools.length > 0 ||
      message.subagentActivity !== undefined)
  );
}

function isUserFacingReply(message: ChatMessageUi): boolean {
  return (
    message.role === 'assistant' &&
    message.status !== 'streaming' &&
    message.error === undefined &&
    !assistantHasWorkTools(message) &&
    hasVisibleFinalContent(message)
  );
}

function isSubagentActive(activity: ChatMessageUi['subagentActivity']): boolean {
  return activity !== undefined && (activity.state === 'started' || activity.state === 'running');
}

function isMessageActive(message: ChatMessageUi): boolean {
  return (
    message.status === 'streaming' ||
    message.tools.some((tool) => tool.status === 'running') ||
    isSubagentActive(message.subagentActivity)
  );
}

function findLastAssistantIndex(turn: TranscriptTurn): number {
  for (let index = turn.items.length - 1; index >= 0; index -= 1) {
    if (turn.items[index]?.message.role === 'assistant') return index;
  }
  return -1;
}

function findFirstAssistantIndex(turn: TranscriptTurn, endIndex: number): number {
  for (let index = 0; index <= endIndex; index += 1) {
    if (turn.items[index]?.message.role === 'assistant') return index;
  }
  return -1;
}

function prefixHasWork(turn: TranscriptTurn, startIndex: number, endIndex: number): boolean {
  for (let index = startIndex; index <= endIndex; index += 1) {
    const message = turn.items[index]?.message;
    if (message && hasIntermediateWork(message)) return true;
  }
  return false;
}

function prefixHasUserFacingReply(
  turn: TranscriptTurn,
  startIndex: number,
  endIndex: number,
): boolean {
  for (let index = startIndex; index <= endIndex; index += 1) {
    const message = turn.items[index]?.message;
    if (message && isUserFacingReply(message)) return true;
  }
  return false;
}

function collectRunIds(turn: TranscriptTurn): Set<string> {
  const runIds = new Set<string>();
  for (const { message } of turn.items) {
    if (message.runId) runIds.add(message.runId);
    for (const tool of message.tools) {
      if (tool.runId) runIds.add(tool.runId);
    }
  }
  return runIds;
}

function resolveElapsedMs(
  turn: TranscriptTurn,
  startIndex: number,
  endIndex: number,
  runIds: ReadonlySet<string>,
  runRecordsById: Readonly<Record<string, RunRecordUi>>,
): number | undefined {
  let earliestStart: number | undefined;
  let latestEnd: number | undefined;

  for (const runId of runIds) {
    const record = runRecordsById[runId];
    if (!record || record.startedAt === null || record.endedAt === null) continue;
    earliestStart =
      earliestStart === undefined ? record.startedAt : Math.min(earliestStart, record.startedAt);
    latestEnd = latestEnd === undefined ? record.endedAt : Math.max(latestEnd, record.endedAt);
  }

  if (earliestStart !== undefined && latestEnd !== undefined) {
    return Math.max(0, latestEnd - earliestStart);
  }

  for (let index = startIndex; index <= endIndex; index += 1) {
    const message = turn.items[index]?.message;
    if (!message) continue;
    const msgStart =
      message.thinkingStartedAt ??
      (message.createdAt ? Date.parse(message.createdAt) : undefined);
    const msgEnd =
      message.thinkingEndedAt ??
      (message.createdAt ? Date.parse(message.createdAt) : undefined);

    if (msgStart !== undefined && !Number.isNaN(msgStart)) {
      earliestStart =
        earliestStart === undefined ? msgStart : Math.min(earliestStart, msgStart);
    }
    if (msgEnd !== undefined && !Number.isNaN(msgEnd)) {
      latestEnd = latestEnd === undefined ? msgEnd : Math.max(latestEnd, msgEnd);
    }
  }

  if (earliestStart === undefined || latestEnd === undefined) return undefined;
  return Math.max(0, latestEnd - earliestStart);
}

function countFailures(
  turn: TranscriptTurn,
  startIndex: number,
  endIndex: number,
  runIds: ReadonlySet<string>,
  runRecordsById: Readonly<Record<string, RunRecordUi>>,
): number {
  let failedToolCount = 0;
  let hasNonToolFailure = false;

  for (let index = startIndex; index <= endIndex; index += 1) {
    const message = turn.items[index]?.message;
    if (!message) continue;
    failedToolCount += message.tools.filter((tool) => tool.status === 'error').length;
    if (message.status === 'error' || message.error !== undefined) {
      hasNonToolFailure = true;
    }
  }

  for (const runId of runIds) {
    if (runRecordsById[runId]?.outcome === 'failed') {
      hasNonToolFailure = true;
      break;
    }
  }

  return failedToolCount > 0 ? failedToolCount : hasNonToolFailure ? 1 : 0;
}

function isTurnSettled(
  input: ProjectTurnWorkDisclosureInput,
  runIds: ReadonlySet<string>,
): boolean {
  if (input.currentTurnStreaming) return false;
  if (input.turn.items.some(({ message }) => isMessageActive(message))) return false;
  if (input.activeRunId !== null && runIds.has(input.activeRunId)) return false;
  return true;
}

/**
 * Wrap intermediate Agent work only after the user query has settled.
 * Returning `null` keeps the original causal stream fully mounted.
 */
export function projectTurnWorkDisclosure(
  input: ProjectTurnWorkDisclosureInput,
): TurnWorkDisclosureProjection | null {
  const lastAssistantIndex = findLastAssistantIndex(input.turn);
  if (lastAssistantIndex <= 0) return null;
  const lastAssistant = input.turn.items[lastAssistantIndex]?.message;
  if (!lastAssistant || !isUserFacingReply(lastAssistant)) return null;

  const endIndex = lastAssistantIndex - 1;
  const startIndex = findFirstAssistantIndex(input.turn, endIndex);
  if (startIndex === -1 || endIndex < startIndex) return null;
  if (!prefixHasWork(input.turn, startIndex, endIndex)) return null;
  // A contiguous [start, end] would also hide any real reply in that span.
  if (prefixHasUserFacingReply(input.turn, startIndex, endIndex)) return null;

  const runIds = collectRunIds(input.turn);
  if (!isTurnSettled(input, runIds)) return null;

  const elapsedMs = resolveElapsedMs(
    input.turn,
    startIndex,
    endIndex,
    runIds,
    input.runRecordsById,
  );
  return {
    startIndex,
    endIndex,
    failureCount: countFailures(input.turn, startIndex, endIndex, runIds, input.runRecordsById),
    ...(elapsedMs !== undefined ? { elapsedMs } : {}),
  };
}
