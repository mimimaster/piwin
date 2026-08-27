/**
 * Prompt-time leaf moves (ADR 0055 / 0064).
 *
 * Branch rebases to the target user row's parent so the new prompt is a
 * sibling. Retry rebases to the user row itself so the new answer is an
 * assistant sibling — never a second user row.
 */
import type { HostResponse, SessionTranscriptMessage } from '@piwin/contracts';
import { collectWorkspaceWritesFromMessages } from '@piwin/contracts';
import type { SessionTranscriptStore } from '@piwin/session';
import { fail } from '../response-helpers.js';
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
  await context.disposeLiveSession(command.sessionId, 'branch-switch');
  const store = await context.getTranscriptStore(command.sessionId);
  await store.rebaseActiveLeaf(parentId);
  await pushBranchUpdated(context, command.sessionId, store);
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
  if (command.input.keepPreviousAttempt !== true) {
    const writes = collectWorkspaceWritesFromMessages(
      pathAfter.after.filter((message) => message.role === 'assistant'),
    );
    if (writes !== null && command.confirm !== true) {
      return fail(
        requestId,
        'session/prompt',
        `retry-discards-writes: ${writes.files.join(', ')}`,
        { code: 'retry-discards-writes', data: writes },
      );
    }
  }
  await context.disposeLiveSession(command.sessionId, 'branch-switch');
  const store = await context.getTranscriptStore(command.sessionId);
  if (command.input.keepPreviousAttempt !== true) {
    const firstChild = pathAfter.after[0];
    if (firstChild !== undefined) {
      await store.truncateFrom(firstChild.id);
    }
  }
  await store.rebaseActiveLeaf(targetId);
  await pushBranchUpdated(context, command.sessionId, store);
  return null;
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
