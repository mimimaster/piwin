/**
 * Delete a transcript message and its subtree (ADR 0055 explicit gesture).
 * Shared by `session/truncate-from` and `session/retract-paused-prompt`.
 */
import type {
  HostResponse,
  SessionMessageProjection,
  SessionTranscriptMessage,
} from '@piwin/contracts';
import {
  getSessionRecord,
  openModelContextStore,
  upsertSessionRecord,
  type SessionTranscriptStore,
} from '@piwin/session';
import { fail, ok } from '../response-helpers.js';
import { sessionBusyResponse } from '../session-body-gate.js';
import { rejectUnavailableSessionBody } from '../session-body-guard.js';
import { indexRecordToSummary } from '../session-summary-map.js';
import {
  getPiwinRoot,
  getPiwinSessionIndexPath,
  getPiwinSessionModelContextDatabasePath,
} from '../paths.js';
import { createSessionMessageResponse } from '../session-message-response.js';
import { pushBranchUpdated } from './session-branch-commands.js';
import type { SessionLiveContext } from './session-live-context.js';

export type SessionTruncateCommandType = 'session/truncate-from' | 'session/retract-paused-prompt';

export type SessionTruncateInput = {
  sessionId: string;
  messageId: string;
  messageProjection?: SessionMessageProjection;
  /**
   * Runs while the session body is reserved, before anything is cut. A
   * returned string fails the command with that error and leaves the
   * transcript untouched.
   */
  guard?: (
    store: SessionTranscriptStore,
    anchor: SessionTranscriptMessage,
  ) => Promise<string | undefined>;
};

export async function truncateSessionFrom(
  input: SessionTruncateInput,
  requestId: string | undefined,
  context: SessionLiveContext,
  commandType: SessionTruncateCommandType,
): Promise<HostResponse> {
  const rootDir = getPiwinRoot(context.piwinRoot);
  const indexPath = getPiwinSessionIndexPath(rootDir);
  const record = await getSessionRecord(indexPath, input.sessionId);
  if (!record) {
    return fail(requestId, commandType, `Unknown session: ${input.sessionId}`);
  }
  const rejectedTruncate = rejectUnavailableSessionBody(requestId, commandType, record, 'truncate');
  if (rejectedTruncate) {
    return rejectedTruncate;
  }
  if (context.getForegroundRun(input.sessionId)) {
    return sessionBusyResponse(requestId, commandType, input.sessionId, 'foreground-run');
  }
  if (!context.tryReserveSessionBody(input.sessionId)) {
    return sessionBusyResponse(requestId, commandType, input.sessionId, 'body-job');
  }
  try {
    const store = await context.getTranscriptStore(input.sessionId);
    const truncationAnchor = await store.getMessage(input.messageId);
    if (truncationAnchor === undefined) {
      return fail(requestId, commandType, `Message not found in transcript: ${input.messageId}`);
    }
    const guardError = await input.guard?.(store, truncationAnchor);
    if (guardError !== undefined) {
      return fail(requestId, commandType, guardError);
    }
    // Ledger boundaries only exist on the active path (ADR 0055 R3): a
    // side-branch subtree deletion must not cut the linear model-context
    // ledger, so record whether the anchor is on-path while scanning.
    let anchorOnActivePath = false;
    let ledgerBoundaryMessageId: string | undefined;
    let ledgerBoundaryCreatedAt = truncationAnchor.createdAt;
    for await (const message of store.iterateActivePath(100)) {
      if (message.id === truncationAnchor.id) {
        anchorOnActivePath = true;
        break;
      }
      if (message.role === 'user') {
        ledgerBoundaryMessageId = message.id;
        ledgerBoundaryCreatedAt = message.createdAt;
      }
    }
    if (truncationAnchor.role === 'user' && anchorOnActivePath) {
      ledgerBoundaryMessageId = truncationAnchor.id;
      ledgerBoundaryCreatedAt = truncationAnchor.createdAt;
    }
    // Runtime reset is a Host lifecycle transaction: it cancels replacement
    // and active work, flushes/detaches the generation, releases residency,
    // and preserves the durable session record that is about to be cut.
    await context.disposeLiveSession(input.sessionId, 'manual');
    const truncated = await store.truncateFrom(input.messageId);
    if (!truncated.found) {
      throw new Error(`Transcript changed before truncate: ${input.messageId}`);
    }
    if (anchorOnActivePath) {
      const modelContextStore = await openModelContextStore({
        dbPath: getPiwinSessionModelContextDatabasePath(rootDir, input.sessionId),
        sessionId: input.sessionId,
      });
      try {
        const events = await modelContextStore.listEvents();
        const matchingUserEvent =
          ledgerBoundaryMessageId !== undefined
            ? events
                .filter((event) => {
                  if (event.type !== 'turn/input') return false;
                  if (
                    event.payload === null ||
                    typeof event.payload !== 'object' ||
                    Array.isArray(event.payload)
                  ) {
                    return false;
                  }
                  return (
                    (event.payload as { userMessageId?: unknown }).userMessageId ===
                    ledgerBoundaryMessageId
                  );
                })
                .at(-1)
            : undefined;
        const boundarySeq =
          matchingUserEvent?.seq ??
          events.find((event) =>
            ledgerBoundaryMessageId !== undefined
              ? event.createdAt >= ledgerBoundaryCreatedAt
              : event.createdAt > truncationAnchor.createdAt,
          )?.seq;
        if (boundarySeq !== undefined) {
          await modelContextStore.truncateEventsFrom(boundarySeq);
        }
      } finally {
        modelContextStore.close();
      }
    }
    // ADR 0040 §7: no eager rebuild. The next session/prompt activates a
    // fresh runtime generation for the stable product session id and
    // injects the truncated product history exactly once. Keep the durable
    // history requirement pending so a cold prompt rebuilds from the cut
    // transcript only.
    const remaining = await store.listTail(50);
    record.messageCount = truncated.remainingCount;
    const last = remaining.at(-1);
    if (last?.text) {
      record.lastPreview = last.text.slice(0, 160);
    } else {
      delete record.lastPreview;
    }
    record.updatedAt = new Date().toISOString();
    await upsertSessionRecord(indexPath, record);
    // Subtree deletion can move the leaf and dissolve branch points.
    await pushBranchUpdated(context, input.sessionId, store);
    // Leaf write and occupancy invalidate are consecutive store ops, not one
    // SQLite transaction (`truncateFrom` does not accept context CAS).
    await context.sessionContextCoordinator?.invalidate(input.sessionId, {
      reason: 'truncate',
      empty: truncated.remainingCount === 0,
      contextBoundary: { activeLeafMessageId: await store.getActiveLeaf() },
    });
    return ok(requestId, commandType, {
      sessionId: input.sessionId,
      removedCount: truncated.removedCount,
      remainingCount: truncated.remainingCount,
      ...createSessionMessageResponse(input.sessionId, remaining, input.messageProjection),
      session: indexRecordToSummary(record),
    });
  } finally {
    context.releaseSessionBody(input.sessionId);
  }
}
