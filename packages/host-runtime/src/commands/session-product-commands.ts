/**
 * Product-layer session index commands (list/pin/rename/archive/delete/duplicate/search).
 * Keep live prompt/spawn/compaction in HostRuntime — this module owns index lifecycle only.
 */
import { rm } from 'node:fs/promises';
import { formatError } from '@piwin/contracts';
import type {
  CreateSessionInput,
  HostCommand,
  HostPush,
  HostResponse,
  ProductSessionOrigin,
  SessionHandle,
  SessionIndexRecord,
  SessionTranscriptMessage,
} from '@piwin/contracts';
import {
  archiveSessionRecord,
  deleteSessionRecord,
  deriveDefaultNameFromMessage,
  buildDuplicateSessionName,
  buildForkSessionName,
  cloneTranscriptMessage,
  createSessionRecord,
  getSessionRecord,
  listSessionsForProject,
  createSessionIndexPage,
  SessionIndexCursorError,
  pinSessionRecord,
  renameSessionRecord,
  searchSessions,
  setSessionAutoName,
  unarchiveSessionRecord,
  unpinSessionRecord,
  upsertSessionRecord,
  filterListableSessions,
  type SessionTranscriptStore,
} from '@piwin/session';
import { markSideChatSourceState } from '@piwin/session';
import { getSessionLineage, getDirectForkNames, listAllSessionRecords } from '@piwin/session';
import { cloneSessionMedia, cleanupFailedMediaClone } from '@piwin/media';
import { fail, ok } from '../response-helpers.js';
import { indexRecordToSummary } from '../session-summary-map.js';
import {
  getPiwinRoot,
  getPiwinSessionDir,
  getPiwinSessionIndexPath,
  getPiwinSessionMediaDir,
} from '../paths.js';
import { resolveListFilter } from '../session-scope.js';
import { repairLegacySessionNames } from '../session-name-repair.js';
import { createSessionMessageResponse } from '../session-message-response.js';

export type SessionProductCommandContext = {
  piwinRoot?: string;
  /** Host-owned admission path; reserves residency before backend creation. */
  createSession: (input: CreateSessionInput) => Promise<SessionHandle>;
  /** Load the persisted product transcript for a session (side-chat snapshot source). */
  loadTranscriptMessages: (sessionId: string) => Promise<SessionTranscriptMessage[]>;
  getTranscriptStore: (sessionId: string, projectPath?: string) => Promise<SessionTranscriptStore>;
  withTranscriptStore: <T>(
    sessionId: string,
    operation: (store: SessionTranscriptStore) => Promise<T>,
    projectPath?: string,
  ) => Promise<T>;
  /**
   * Abort a live handle if present (archive). Does not remove host maps.
   */
  abortLiveSession: (sessionId: string) => Promise<void>;
  /**
   * Abort + drop live maps/recorders for permanent delete.
   */
  disposeLiveSession: (sessionId: string) => Promise<void>;
  bindSession: (
    session: SessionHandle,
    projectPath?: string,
    sessionName?: string,
    lineage?: { kind?: 'main' | 'subagent' | 'side-chat'; depth?: number },
  ) => Promise<void>;
  /** Publish one-time legacy name repairs to every attached client. */
  push?: (message: HostPush) => void;
  pushStatus: () => void;
};

const PRODUCT_COMMAND_TYPES = new Set<HostCommand['type']>([
  'session/list',
  'session/list-page',
  'session/pin',
  'session/unpin',
  'session/rename',
  'session/auto-name',
  'session/archive',
  'session/unarchive',
  'session/delete',
  'session/duplicate',
  'session/fork',
  'session/lineage',
  'session/search',
]);

export function isSessionProductCommand(command: HostCommand): boolean {
  return PRODUCT_COMMAND_TYPES.has(command.type);
}

