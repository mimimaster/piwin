/**
 * Prompt-time leaf moves (ADR 0055 / 0064).
 *
 * Branch rebases to the target user row's parent so the new prompt is a
 * sibling. Retry rebases to the user row itself so the new answer is an
 * assistant sibling — never a second user row.
 */
import type { HostResponse, SessionTranscriptMessage, WorkspaceWrites } from '@piwin/contracts';
import {
  collectWorkspaceWritesFromMessages,
  mergeWorkspaceWrites,
} from '@piwin/contracts';
import type { SessionTranscriptStore, TranscriptStoreMessageInput } from '@piwin/session';
import { fail } from '../response-helpers.js';
import { queuePendingBranchCalibration } from './branch-calibration.js';
import { pushBranchUpdated } from './session-branch-commands.js';
import type { SessionLiveContext } from './session-live-context.js';
import type { PromptCommand } from './prompt-preparation.js';

export async function rebaseForPromptTree(
  context: SessionLiveContext,
  command: PromptCommand,
  requestId: string | undefined,
): Promise<HostResponse | null> {
  const branchId = command.input.branchFromMessageId?.trim() || undefined;
  const retryId = command.input.retryUserMessageId?.trim() || undefined;
  if (command.input.source === 'continuation') {
    if (branchId !== undefined || retryId !== undefined) {
      return fail(requestId, 'session/prompt', 'continuation-and-repair-conflict');
    }
    return null;
  }
  if (branchId !== undefined && retryId !== undefined) {
    return fail(requestId, 'session/prompt', 'retry-and-branch-conflict');
  }
  if (retryId !== undefined) {
    return rebaseForRetryPrompt(context, command, requestId, retryId);
  }
  if (branchId !== undefined) {
    return rebaseForBranchPrompt(context, command, requestId, branchId);
  }
  return null;
}

async function rebaseForBranchPrompt(
  context: SessionLiveContext,
  command: PromptCommand,
  requestId: string | undefined,
  targetId: string,
): Promise<HostResponse | null> {
  if (context.getForegroundRun(command.sessionId)) {
    return fail(
      requestId,
      'session/prompt',
      `run-active: cannot branch from ${targetId} while a run is active`,
    );
  }
  const probe = await context.getTranscriptStore(command.sessionId);
  const target = await probe.getMessage(targetId);
  if (target === undefined) {
    return fail(requestId, 'session/prompt', `branch-target-not-found: ${targetId}`);
  }
  if (target.role !== 'user') {
    return fail(requestId, 'session/prompt', `branch-target-not-user: ${targetId}`);
  }
  const parentId = await probe.getParentMessageId(targetId);
  if (parentId === undefined) {
    return fail(requestId, 'session/prompt', `branch-target-not-found: ${targetId}`);
  }
  // Same write-boundary as branch-switch / retry: leaving the active attempt
  // under this prompt abandons its workspace writes. Disk does not follow.
  // Off-path targets must use targetId (not parentId): when the parent is
  // still on the active path, listAbandonedAssistantRows(parentId) is [].
  const pathAfter = await collectActivePathAfter(probe, targetId);
  const abandonedAssistants = pathAfter.onPath
    ? pathAfter.after.filter((message) => message.role === 'assistant')
    : ((await probe.listAbandonedAssistantRows(targetId)) ?? []);
  const writes = collectWorkspaceWritesFromMessages(abandonedAssistants);
  if (writes !== null && command.confirm !== true) {
    return fail(
      requestId,
      'session/prompt',
      `branch-leaves-writes: ${writes.files.join(', ')}`,
      { code: 'branch-leaves-writes', data: writes },
    );
  }
  await context.disposeLiveSession(command.sessionId, 'branch-switch');
  const store = await context.getTranscriptStore(command.sessionId);
  await store.rebaseActiveLeaf(parentId);
  await pushBranchUpdated(context, command.sessionId, store);
  if (writes !== null) {
    await queuePendingBranchCalibration(context, command.sessionId, writes);
  }
  await context.sessionContextCoordinator?.invalidate(command.sessionId, {
    reason: 'branch-switch',
    contextBoundary: { activeLeafMessageId: await store.getActiveLeaf() },
  });
  return null;
}

