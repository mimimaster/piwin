/**
 * The gap between a tool round and the model's next token.
 *
 * Host moves the run to `waiting-first-token` once every in-flight tool ends
 * (`connecting-model` while a provider retry is pending). The run status
 * footer reads this to switch to the model-wait phrase; without it the chain
 * looked frozen for as long as a slow follow-up took (50s+ on Gemini).
 */
import { isAssistantContentEmpty } from './assistant-message-content';
import type { ChatMessageUi, RunRecordUi } from './chat-reducer';

export type ModelWaitTail = {
  kind: 'waiting' | 'reconnecting';
  /** Empty `message/start` bubble the footer stands in for (kept hidden). */
  placeholderMessageIds: string[];
};

const WAIT_PHASES: ReadonlySet<string> = new Set(['waiting-first-token', 'connecting-model']);

export function resolveModelWaitTail(input: {
  /** Messages of the current turn, transcript order. */
  messages: readonly ChatMessageUi[];
  streaming: boolean;
  activeRunId: string | null;
  runRecordsById: Record<string, RunRecordUi>;
  permissionPending: boolean;
}): ModelWaitTail | null {
  if (!input.streaming || input.activeRunId === null || input.permissionPending) {
    return null;
  }

  // The reducer settles earlier responses when the next one starts, so only
  // the newest row can be a live, still-empty placeholder.
  const last = input.messages[input.messages.length - 1];
  const placeholder =
    last?.role === 'assistant' && last.status === 'streaming' && isAssistantContentEmpty(last)
      ? last
      : undefined;
  const toolRound = input.messages[input.messages.length - (placeholder ? 2 : 1)];
  if (
    toolRound?.role !== 'assistant' ||
    toolRound.tools.length === 0 ||
    toolRound.tools.some((tool) => tool.status === 'running') ||
    (toolRound.runId !== undefined && toolRound.runId !== input.activeRunId)
  ) {
    return null;
  }

  const record = input.runRecordsById[input.activeRunId];
  const latestPhase = record?.phaseHistory[record.phaseHistory.length - 1];
  if (latestPhase !== undefined) {
    if (!WAIT_PHASES.has(latestPhase.phase)) return null;
  } else if (toolRound.status === 'streaming') {
    // No phase authority: only trust a settled tool round.
    return null;
  }

  return {
    kind: latestPhase?.phase === 'connecting-model' ? 'reconnecting' : 'waiting',
    placeholderMessageIds: placeholder ? [placeholder.id] : [],
  };
}