export async function handleSessionProductCommand(
  command: HostCommand,
  requestId: string | undefined,
  context: SessionProductCommandContext,
): Promise<HostResponse | null> {
  if (!isSessionProductCommand(command)) {
    return null;
  }

  const rootDir = getPiwinRoot(context.piwinRoot);
  const indexPath = getPiwinSessionIndexPath(rootDir);
  const repairIndexedNames = (records: readonly SessionIndexRecord[]) =>
    repairLegacySessionNames({
      indexPath,
      records,
      loadTranscriptMessages: (sessionId) =>
        context.withTranscriptStore(sessionId, async (store) => {
          const firstUserMessage = await store.firstMessageByRole('user');
          return firstUserMessage === undefined ? [] : [firstUserMessage];
        }),
      onRepaired: (record) => {
        if (record.name) {
          context.push?.({
            type: 'session/name-updated',
            sessionId: record.id,
            name: record.name,
            nameSource: 'text',
          });
        }
      },
      onWarning: (message) => {
        context.push?.({ type: 'host/log', level: 'warn', message });
      },
    });

  switch (command.type) {
    case 'session/list': {
      const filter = resolveListFilter({
        ...(command.scope ? { scope: command.scope } : {}),
        ...(command.projectPath ? { projectPath: command.projectPath } : {}),
      });
      const indexed = await listSessionsForProject(indexPath, filter, {
        includeArchived: command.includeArchived === true,
      });
      const repaired = await repairIndexedNames(indexed);
      // Sidebar policy: never list sessions that still lack a real display name.
      const sessions = filterListableSessions(repaired).map((item) => indexRecordToSummary(item));
      return ok(requestId, 'session/list', { sessions });
    }
    case 'session/list-page': {
      const indexed = await listSessionsForProject(indexPath, command.query.scope, {
        includeArchived: true,
      });
      const repaired = await repairIndexedNames(indexed);
      try {
        const result = createSessionIndexPage(repaired, command.query);
        if (result.status === 'stale-cursor') {
          return ok(requestId, 'session/list-page', result);
        }
        return ok(requestId, 'session/list-page', {
          status: 'page',
          sessions: result.sessions.map((item) => indexRecordToSummary(item)),
          page: result.page,
        });
      } catch (error) {
        if (error instanceof SessionIndexCursorError || error instanceof RangeError) {
          return fail(requestId, 'session/list-page', error.message);
        }
        throw error;
      }
    }
    case 'session/pin': {
      const record = await pinSessionRecord(indexPath, command.sessionId);
      if (!record) {
        return fail(requestId, 'session/pin', `Unknown session: ${command.sessionId}`);
      }
      return ok(requestId, 'session/pin', {
        sessionId: record.id,
        isPinned: true,
        pinnedAt: record.pinnedAt,
        session: indexRecordToSummary(record),
      });
    }
    case 'session/unpin': {
      const record = await unpinSessionRecord(indexPath, command.sessionId);
      if (!record) {
        return fail(requestId, 'session/unpin', `Unknown session: ${command.sessionId}`);
      }
      return ok(requestId, 'session/unpin', {
        sessionId: record.id,
        isPinned: false,
        session: indexRecordToSummary(record),
      });
    }
    case 'session/rename': {
      const existing = await getSessionRecord(indexPath, command.sessionId);
      if (!existing) {
        return fail(requestId, 'session/rename', `Unknown session: ${command.sessionId}`);
      }
      const record = await renameSessionRecord(indexPath, command.sessionId, command.name);
      if (!record) {
        return fail(requestId, 'session/rename', 'Session name must not be empty');
      }
      return ok(requestId, 'session/rename', {
        sessionId: record.id,
        name: record.name,
        session: indexRecordToSummary(record),
      });
    }
    case 'session/auto-name': {
      const existing = await getSessionRecord(indexPath, command.sessionId);
      if (!existing) {
        return fail(requestId, 'session/auto-name', `Unknown session: ${command.sessionId}`);
      }
      // Manual re-trigger of auto-naming (text fallback only; LLM path is host-driven).
      const fallbackName = deriveDefaultNameFromMessage(command.firstMessage);
      if (!fallbackName) {
        return fail(requestId, 'session/auto-name', 'No derivable name from first message');
      }
      const record = await setSessionAutoName(indexPath, command.sessionId, fallbackName, 'text');
      if (!record) {
        return fail(requestId, 'session/auto-name', 'Session name is user-set or empty');
      }
      return ok(requestId, 'session/auto-name', {
        sessionId: record.id,
        name: record.name,
        nameSource: record.nameSource,
        session: indexRecordToSummary(record),
      });
    }
    case 'session/archive': {
      const record = await archiveSessionRecord(indexPath, command.sessionId);
      if (!record) {
        return fail(requestId, 'session/archive', `Unknown session: ${command.sessionId}`);
      }
      await context.abortLiveSession(command.sessionId);
      // SIDE §11.3: mark dependent side chats' source state as 'archived'.
      await markSideChatSourceState(indexPath, command.sessionId, 'archived');
      return ok(requestId, 'session/archive', {
        sessionId: record.id,
        isArchived: true,
        archivedAt: record.archivedAt,
        session: indexRecordToSummary(record),
      });
    }
    case 'session/unarchive': {
      const record = await unarchiveSessionRecord(indexPath, command.sessionId);
      if (!record) {
        return fail(requestId, 'session/unarchive', `Unknown session: ${command.sessionId}`);
      }
      // SIDE §11.3: un-archiving a main session re-enables sync for its side
      // chats by resetting their sourceState from 'archived' back to 'active'.
      if (record.kind === 'main') {
        await markSideChatSourceState(indexPath, command.sessionId, 'active');
      }
      return ok(requestId, 'session/unarchive', {
        sessionId: record.id,
        isArchived: false,
        session: indexRecordToSummary(record),
      });
    }
    case 'session/delete': {
      const existing = await getSessionRecord(indexPath, command.sessionId);
      if (!existing) {
        return fail(requestId, 'session/delete', `Unknown session: ${command.sessionId}`);
      }
      if (existing.isArchived !== true && command.force !== true) {
        return fail(
          requestId,
          'session/delete',
          'Session must be archived before permanent delete (or pass force: true)',
        );
      }
      await context.disposeLiveSession(command.sessionId);
      const removed = await deleteSessionRecord(indexPath, command.sessionId);
      if (!removed) {
        return fail(requestId, 'session/delete', `Unknown session: ${command.sessionId}`);
      }
      // SIDE §11.3: mark dependent side chats' source state as 'missing'.
      await markSideChatSourceState(indexPath, command.sessionId, 'missing');
      const sessionDir = getPiwinSessionDir(rootDir, command.sessionId);
      try {
        await rm(sessionDir, { recursive: true, force: true });
      } catch {
        // Index already cleaned; leftover files are non-fatal.
      }
      // Product media vault is per-session — permanent delete removes it too
      // (not archive). Missing dir is fine (session never pasted images).
      const mediaSessionDir = getPiwinSessionMediaDir(rootDir, command.sessionId);
      try {
        await rm(mediaSessionDir, { recursive: true, force: true });
      } catch {
        // Non-fatal: index + session dir already gone.
      }
      return ok(requestId, 'session/delete', {
        sessionId: command.sessionId,
        deleted: true,
      });
    }
    case 'session/duplicate': {
      const source = await getSessionRecord(indexPath, command.sessionId);
      if (!source) {
        return fail(requestId, 'session/duplicate', `Unknown session: ${command.sessionId}`);
      }
      const createInput: CreateSessionInput = {
        projectPath: source.projectPath,
      };
      if (source.scope) {
        createInput.scope = source.scope;
      }
      if (typeof command.name === 'string' && command.name.trim().length > 0) {
        createInput.sessionName = command.name.trim();
      }
      const created = await context.createSession(createInput);
      try {
        const sourceStore = await context.getTranscriptStore(command.sessionId);
        const targetStore = await context.getTranscriptStore(created.id, source.projectPath);
        let messageCount = 0;
        let lastMessage: SessionTranscriptMessage | undefined;
        for await (const message of sourceStore.iterateAll(100)) {
          const cloned = cloneTranscriptMessage(message);
          await appendDerivedMessage(targetStore, cloned);
          messageCount += 1;
          lastMessage = cloned;
        }
        const displayName =
          typeof command.name === 'string' && command.name.trim().length > 0
            ? command.name.trim()
            : buildDuplicateSessionName(source.name, source.id);
        await context.bindSession(created, source.projectPath, displayName, {
          kind: 'main',
          depth: 0,
        });
        const record =
          (await getSessionRecord(indexPath, created.id)) ??
          createSessionRecord({
            id: created.id,
            projectPath: source.projectPath,
            ...(source.scope ? { scope: source.scope } : {}),
            ...(source.workingDirectory ? { workingDirectory: source.workingDirectory } : {}),
            name: displayName,
            kind: 'main',
            depth: 0,
          });
        record.messageCount = messageCount;
        if (lastMessage?.text) record.lastPreview = lastMessage.text.slice(0, 160);
        record.origin = {
          kind: 'duplicate',
          sourceSessionId: command.sessionId,
          ...(source.name ? { sourceSessionNameSnapshot: source.name } : {}),
          createdAt: new Date().toISOString(),
        };
        record.isPinned = false;
        record.isArchived = false;
        if (source.model) record.model = source.model;
        if (source.thinkingLevel) record.thinkingLevel = source.thinkingLevel;
        await upsertSessionRecord(indexPath, record);
        const messages = await targetStore.listTail(50);
        context.pushStatus();
        return ok(requestId, 'session/duplicate', {
          sessionId: created.id,
          sourceSessionId: command.sessionId,
          session: indexRecordToSummary(record),
          ...createSessionMessageResponse(created.id, messages, command.messageProjection),
        });
      } catch (error) {
        await context.disposeLiveSession(created.id).catch(() => undefined);
        await deleteSessionRecord(indexPath, created.id).catch(() => undefined);
        await rm(getPiwinSessionDir(rootDir, created.id), { recursive: true, force: true });
        return fail(requestId, 'session/duplicate', `Duplicate failed: ${formatError(error)}`);
      }
    }
    case 'session/fork': {
      const source = await getSessionRecord(indexPath, command.sessionId);
      if (!source) {
        return fail(requestId, 'session/fork', `Unknown session: ${command.sessionId}`);
      }
      if (source.isArchived === true) {
        return fail(requestId, 'session/fork', 'Source session is archived');
      }
      const sourceStore = await context.getTranscriptStore(command.sessionId);
      const selected = await sourceStore.getMessage(command.messageId);
      if (selected === undefined || selected.role !== 'assistant') {
        return fail(requestId, 'session/fork', 'Selected assistant response was not found');
      }
      if (selected.status !== 'done') {
        return fail(
          requestId,
          'session/fork',
          `Selected response is not complete (status: ${selected.status})`,
        );
      }
      const createInput: CreateSessionInput = {
        projectPath: source.projectPath,
      };
      if (source.scope) {
        createInput.scope = source.scope;
      }
      const created = await context.createSession(createInput);
      const mediaRoot = getPiwinSessionMediaDir(rootDir, '');
      // Compute existing fork names for collision avoidance.
      const allRecords = await listAllSessionRecords(indexPath);
      const existingForkNames = getDirectForkNames(allRecords, command.sessionId);

      try {
        const targetStore = await context.getTranscriptStore(created.id, source.projectPath);
        let messageCount = 0;
        let lastMessage: SessionTranscriptMessage | undefined;
        let reachedSelection = false;
        for await (const message of sourceStore.iterateAll(100)) {
          const cloned = cloneTranscriptMessage(message);
          if (cloned.attachments !== undefined) {
            const singleMessageDocument = {
              version: 1 as const,
              sessionId: created.id,
              projectPath: source.projectPath,
              messages: [cloned],
              updatedAt: new Date().toISOString(),
            };
            await cloneSessionMedia(singleMessageDocument, {
              mediaRoot,
              targetSessionId: created.id,
            });
          }
          await appendDerivedMessage(targetStore, cloned);
          messageCount += 1;
          lastMessage = cloned;
          if (message.id === command.messageId) {
            reachedSelection = true;
            break;
          }
        }
        if (!reachedSelection) {
          throw new Error(
            `Message not found while streaming source transcript: ${command.messageId}`,
          );
        }
        const displayName =
          typeof command.name === 'string' && command.name.trim().length > 0
            ? command.name.trim()
            : buildForkSessionName(source.name, source.id, existingForkNames);
        await context.bindSession(created, source.projectPath, displayName, {
          kind: 'main',
          depth: 0,
        });
        const record =
          (await getSessionRecord(indexPath, created.id)) ??
          createSessionRecord({
            id: created.id,
            projectPath: source.projectPath,
            ...(source.scope ? { scope: source.scope } : {}),
            ...(source.workingDirectory ? { workingDirectory: source.workingDirectory } : {}),
            name: displayName,
            nameSource: 'text',
            kind: 'main',
            depth: 0,
          });
        const origin: ProductSessionOrigin = {
          kind: 'fork',
          rootSessionId: source.origin?.kind === 'fork' ? source.origin.rootSessionId : source.id,
          sourceSessionId: command.sessionId,
          ...(source.name ? { sourceSessionNameSnapshot: source.name } : {}),
          sourceMessageId: command.messageId,
          sourceMessageRole: 'assistant',
          sourceMessagePreview: selected.text.slice(0, 200),
          sourceMessageCreatedAt: selected.createdAt,
          workspaceStrategy: command.workspaceStrategy,
          createdAt: new Date().toISOString(),
        };
        record.messageCount = messageCount;
        if (lastMessage?.text) record.lastPreview = lastMessage.text.slice(0, 160);
        record.origin = origin;
        if (source.model) record.model = source.model;
        if (source.thinkingLevel) record.thinkingLevel = source.thinkingLevel;
        await upsertSessionRecord(indexPath, record);
        const messages = await targetStore.listTail(50);
        context.pushStatus();
        return ok(requestId, 'session/fork', {
          sessionId: created.id,
          sourceSessionId: command.sessionId,
          session: indexRecordToSummary(record),
          ...createSessionMessageResponse(created.id, messages, command.messageProjection),
          origin,
        });
      } catch (error) {
        await cleanupFailedMediaClone(mediaRoot, created.id);
        await context.disposeLiveSession(created.id).catch(() => undefined);
        await deleteSessionRecord(indexPath, created.id).catch(() => undefined);
        await rm(getPiwinSessionDir(rootDir, created.id), { recursive: true, force: true });
        return fail(requestId, 'session/fork', `Fork failed: ${formatError(error)}`);
      }
    }
    case 'session/lineage': {
      const lineage = await getSessionLineage({ indexPath }, command.sessionId);
      return ok(requestId, 'session/lineage', lineage);
    }
    case 'session/search': {
      const result = await searchSessions(
        {
          indexPath,
          searchTranscript: (sessionId, query) =>
            context.withTranscriptStore(sessionId, (store) => store.searchMessage(query)),
        },
        command.query,
      );
      return ok(requestId, 'session/search', result);
    }
    default:
      return null;
  }
}