async function rebaseForRetryPrompt(
  context: SessionLiveContext,
  command: PromptCommand,
  requestId: string | undefined,
  targetId: string,
): Promise<HostResponse | null> {
  if (context.getForegroundRun(command.sessionId)) {
    return fail(
      requestId,
      'session/prompt',
      `run-active: cannot retry ${targetId} while a run is active`,
    );
  }
  const probe = await context.getTranscriptStore(command.sessionId);
  const target = await probe.getMessage(targetId);
  if (target === undefined) {
    return fail(requestId, 'session/prompt', `retry-target-not-found: ${targetId}`);
  }
  if (target.role !== 'user') {
    return fail(requestId, 'session/prompt', `retry-target-not-user: ${targetId}`);
  }
  const pathAfter = await collectActivePathAfter(probe, targetId);
  if (!pathAfter.onPath) {
    return fail(requestId, 'session/prompt', `retry-target-off-path: ${targetId}`);
  }
  const discardedAssistants =
    command.input.keepPreviousAttempt !== true
      ? pathAfter.after.filter((message) => message.role === 'assistant')
      : [];
  const writes =
    command.input.keepPreviousAttempt !== true
      ? collectWorkspaceWritesFromMessages(discardedAssistants)
      : null;
  if (writes !== null && command.confirm !== true) {
    return fail(
      requestId,
      'session/prompt',
      `retry-discards-writes: ${writes.files.join(', ')}`,
      { code: 'retry-discards-writes', data: writes },
    );
  }
  await context.disposeLiveSession(command.sessionId, 'branch-switch');
  const store = await context.getTranscriptStore(command.sessionId);
  if (command.input.keepPreviousAttempt !== true) {
    if (writes !== null) {
      // Keep inspectable evidence on the user row before the assistant sibling
      // that held workspaceWrites is truncated away.
      await persistDiscardedAttemptWrites(store, target, writes);
      await queuePendingBranchCalibration(context, command.sessionId, writes);
    }
    const firstChild = pathAfter.after[0];
    if (firstChild !== undefined) {
      await store.truncateFrom(firstChild.id);
    }
  }
  await store.rebaseActiveLeaf(targetId);
  await pushBranchUpdated(context, command.sessionId, store);
  await context.sessionContextCoordinator?.invalidate(command.sessionId, {
    reason: 'branch-switch',
    contextBoundary: { activeLeafMessageId: await store.getActiveLeaf() },
  });
  return null;
}

async function persistDiscardedAttemptWrites(
  store: SessionTranscriptStore,
  target: SessionTranscriptMessage,
  writes: WorkspaceWrites,
): Promise<void> {
  const discardedAttemptWrites = mergeWorkspaceWrites(
    target.discardedAttemptWrites ?? null,
    writes,
  );
  await store.updateMessage(target.id, {
    metadata: transcriptMetadataWithDiscardedWrites(target, discardedAttemptWrites),
  });
}

/** `updateMessage` replaces metadata_json wholesale — rebuild from the row. */
function transcriptMetadataWithDiscardedWrites(
  message: SessionTranscriptMessage,
  discardedAttemptWrites: WorkspaceWrites,
): NonNullable<TranscriptStoreMessageInput['metadata']> {
  return {
    ...(message.phaseHistory !== undefined ? { phaseHistory: message.phaseHistory } : {}),
    ...(message.startedAt !== undefined ? { startedAt: message.startedAt } : {}),
    ...(message.endedAt !== undefined ? { endedAt: message.endedAt } : {}),
    ...(message.thinkingStartedAt !== undefined
      ? { thinkingStartedAt: message.thinkingStartedAt }
      : {}),
    ...(message.thinkingEndedAt !== undefined
      ? { thinkingEndedAt: message.thinkingEndedAt }
      : {}),
    ...(message.outcome !== undefined ? { outcome: message.outcome } : {}),
    ...(message.terminalMessage !== undefined
      ? { terminalMessage: message.terminalMessage }
      : {}),
    ...(message.failure !== undefined ? { failure: message.failure } : {}),
    ...(message.subagentActivity !== undefined
      ? { subagentActivity: message.subagentActivity }
      : {}),
    ...(message.searchEvidence !== undefined
      ? { searchEvidence: message.searchEvidence }
      : {}),
    ...(message.instructionDelivery !== undefined
      ? { instructionDelivery: message.instructionDelivery }
      : {}),
    ...(message.docCardSequence !== undefined
      ? { docCardSequence: message.docCardSequence }
      : {}),
    ...(message.replyWriter !== undefined ? { replyWriter: message.replyWriter } : {}),
    ...(message.workspaceWrites !== undefined
      ? { workspaceWrites: message.workspaceWrites }
      : {}),
    ...(message.source !== undefined ? { promptSource: message.source } : {}),
    ...(message.voiceCallId !== undefined ? { voiceCallId: message.voiceCallId } : {}),
    ...(message.skillId !== undefined ? { skillId: message.skillId } : {}),
    discardedAttemptWrites,
  };
}

async function collectActivePathAfter(
  store: SessionTranscriptStore,
  userMessageId: string,
): Promise<{ onPath: boolean; after: SessionTranscriptMessage[] }> {
  const after: SessionTranscriptMessage[] = [];
  let seen = false;
  for await (const message of store.iterateActivePath()) {
    if (seen) {
      after.push(message);
    } else if (message.id === userMessageId) {
      seen = true;
    }
  }
  return { onPath: seen, after };
}
