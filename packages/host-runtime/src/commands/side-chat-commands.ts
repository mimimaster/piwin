/**
 * Side Chat product commands (SIDE spec §8–§9, ADR 0032).
 *
 * `side-chat/open` creates a persistent side-chat session bound to a main
 * session, captures a bounded context snapshot, and never sets
 * parentSessionId. `side-chat/list` projects the side chats of one source.
 * `side-chat/sync` bumps the context version from newly completed source
 * messages without rewriting the side chat's own transcript.
 */

import type {
  AgentHost,
  CreateSessionInput,
  HostCommand,
  HostResponse,
  SessionHandle,
  SessionTranscriptMessage,
  SideChatContextSnapshot,
  SideChatListData,
  SideChatOpenData,
  SideChatRelation,
  SideChatSyncData,
} from '@piwin/contracts';
import {
  buildSideChatContextSnapshot,
  createSideChatSessionRecord,
  getSessionRecord,
  getSideChatSessionRecord,
  listSideChatSessions,
  updateSideChatContext,
} from '@piwin/session';
import { fail, ok } from '../response-helpers.js';
import { indexRecordToSummary } from '../session-summary-map.js';
import {
  getPiwinRoot,
  getPiwinSessionIndexPath,
} from '../paths.js';

export type SideChatCommandContext = {
  piwinRoot?: string;
  host: AgentHost;
  bindSession: (
    session: SessionHandle,
    projectPath?: string,
    sessionName?: string,
    lineage?: { kind?: 'main' | 'subagent' | 'side-chat' },
  ) => Promise<void>;
  pushStatus: () => void;
  loadTranscriptMessages: (sessionId: string) => Promise<SessionTranscriptMessage[]>;
};

const SIDE_CHAT_COMMAND_TYPES = new Set<HostCommand['type']>([
  'side-chat/open',
  'side-chat/list',
  'side-chat/sync',
]);

export function isSideChatCommand(command: HostCommand): boolean {
  return SIDE_CHAT_COMMAND_TYPES.has(command.type);
}

function defaultSideChatName(sourceName: string | undefined): string {
  return sourceName && sourceName.trim().length > 0
    ? `Side Chat · ${sourceName.trim()}`
    : 'Side Chat';
}

function workspaceFromSource(source: {
  scope?: { kind: 'general' } | { kind: 'project'; projectPath: string };
  workingDirectory?: string;
  projectPath: string;
}): SideChatContextSnapshot['workspace'] {
  if (source.scope?.kind === 'project') {
    return {
      scope: 'project',
      projectPath: source.scope.projectPath,
      workingDirectory: source.workingDirectory ?? source.scope.projectPath,
    };
  }
  return {
    scope: 'general',
    workingDirectory: source.workingDirectory ?? '',
  };
}