async function appendDerivedMessage(
  store: SessionTranscriptStore,
  message: SessionTranscriptMessage,
): Promise<void> {
  const result = await store.appendMessage({
    id: message.id,
    runtimeGenerationId: 'derived-copy-v1',
    backendMessageId: message.id,
    role: message.role,
    text: message.text,
    status: message.status,
    createdAt: message.createdAt,
    ...(message.thinking !== undefined ? { thinking: message.thinking } : {}),
    ...(message.runId !== undefined ? { runId: message.runId } : {}),
    ...(message.model !== undefined ? { model: message.model } : {}),
    ...(message.attachments !== undefined ? { attachments: message.attachments } : {}),
    ...(message.tools !== undefined ? { tools: message.tools } : {}),
    ...(message.phaseHistory !== undefined ||
    message.startedAt !== undefined ||
    message.endedAt !== undefined ||
    message.outcome !== undefined ||
    message.terminalMessage !== undefined ||
    message.subagentActivity !== undefined
      ? {
          metadata: {
            ...(message.phaseHistory !== undefined ? { phaseHistory: message.phaseHistory } : {}),
            ...(message.startedAt !== undefined ? { startedAt: message.startedAt } : {}),
            ...(message.endedAt !== undefined ? { endedAt: message.endedAt } : {}),
            ...(message.outcome !== undefined ? { outcome: message.outcome } : {}),
            ...(message.terminalMessage !== undefined
              ? { terminalMessage: message.terminalMessage }
              : {}),
            ...(message.subagentActivity !== undefined
              ? { subagentActivity: message.subagentActivity }
              : {}),
          },
        }
      : {}),
  });
  if (!result.ok) {
    throw new Error(`Derived transcript identity collision: ${message.id}`);
  }
}
