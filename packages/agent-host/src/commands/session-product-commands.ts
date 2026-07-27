/**
 * Product-layer session index commands (list/pin/rename/archive/delete/duplicate/search).
 * Keep live prompt/spawn/compaction in HostRuntime — this module owns index lifecycle only.
 */
import { rm } from 'node:fs/promises';
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
  duplicateProductSession,
  getSessionRecord,
  listSessionsForProject,
  pinSessionRecord,
  renameSessionRecord,
  searchSessions,
  unarchiveSessionRecord,
  unpinSessionRecord,
  upsertSessionRecord,
} from '@piwin/session';
import { fail, ok } from '../response-helpers.js';
import { indexRecordToSummary } from '../session-summary-map.js';
import {
  getPiwinRoot,
  getPiwinSessionDir,
  getPiwinSessionIndexPath,
  getPiwinSessionTranscriptPath,
} from '../paths.js';
import { resolveListFilter } from '../session-scope.js';

export type SessionProductCommandContext = {
  piwinRoot?: string;
  host: AgentHost;
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
    lineage?: { kind?: 'main' | 'subagent'; depth?: number },
  ) => Promise<void>;
  pushStatus: () => void;
};

const PRODUCT_COMMAND_TYPES = new Set<HostCommand['type']>([
  'session/list',
  'session/pin',
  'session/unpin',
  'session/rename',
  'session/archive',
  'session/unarchive',
  'session/delete',
  'session/duplicate',
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
      const sessions = indexed.map((item) => indexRecordToSummary(item));
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
    case 'session/archive': {
      const record = await archiveSessionRecord(indexPath, command.sessionId);
      if (!record) {
        return fail(requestId, 'session/archive', `Unknown session: ${command.sessionId}`);
      }
      await context.abortLiveSession(command.sessionId);
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
      const sessionDir = getPiwinSessionDir(rootDir, command.sessionId);
      try {
        await rm(sessionDir, { recursive: true, force: true });
      } catch {
        // Index already cleaned; leftover files are non-fatal.
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
