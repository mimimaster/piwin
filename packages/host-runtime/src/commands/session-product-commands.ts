/**
 * Product-layer session index commands (list/pin/rename/archive/delete/duplicate/search).
 * Keep live prompt/spawn/compaction in HostRuntime — this module owns index lifecycle only.
 */
import { rm } from 'node:fs/promises';
import { formatError } from '@piwin/contracts';
import type {
  AgentHost,
  CreateSessionInput,
  HostCommand,
  HostResponse,
  SessionHandle,
  SessionTranscriptMessage,
} from '@piwin/contracts';
import {
  archiveSessionRecord,
  deleteSessionRecord,
  deriveDefaultNameFromMessage,
  duplicateProductSession,
  getSessionRecord,
  listSessionsForProject,
  pinSessionRecord,
  renameSessionRecord,
  searchSessions,
  setSessionAutoName,
  unarchiveSessionRecord,
  unpinSessionRecord,
  upsertSessionRecord,
  filterListableSessions,
} from '@piwin/session';
import { markSideChatSourceState } from '@piwin/session';
import {
  forkProductSession,
  ForkValidationError,
  getSessionLineage,
  getDirectForkNames,
  listAllSessionRecords,
} from '@piwin/session';
import { cloneSessionMedia, cleanupFailedMediaClone } from '@piwin/media';
import { fail, ok } from '../response-helpers.js';
import { indexRecordToSummary } from '../session-summary-map.js';
import {
  getPiwinRoot,
  getPiwinSessionDir,
  getPiwinSessionIndexPath,
  getPiwinSessionMediaDir,
  getPiwinSessionTranscriptPath,
} from '../paths.js';
import { resolveListFilter } from '../session-scope.js';

export type SessionProductCommandContext = {
  piwinRoot?: string;
  host: AgentHost;
  /** Load the persisted product transcript for a session (side-chat snapshot source). */
  loadTranscriptMessages: (sessionId: string) => Promise<SessionTranscriptMessage[]>;
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
  pushStatus: () => void;
};

const PRODUCT_COMMAND_TYPES = new Set<HostCommand['type']>([
  'session/list',
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

  switch (command.type) {
    case 'session/list': {
      const filter = resolveListFilter({
        ...(command.scope ? { scope: command.scope } : {}),
        ...(command.projectPath ? { projectPath: command.projectPath } : {}),
      });
      const indexed = await listSessionsForProject(indexPath, filter, {
        includeArchived: command.includeArchived === true,
      });
      // Sidebar policy: never list sessions that still lack a real display name.
      const sessions = filterListableSessions(indexed).map((item) => indexRecordToSummary(item));
      return ok(requestId, 'session/list', { sessions });
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
      const record = await setSessionAutoName(
        indexPath,
        command.sessionId,
        fallbackName,
        'text',
      );
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
      const created = await context.host.createSession(createInput);
      const sourceTranscriptPath = getPiwinSessionTranscriptPath(rootDir, command.sessionId);
      const targetTranscriptPath = getPiwinSessionTranscriptPath(rootDir, created.id);
      const duplicateInput: {
        sourceSessionId: string;
        newSessionId: string;
        name?: string;
      } = {
        sourceSessionId: command.sessionId,
        newSessionId: created.id,
      };
      if (typeof command.name === 'string') {
        duplicateInput.name = command.name;
      }
      const duplicated = await duplicateProductSession(
        {
          indexPath,
          sourceTranscriptPath,
          targetTranscriptPath,
        },
        duplicateInput,
      );
      if (!duplicated) {
        return fail(
          requestId,
          'session/duplicate',
          `Failed to duplicate session: ${command.sessionId}`,
        );
      }
      await context.bindSession(created, source.projectPath, duplicated.record.name, {
        kind: 'main',
        depth: 0,
      });
      const rebound = await getSessionRecord(indexPath, created.id);
      if (rebound) {
        rebound.messageCount = duplicated.record.messageCount;
        if (duplicated.record.lastPreview) {
          rebound.lastPreview = duplicated.record.lastPreview;
        }
        if (duplicated.record.name) {
          rebound.name = duplicated.record.name;
        }
        await upsertSessionRecord(indexPath, rebound);
      }
      const finalRecord = (await getSessionRecord(indexPath, created.id)) ?? duplicated.record;
      context.pushStatus();
      return ok(requestId, 'session/duplicate', {
        sessionId: created.id,
        sourceSessionId: command.sessionId,
        session: indexRecordToSummary(finalRecord),
        messages: duplicated.transcript.messages as SessionTranscriptMessage[],
      });
    }
    case 'session/fork': {
      const source = await getSessionRecord(indexPath, command.sessionId);
      if (!source) {
        return fail(requestId, 'session/fork', `Unknown session: ${command.sessionId}`);
      }
      if (source.isArchived === true) {
        return fail(requestId, 'session/fork', 'Source session is archived');
      }
      const createInput: CreateSessionInput = {
        projectPath: source.projectPath,
      };
      if (source.scope) {
        createInput.scope = source.scope;
      }
      const created = await context.host.createSession(createInput);
      const sourceTranscriptPath = getPiwinSessionTranscriptPath(rootDir, command.sessionId);
      const targetTranscriptPath = getPiwinSessionTranscriptPath(rootDir, created.id);
      const mediaRoot = getPiwinSessionMediaDir(rootDir, '');
      // Compute existing fork names for collision avoidance.
      const allRecords = await listAllSessionRecords(indexPath);
      const existingForkNames = getDirectForkNames(allRecords, command.sessionId);

      try {
        const forked = await forkProductSession(
          {
            indexPath,
            sourceTranscriptPath,
            targetTranscriptPath,
          },
          {
            sourceSessionId: command.sessionId,
            messageId: command.messageId,
            ...(typeof command.name === 'string' ? { name: command.name } : {}),
            newSessionId: created.id,
            workspaceStrategy: command.workspaceStrategy,
            cloneMedia: async (transcript) => {
              await cloneSessionMedia(transcript, {
                mediaRoot,
                targetSessionId: created.id,
              });
            },
          },
        );
        if (!forked) {
          await cleanupFailedMediaClone(mediaRoot, created.id);
          return fail(requestId, 'session/fork', `Failed to fork session: ${command.sessionId}`);
        }
        await context.bindSession(created, source.projectPath, forked.record.name, {
          kind: 'main',
          depth: 0,
        });
       const rebound = await getSessionRecord(indexPath, created.id);
        if (rebound) {
          rebound.messageCount = forked.record.messageCount;
          if (forked.record.lastPreview) {
            rebound.lastPreview = forked.record.lastPreview;
          }
          if (forked.record.name) {
            rebound.name = forked.record.name;
          }
          await upsertSessionRecord(indexPath, rebound);
        }
        const finalRecord = (await getSessionRecord(indexPath, created.id)) ?? forked.record;
        context.pushStatus();
        return ok(requestId, 'session/fork', {
          sessionId: created.id,
          sourceSessionId: command.sessionId,
          session: indexRecordToSummary(finalRecord),
          messages: forked.transcript.messages as SessionTranscriptMessage[],
          origin: forked.origin,
        });
      } catch (error) {
        await cleanupFailedMediaClone(mediaRoot, created.id);
        if (error instanceof ForkValidationError) {
          return fail(requestId, 'session/fork', error.message);
        }
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
          resolveTranscriptPath: (sessionId) => getPiwinSessionTranscriptPath(rootDir, sessionId),
        },
        command.query,
      );
      return ok(requestId, 'session/search', result);
    }
    default:
      return null;
  }
}
