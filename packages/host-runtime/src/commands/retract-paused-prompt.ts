/**
 * `session/retract-paused-prompt`: the user stopped a turn before the model
 * produced anything, so the prompt goes back to them instead of staying in
 * the transcript as an unanswered question (Cursor-style). Host owns the
 * "nothing produced yet" decision; clients only restore the returned input.
 */
import type {
  HostCommand,
  HostResponse,
  SessionRetractedPrompt,
  SessionTranscriptMessage,
} from '@piwin/contracts';
import { SESSION_RETRACT_REFUSALS } from '@piwin/contracts';
import { fail } from '../response-helpers.js';
import type { SessionLiveContext } from './session-live-context.js';
import { truncateSessionFrom } from './session-truncate.js';

/** Rows scanned after the prompt; a paused-before-output turn has at most a few. */
const RETRACT_TAIL_WINDOW = 50;

/** Prompts that were not typed as a fresh question cannot be handed back. */
const NON_RETRACTABLE_SOURCES = new Set<SessionTranscriptMessage['source']>([
  'resume',
  'continuation',
  'voice-delegation',
]);

function hasModelOutput(message: SessionTranscriptMessage): boolean {
  return (
    message.text.trim().length > 0 ||
    (message.thinking?.trim().length ?? 0) > 0 ||
    (message.tools?.length ?? 0) > 0
  );
}

/**
 * Decide from the durable transcript whether `anchor` is still a bare prompt:
 * the last user row, followed only by assistant rows that carry nothing.
 */
export function classifyRetractablePrompt(
  anchor: SessionTranscriptMessage,
  tail: readonly SessionTranscriptMessage[],
): string | undefined {
  if (anchor.role !== 'user' || NON_RETRACTABLE_SOURCES.has(anchor.source)) {
    return SESSION_RETRACT_REFUSALS.notRetractable;
  }
  // A steer is the last user row of a turn the model was already answering;
  // cutting from it would keep that earlier output and drop only the steer.
  if (anchor.instructionDelivery?.kind === 'run-intervention') {
    return SESSION_RETRACT_REFUSALS.notRetractable;
  }
  const anchorIndex = tail.findIndex((message) => message.id === anchor.id);
  if (anchorIndex < 0) {
    return SESSION_RETRACT_REFUSALS.notRetractable;
  }
  for (const message of tail.slice(anchorIndex + 1)) {
    // A steer or queued follow-up landed in this turn; it is no longer one prompt.
    if (message.role === 'user') return SESSION_RETRACT_REFUSALS.notRetractable;
    if (message.role === 'assistant' && hasModelOutput(message)) {
      return SESSION_RETRACT_REFUSALS.hasOutput;
    }
  }
  return undefined;
}

export async function retractPausedPrompt(
  command: Extract<HostCommand, { type: 'session/retract-paused-prompt' }>,
  requestId: string | undefined,
  context: SessionLiveContext,
): Promise<HostResponse> {
  const commandType = 'session/retract-paused-prompt';
  const checkpoint = await context.getActivePauseCheckpoint(command.sessionId);
  if (checkpoint === undefined || checkpoint.checkpointId !== command.checkpointId) {
    return fail(requestId, commandType, SESSION_RETRACT_REFUSALS.checkpointStale);
  }
  if (checkpoint.sourceUserMessageId === undefined) {
    return fail(requestId, commandType, SESSION_RETRACT_REFUSALS.notRetractable);
  }
  // Pausing cancelled running subagents; their worktrees are real output.
  if ((checkpoint.interruptedSubagentRunIds?.length ?? 0) > 0) {
    return fail(requestId, commandType, SESSION_RETRACT_REFUSALS.hasOutput);
  }

  let retracted: SessionRetractedPrompt | undefined;
  const response = await truncateSessionFrom(
    {
      sessionId: command.sessionId,
      messageId: checkpoint.sourceUserMessageId,
      ...(command.messageProjection !== undefined
        ? { messageProjection: command.messageProjection }
        : {}),
      guard: async (store, anchor) => {
        const refusal = classifyRetractablePrompt(anchor, await store.listTail(RETRACT_TAIL_WINDOW));
        if (refusal !== undefined) return refusal;
        retracted = {
          userMessageId: anchor.id,
          text: anchor.text,
          ...(anchor.attachments !== undefined && anchor.attachments.length > 0
            ? { attachments: anchor.attachments }
            : {}),
          ...(anchor.contextRefs !== undefined && anchor.contextRefs.length > 0
            ? { contextRefs: anchor.contextRefs }
            : {}),
        };
        return undefined;
      },
    },
    requestId,
    context,
    commandType,
  );
  if (!response.success || retracted === undefined) {
    return response;
  }
  // After the cut: a failed cut above must leave the turn resumable.
  await context.clearPauseCheckpoint(command.sessionId, checkpoint.checkpointId);
  return {
    ...response,
    data: { ...(response.data as Record<string, unknown>), retracted },
  };
}