export async function handleSideChatCommand(
  command: HostCommand,
  requestId: string | undefined,
  context: SideChatCommandContext,
): Promise<HostResponse | null> {
  if (!isSideChatCommand(command)) {
    return null;
  }
  const rootDir = getPiwinRoot(context.piwinRoot);
  const indexPath = getPiwinSessionIndexPath(rootDir);

  switch (command.type) {
    case 'side-chat/open': {
      const source = await getSessionRecord(indexPath, command.sourceSessionId);
      if (!source) {
        return fail(
          requestId,
          'side-chat/open',
          `Unknown source session: ${command.sourceSessionId}`,
        );
      }
      if (source.kind === 'side-chat' || source.kind === 'subagent') {
        return fail(
          requestId,
          'side-chat/open',
          'Side Chat can only be created from a main product session',
        );
      }

      const sourceMessages = await context.loadTranscriptMessages(command.sourceSessionId);
      const throughMessageId =
        command.sourceMessageId && sourceMessages.some((m) => m.id === command.sourceMessageId)
          ? command.sourceMessageId
          : lastPersistedMessageId(sourceMessages);

      const snapshot = buildSideChatContextSnapshot({
        version: 1,
        sourceSessionId: command.sourceSessionId,
        ...(throughMessageId ? { throughMessageId } : {}),
        workspace: workspaceFromSource(source),
        ...(command.refs ? { refs: command.refs } : {}),
        messages: sourceMessages,
      });

      const createInput: CreateSessionInput = {
        projectPath: source.projectPath,
        sessionKind: 'side-chat',
      };
      if (source.scope) {
        createInput.scope = source.scope;
      }
      const name = command.name?.trim() || defaultSideChatName(source.name);
      createInput.sessionName = name;

      let session: SessionHandle;
      try {
        session = await context.host.createSession(createInput);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return fail(requestId, 'side-chat/open', `side session create failed: ${message}`);
      }

      await context.bindSession(session, source.projectPath, name, { kind: 'side-chat' });

      const relation: SideChatRelation = {
        kind: 'side-chat',
        sourceSessionId: command.sourceSessionId,
        ...(throughMessageId ? { sourceMessageId: throughMessageId } : {}),
        sourceCapturedAt: snapshot.capturedAt,
        contextVersion: 1,
        sourceState: 'active',
      };

      // SIDE §9.1(8): a failed index write must not leave a half-created side
      // session — drop the live handle before surfacing the error.
      let record: import('@piwin/contracts').SessionIndexRecord;
      try {
        record = await createSideChatSessionRecord(indexPath, {
          id: session.id,
          projectPath: source.projectPath,
          ...(source.scope ? { scope: source.scope } : {}),
          ...(source.workingDirectory ? { workingDirectory: source.workingDirectory } : {}),
          name,
          relation,
          context: snapshot,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await context.host.dropSession(session.id).catch(() => undefined);
        return fail(
          requestId,
          'side-chat/open',
          `side chat index write failed: ${message}`,
        );
      }
      context.pushStatus();
      return ok(requestId, 'side-chat/open', {
        sideChatSessionId: session.id,
        session: indexRecordToSummary(record),
        relation,
        context: snapshot,
      } satisfies SideChatOpenData);
    }
    case 'side-chat/list': {
      const records = await listSideChatSessions(indexPath, command.sourceSessionId, {
        includeArchived: command.includeArchived === true,
      });
      return ok(requestId, 'side-chat/list', {
        sourceSessionId: command.sourceSessionId,
        sessions: records.map((record) => indexRecordToSummary(record)),
      } satisfies SideChatListData);
    }
    case 'side-chat/sync': {
      const sideRecord = await getSideChatSessionRecord(indexPath, command.sideChatSessionId);
      if (!sideRecord?.sideChatRelation) {
        return fail(
          requestId,
          'side-chat/sync',
          `Unknown side chat session: ${command.sideChatSessionId}`,
        );
      }
      const source = await getSessionRecord(indexPath, sideRecord.sideChatRelation.sourceSessionId);
      if (!source) {
        return fail(
          requestId,
          'side-chat/sync',
          `Source session is missing (${sideRecord.sideChatRelation.sourceSessionId}); cannot sync`,
        );
      }
      if (sideRecord.sideChatRelation.sourceState !== 'active') {
        return fail(
          requestId,
          'side-chat/sync',
          'Source session is not active; sync is disabled',
        );
      }

      const sourceMessages = await context.loadTranscriptMessages(
        sideRecord.sideChatRelation.sourceSessionId,
      );
      const previousThrough = sideRecord.sideChatContext?.throughMessageId;
      // SIDE §7.5: message ids are opaque (UUID / Pi backend ids), so
      // "newer than the boundary" must use transcript array order (appends
      // are chronological), never string comparison of ids.
      let newMessages = sourceMessages;
      if (previousThrough) {
        const boundaryIndex = sourceMessages.findIndex(
          (message) => message.id === previousThrough,
        );
        if (boundaryIndex === -1) {
          // SIDE §7.5(7): the boundary message was truncated/removed — keep
          // the old snapshot and surface an explainable stale error instead
          // of silently replacing the context.
          return fail(
            requestId,
            'side-chat/sync',
            `Source context boundary ${previousThrough} was truncated or removed; ` +
              'keeping the previous snapshot. Open a fresh side chat to capture current context.',
          );
        }
        newMessages = sourceMessages.slice(boundaryIndex + 1);
      }
      if (newMessages.length === 0) {
        // No new messages — return the existing snapshot unchanged.
        if (!sideRecord.sideChatContext) {
          return fail(
            requestId,
            'side-chat/sync',
            'Side chat has no context snapshot to sync',
          );
        }
        return ok(requestId, 'side-chat/sync', {
          sideChatSessionId: command.sideChatSessionId,
          relation: sideRecord.sideChatRelation,
          context: sideRecord.sideChatContext,
        } satisfies SideChatSyncData);
      }

      const nextVersion = (sideRecord.sideChatRelation.contextVersion ?? 0) + 1;
      const throughMessageId =
        lastPersistedMessageId(sourceMessages) ?? previousThrough;
      const nextSnapshot = buildSideChatContextSnapshot({
        version: nextVersion,
        sourceSessionId: sideRecord.sideChatRelation.sourceSessionId,
        ...(throughMessageId ? { throughMessageId } : {}),
        workspace: workspaceFromSource(source),
        ...(command.refs
          ? { refs: command.refs }
          : sideRecord.sideChatContext?.refs
            ? { refs: sideRecord.sideChatContext.refs }
            : {}),
        messages: sourceMessages,
      });

      const updated = await updateSideChatContext(indexPath, command.sideChatSessionId, nextSnapshot);
      if (!updated?.sideChatRelation) {
        return fail(
          requestId,
          'side-chat/sync',
          `Failed to sync side chat: ${command.sideChatSessionId}`,
        );
      }
      return ok(requestId, 'side-chat/sync', {
        sideChatSessionId: command.sideChatSessionId,
        relation: updated.sideChatRelation,
        context: nextSnapshot,
      } satisfies SideChatSyncData);
    }
    default:
      return null;
  }
}

/** Last persisted (non-streaming-tail) message id, when any message exists. */
function lastPersistedMessageId(messages: SessionTranscriptMessage[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message && message.status !== 'streaming') {
      return message.id;
    }
  }
  return messages[messages.length - 1]?.id;
}
