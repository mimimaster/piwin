/**
 * Tell the model when files it may have read were undone or restored.
 *
 * Undo/redo rewrite workspace files outside any tool call, so the model's
 * earlier tool output (file contents, test results) can silently be stale.
 * On the next prompt of every session working in that workspace, the Host
 * prepends one short note naming the turn and paths and asking the model to
 * re-read before relying on what it saw. Delivery is durable (one note per
 * session per operation, across restarts); the user's own message is never
 * rewritten and no run is started because of it.
 */
import type { TurnChangePendingNotice, TurnChangeStore } from '@piwin/git';

import { workspaceIdForRoot } from './coordinator.js';

/** Paths listed per operation before `+N more`. */
export const NOTICE_MAX_PATHS = 20;
/** Operations reported in one note; older undelivered ones stay queued. */
const NOTICE_MAX_OPERATIONS = 10;

export type TurnChangeModelNotice = {
  text: string;
  operationIds: string[];
};

/**
 * The note for `sessionId`'s next prompt, or undefined when nothing changed
 * under it. Does not mark delivery: call `commitTurnChangeModelNotice` once
 * the note is really in the prompt.
 */
export function readTurnChangeModelNotice(input: {
  store: TurnChangeStore;
  sessionId: string;
  workspaceRoot: string;
}): TurnChangeModelNotice | undefined {
  const workspaceId = workspaceIdForRoot(input.workspaceRoot);
  // A session only hears about operations after it started working here.
  const since = input.store.getSessionFirstRunStart(input.sessionId, workspaceId);
  if (since === undefined) return undefined;
  const pending = input.store.listPendingNotices({
    workspaceId,
    sessionId: input.sessionId,
    sinceIso: since,
    limit: NOTICE_MAX_OPERATIONS,
  });
  if (pending.length === 0) return undefined;
  return {
    text: formatTurnChangeModelNotice(pending, input.sessionId),
    operationIds: pending.map((notice) => notice.operationId),
  };
}

export function commitTurnChangeModelNotice(
  store: TurnChangeStore,
  sessionId: string,
  notice: TurnChangeModelNotice,
): void {
  store.markNoticesDelivered(sessionId, notice.operationIds);
}

export function formatTurnChangeModelNotice(
  pending: readonly TurnChangePendingNotice[],
  sessionId: string,
): string {
  const lines = pending.map((notice) => {
    const verb = notice.direction === 'undo' ? 'undid' : 'restored (redo)';
    const whose = notice.turnSessionId === sessionId ? 'an earlier turn of this conversation' : 'a turn from another session';
    const shown = notice.relativePaths.slice(0, NOTICE_MAX_PATHS).join(', ');
    const more = notice.relativePaths.length - NOTICE_MAX_PATHS;
    const paths = shown.length > 0 ? `${shown}${more > 0 ? ` (+${String(more)} more)` : ''}` : '(no files)';
    return `- The user ${verb} ${whose}'s file changes at ${notice.finishedAt}: ${paths}`;
  });
  return [
    '[piwin-turn-changes]',
    'Files in this workspace were changed outside your tool calls:',
    ...lines,
    'Re-read these files before relying on earlier tool output about them; earlier edits and test results may no longer apply.',
    '[/piwin-turn-changes]',
  ].join('\n');
}
