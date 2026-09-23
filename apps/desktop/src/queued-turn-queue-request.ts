import type { QueuedTurnRecord } from '@piwin/contracts';
import type { ChatUiAction } from './chat-ui-types';
import type { HostClient } from './host-client';

export type QueuedTurnsHydrateAction = Extract<ChatUiAction, { type: 'session/queued-turns-hydrate' }>;

/**
 * Read the Host next-turn queue for one session. Resolves null when Host
 * refuses or answers with an unrecognized shape; callers decide whether the
 * answer still applies (selection may have moved while it was in flight).
 * The reducer drops hydrates older than its last queue revision, so this is
 * safe to call on every resync.
 */
export async function requestQueuedTurnQueue(
  hostClient: Pick<HostClient, 'request'>,
  sessionId: string,
): Promise<QueuedTurnsHydrateAction | null> {
  const response = await hostClient.request({ type: 'session/queued-turn-list', sessionId });
  if (!response.success) return null;
  const data = response.data as { queueRevision?: unknown; queuedTurns?: unknown } | undefined;
  if (
    data === undefined ||
    !Number.isSafeInteger(data.queueRevision) ||
    !Array.isArray(data.queuedTurns)
  ) {
    return null;
  }
  return {
    type: 'session/queued-turns-hydrate',
    sessionId,
    queueRevision: data.queueRevision as number,
    queuedTurns: data.queuedTurns as QueuedTurnRecord[],
  };
}
