/**
 * Conversation tree commands (ADR 0055): list branch points for the ‹n/m›
 * switcher and switch the active branch. Runs on the live command chain
 * because switching must dispose the live runtime (the replayed native
 * context belongs to the abandoned branch).
 */

import type {
  HostCommand,
  HostResponse,
  SessionBranchListData,
  SessionBranchSwitchData,
} from '@piwin/contracts';
import { collectWorkspaceWritesFromMessages } from '@piwin/contracts';
import {
  getSessionRecord,
  transcriptRevisionToken,
  upsertSessionRecord,
  type SessionTranscriptStore,
} from '@piwin/session';
import { fail, ok } from '../response-helpers.js';
import { getPiwinRoot, getPiwinSessionIndexPath } from '../paths.js';
import { rejectUnavailableSessionBody } from '../session-body-guard.js';
import { sessionBusyResponse } from '../session-body-gate.js';
import { createSessionMessageResponse } from '../session-message-response.js';
import { indexRecordToSummary } from '../session-summary-map.js';
import type { SessionLiveContext } from './session-live-context.js';

/** Matches the outline preview bound; enough for a one-line switcher label. */
const BRANCH_POINT_PREVIEW_CHARS = 120;

const TYPES = new Set<HostCommand['type']>(['session/branch-list', 'session/branch-switch']);

export function isSessionBranchCommand(command: HostCommand): boolean {
  return TYPES.has(command.type);
}

/**
 * Notify shells that the active leaf moved (branch prompt, switch, subtree
 * delete). Ids and counts only — no message bodies ride a push.
 */
export async function pushBranchUpdated(
  context: SessionLiveContext,
  sessionId: string,
  store: SessionTranscriptStore,
): Promise<void> {
  const branchPoints = await store.listBranchPoints({
    previewChars: BRANCH_POINT_PREVIEW_CHARS,
  });
  context.push({
    type: 'session/branch-updated',
    sessionId,
    activeLeafMessageId: await store.getActiveLeaf(),
    branchPointCount: branchPoints.length,
  });
}

export async function handleSessionBranchCommand(
  command: HostCommand,
  requestId: string | undefined,
  context: SessionLiveContext,
): Promise<HostResponse | null> {
  if (command.type === 'session/branch-list') {
    const indexPath = getPiwinSessionIndexPath(getPiwinRoot(context.piwinRoot));
    const record = await getSessionRecord(indexPath, command.sessionId);
    if (!record) {
      return fail(requestId, 'session/branch-list', `Unknown session: ${command.sessionId}`);
    }
    const rejected = rejectUnavailableSessionBody(
      requestId,
      'session/branch-list',
      record,
      'transcript',
    );
    if (rejected) {
      return rejected;
    }
    const store = await context.getTranscriptStore(command.sessionId);
    const branchPoints = await store.listBranchPoints({
      previewChars: BRANCH_POINT_PREVIEW_CHARS,
    });
    const data: SessionBranchListData = {
      sessionId: command.sessionId,
      revision: transcriptRevisionToken(command.sessionId, await store.getRevision()),
      branchPoints,
    };
    return ok(requestId, 'session/branch-list', data);
  }

  if (command.type === 'session/branch-switch') {
    const indexPath = getPiwinSessionIndexPath(getPiwinRoot(context.piwinRoot));
    const record = await getSessionRecord(indexPath, command.sessionId);
    if (!record) {
      return fail(requestId, 'session/branch-switch', `Unknown session: ${command.sessionId}`);
    }
    const rejected = rejectUnavailableSessionBody(
      requestId,
      'session/branch-switch',
      record,
      'truncate',
    );
    if (rejected) {
      return rejected;
    }
    // Same busy signal as prompt/truncate — never invent a new one. A running
    // foreground turn is a success-shaped refusal so shells can toast it.
    if (context.getForegroundRun(command.sessionId)) {
      const runActive: SessionBranchSwitchData = { status: 'run-active' };
      return ok(requestId, 'session/branch-switch', runActive);
    }
    if (!context.tryReserveSessionBody(command.sessionId)) {
      return sessionBusyResponse(requestId, 'session/branch-switch', command.sessionId, 'body-job');
    }
    try {
      const store = await context.getTranscriptStore(command.sessionId);
      // undefined = unknown target: stay quiet and let switchActiveBranch
      // below raise the real "does not exist" error.
      const abandoned = await store.listAbandonedAssistantRows(command.targetMessageId);
      const offPathWrites =
        abandoned === undefined ? null : collectWorkspaceWritesFromMessages(abandoned);
      if (offPathWrites !== null && command.confirm !== true) {
        const needsConfirmation: SessionBranchSwitchData = {
          status: 'needs-confirmation',
          offPathWrites,
        };
        return ok(requestId, 'session/branch-switch', needsConfirmation);
      }
      // The live generation replayed the old branch's native context; kill it
      // so the next prompt seeds from the switched path (ADR 0040 §7).
      // dispose closes the cached store — re-acquire before writing the leaf.
      await context.disposeLiveSession(command.sessionId, 'branch-switch');
      const liveStore = await context.getTranscriptStore(command.sessionId);
      let activeLeafMessageId: string;
      try {
        activeLeafMessageId = (await liveStore.switchActiveBranch(command.targetMessageId))
          .activeLeafMessageId;
      } catch (error) {
        if (error instanceof RangeError) {
          return fail(requestId, 'session/branch-switch', error.message);
        }
        throw error;
      }
      const remaining = await liveStore.listTail(50);
      record.messageCount = await liveStore.count();
      const last = remaining.at(-1);
      if (last?.text) {
        record.lastPreview = last.text.slice(0, 160);
      } else {
        delete record.lastPreview;
      }
      record.updatedAt = new Date().toISOString();
      await upsertSessionRecord(indexPath, record);
      if (offPathWrites !== null) {
        context.pendingBranchCalibrationBySession.set(command.sessionId, offPathWrites);
      }
      await pushBranchUpdated(context, command.sessionId, liveStore);
      const data: SessionBranchSwitchData = {
        status: 'switched',
        sessionId: command.sessionId,
        activeLeafMessageId,
        session: indexRecordToSummary(record),
        ...createSessionMessageResponse(
          command.sessionId,
          remaining,
          command.messageProjection ?? 'tail',
        ),
      };
      return ok(requestId, 'session/branch-switch', data);
    } finally {
      context.releaseSessionBody(command.sessionId);
    }
  }

  return null;
}
