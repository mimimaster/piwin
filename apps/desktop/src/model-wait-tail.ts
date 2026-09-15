/**
 * The gap between a tool round and the model's next token.
 *
 * Host moves the run to `waiting-first-token` once every in-flight tool ends
 * (`connecting-model` while a provider retry is pending). Without a tail row
 * the chain looked frozen: the last tool was already settled while the header
 * still read 正在运行 for as long as a slow follow-up took (50s+ on Gemini).
 */
import { isAssistantContentEmpty } from './assistant-message-content';
import type { ChatMessageUi, RunRecordUi } from './chat-reducer';
import { shortModelLabel } from './chat-turn-marginalia';

export type ModelWaitTail = {
  kind: 'waiting' | 'reconnecting';
  /** Epoch ms the wait began; drives the live clock. */
  since?: number;
  modelLabel?: string;
  /** Host retry detail (e.g. attempt counter) while reconnecting. */
  detail?: string;
  /** Empty `message/start` bubbles the tail stands in for (hide their locator). */
  placeholderMessageIds: string[];
};

const WAIT_PHASES: ReadonlySet<string> = new Set(['waiting-first-token', 'connecting-model']);

function latestToolEndedAt(message: ChatMessageUi): number | undefined {
  let latest: number | undefined;
  for (const tool of message.tools) {
    const endedAt = tool.presentation?.endedAt ? Date.parse(tool.presentation.endedAt) : Number.NaN;
    if (Number.isFinite(endedAt) && (latest === undefined || endedAt > latest)) {
      latest = endedAt;
    }
  }
  return latest;
}

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

  const placeholderMessageIds: string[] = [];
  let index = input.messages.length - 1;
  for (; index >= 0; index -= 1) {
    const message = input.messages[index];
    if (message?.role !== 'assistant') break;
    if (message.status !== 'streaming' || !isAssistantContentEmpty(message)) break;
    placeholderMessageIds.unshift(message.id);
  }
  const toolRound = input.messages[index];
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

  const since = latestPhase?.at ?? latestToolEndedAt(toolRound);
  const modelLabel = toolRound.model?.modelId ? shortModelLabel(toolRound.model.modelId) : '';
  const reconnecting = latestPhase?.phase === 'connecting-model';
  return {
    kind: reconnecting ? 'reconnecting' : 'waiting',
    ...(since !== undefined ? { since } : {}),
    ...(modelLabel ? { modelLabel } : {}),
    ...(reconnecting && latestPhase?.detail ? { detail: latestPhase.detail } : {}),
    placeholderMessageIds,
  };
}
