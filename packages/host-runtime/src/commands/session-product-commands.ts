/**
 * Product-layer session index commands (list/pin/rename/archive/delete/duplicate/search).
 * Keep live prompt/spawn/compaction in HostRuntime — this module owns index lifecycle only.
 */
import { rm } from 'node:fs/promises';
import { formatError } from '@piwin/contracts';
import { rejectUnavailableSessionBody } from '../session-body-guard.js';
import type {
  CreateSessionInput,
  HostCommand,
  HostPush,
  HostResponse,
  ProductSessionOrigin,
  SessionHandle,
  SessionIndexRecord,
  SessionLifecycleApplyResult,
  SessionLifecycleApplySkipReason,
  SessionLifecyclePlan,
  SessionTranscriptMessage,
} from '@piwin/contracts';
import {
  createSessionLifecyclePlan,
  deleteSessionRecord,
  deriveDefaultNameFromMessage,
  buildDuplicateSessionName,
  buildForkSessionName,
  cloneTranscriptMessage,
  createSessionRecord,
  getSessionRecord,
  isPrimarySessionRecord,
  listSessionsForProject,
  loadSessionIndex,
  createSessionIndexPage,
  SessionIndexCursorError,
  pinSessionRecord,
  projectSessionIndex,
  renameSessionRecord,
  searchSessions,
  setSessionAutoName,
  unarchiveSessionRecord,
  unpinSessionRecord,
  upsertSessionRecord,
  type SessionTranscriptStore,
  openModelContextStore,
  copyModelContextLedger,
} from '@piwin/session';
import { getSessionLineage, listAllSessionRecords } from '@piwin/session';
import { cloneSessionMedia, cleanupFailedMediaClone } from '@piwin/media';
import { listProjects } from '@piwin/project';
import { fail, ok } from '../response-helpers.js';
import { sessionBusyResponse } from '../session-body-gate.js';
import { sessionIndexUpdatedPush } from '../session-index-push.js';
import { indexRecordToSummary } from '../session-summary-map.js';
import {
  getPiwinMediaDir,
  getPiwinRoot,
  getPiwinSessionModelContextDatabasePath,
  getPiwinProjectsPath,
  getPiwinSessionDir,
  getPiwinSessionIndexPath,
} from '../paths.js';
import { loadPiwinConfig } from '../config-store.js';
import { resolveListFilter, resolveScopeRefToListIntent } from '../session-scope.js';
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
  archiveSession: (sessionId: string) => Promise<SessionIndexRecord | undefined>;
  tryArchiveLifecycleCandidate: (input: {
    sessionId: string;
    expectedUpdatedAt: string;
  }) => Promise<
    { status: 'archived'; record: SessionIndexRecord } | { status: SessionLifecycleApplySkipReason }
  >;
  deleteSession: (
    sessionId: string,
  ) => Promise<{ removed: SessionIndexRecord; cleanupWarning?: string } | undefined>;
  bindSession: (
    session: SessionHandle,
    projectPath?: string,
    sessionName?: string,
    lineage?: { kind?: 'main' | 'subagent' | 'side-chat'; depth?: number },
  ) => Promise<void>;
  /** Publish one-time legacy name repairs to every attached client. */
  push?: (message: HostPush) => void;
  pushStatus: () => void;
  tryReserveSessionBody?: (sessionId: string) => boolean;
  releaseSessionBody?: (sessionId: string) => void;
  isSessionBodyReserved?: (sessionId: string) => boolean;
  getForegroundRun?: (sessionId: string) => { runId: string } | undefined;
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
  'session/lifecycle-plan',
  'session/lifecycle-apply',
  'session/delete',
  'session/duplicate',
  'session/fork',
  'session/lineage',
  'session/search',
  'session/model-context-summary',
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
      const includeArchived = command.includeArchived === true;
      let indexed: SessionIndexRecord[];
      let listAllScopes = command.allScopes === true;
      let scopeFilter = command.scope;
      if (command.scopeRef) {
        try {
          const intent = await resolveScopeRefToListIntent(command.scopeRef, context.piwinRoot);
          if ('allScopes' in intent) {
            listAllScopes = true;
          } else {
            scopeFilter = intent.scope;
          }
        } catch (error) {
          return fail(requestId, 'session/list', formatError(error));
        }
      }
      if (listAllScopes) {
        const all = await listAllSessionRecords(indexPath);
        indexed = all.filter(isPrimarySessionRecord);
      } else {
        const filter = resolveListFilter({
          ...(scopeFilter ? { scope: scopeFilter } : {}),
          ...(command.projectPath ? { projectPath: command.projectPath } : {}),
        });
        indexed = await listSessionsForProject(indexPath, filter, {
          includeArchived,
        });
      }
      const repaired = await repairIndexedNames(indexed);
      try {
        // Listability, order, and truncation belong to @piwin/session.
        // Map to SessionSummary only after the projection selected the final set.
        const projection = projectSessionIndex(repaired, {
          includeArchived,
          order: command.order ?? 'updated',
          ...(command.maxItems === undefined ? {} : { maxItems: command.maxItems }),
        });
        return ok(requestId, 'session/list', {
          sessions: projection.sessions.map((item) => indexRecordToSummary(item)),
          totalCount: projection.totalCount,
          truncated: projection.truncated,
        });
      } catch (error) {
        if (error instanceof RangeError) {
          return fail(requestId, 'session/list', error.message);
        }
        throw error;
      }
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
      const session = indexRecordToSummary(record);
      context.push?.(
        sessionIndexUpdatedPush({ op: 'pinned', sessionId: record.id, session }),
      );
      return ok(requestId, 'session/pin', {
        sessionId: record.id,
        isPinned: true,
        pinnedAt: record.pinnedAt,
        session,
      });
    }
    case 'session/unpin': {
      const record = await unpinSessionRecord(indexPath, command.sessionId);
      if (!record) {
        return fail(requestId, 'session/unpin', `Unknown session: ${command.sessionId}`);
      }
      const session = indexRecordToSummary(record);
      context.push?.(
        sessionIndexUpdatedPush({ op: 'unpinned', sessionId: record.id, session }),
      );
      return ok(requestId, 'session/unpin', {
        sessionId: record.id,
        isPinned: false,
        session,
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
      if (record.name) {
        context.push?.({
          type: 'session/name-updated',
          sessionId: record.id,
          name: record.name,
          nameSource: 'user',
        });
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
      const record = await context.archiveSession(command.sessionId);
      if (!record) {
        return fail(requestId, 'session/archive', `Unknown session: ${command.sessionId}`);
      }
      const session = indexRecordToSummary(record);
      context.push?.(
        sessionIndexUpdatedPush({ op: 'archived', sessionId: record.id, session }),
      );
      return ok(requestId, 'session/archive', {
        sessionId: record.id,
        isArchived: true,
        archivedAt: record.archivedAt,
        session,
      });
    }
    case 'session/lifecycle-plan': {
      const plan = await buildCurrentLifecyclePlan(rootDir, indexPath);
      return ok(requestId, 'session/lifecycle-plan', plan);
    }
    case 'session/lifecycle-apply': {
      const plan = await buildCurrentLifecyclePlan(rootDir, indexPath);
      if (plan.planId !== command.planId) {
        return fail(
          requestId,
          'session/lifecycle-apply',
          `Lifecycle plan is stale: expected ${plan.planId}, received ${command.planId}. Run plan again.`,
        );
      }
      const result: SessionLifecycleApplyResult = {
        planId: plan.planId,
        appliedAt: new Date().toISOString(),
        archived: [],
        skipped: [],
        failed: [],
      };
      for (const candidate of plan.candidates) {
        try {
          const archiveResult = await context.tryArchiveLifecycleCandidate({
            sessionId: candidate.sessionId,
            expectedUpdatedAt: candidate.updatedAt,
          });
          if (archiveResult.status === 'archived') {
            result.archived.push(candidate.sessionId);
          } else {
            result.skipped.push({ sessionId: candidate.sessionId, reason: archiveResult.status });
          }
        } catch (error) {
          result.failed.push({ sessionId: candidate.sessionId, error: formatError(error) });
        }
      }
      return ok(requestId, 'session/lifecycle-apply', result);
    }
    case 'session/unarchive': {
      const existing = await getSessionRecord(indexPath, command.sessionId);
      if (!existing) {
        return fail(requestId, 'session/unarchive', `Unknown session: ${command.sessionId}`);
      }
      const rejected = rejectUnavailableSessionBody(
        requestId,
        'session/unarchive',
        existing,
        'unarchive',
      );
      if (rejected) {
        return rejected;
      }
      const record = await unarchiveSessionRecord(indexPath, command.sessionId);
      if (!record) {
        return fail(requestId, 'session/unarchive', `Unknown session: ${command.sessionId}`);
      }
      const session = indexRecordToSummary(record);
      context.push?.(
        sessionIndexUpdatedPush({ op: 'unarchived', sessionId: record.id, session }),
      );
      return ok(requestId, 'session/unarchive', {
        sessionId: record.id,
        isArchived: false,
        session,
      });
    }
    case 'session/delete': {
      const existing = await getSessionRecord(indexPath, command.sessionId);
      if (!existing) {
        return fail(requestId, 'session/delete', `Unknown session: ${command.sessionId}`);
      }
      const rejectedDelete = rejectUnavailableSessionBody(
        requestId,
        'session/delete',
        existing,
        'delete',
      );
      if (rejectedDelete) {
        return rejectedDelete;
      }
      if (context.isSessionBodyReserved?.(command.sessionId) === true) {
        return sessionBusyResponse(requestId, 'session/delete', command.sessionId, 'body-job');
      }
      const liveRun = context.getForegroundRun?.(command.sessionId);
      if (liveRun !== undefined && command.force !== true) {
        return sessionBusyResponse(
          requestId,
          'session/delete',
          command.sessionId,
          'foreground-run',
        );
      }
      if (context.tryReserveSessionBody?.(command.sessionId) === false) {
        return sessionBusyResponse(requestId, 'session/delete', command.sessionId, 'body-job');
      }
      try {
      if (existing.isArchived !== true && command.force !== true) {
        return fail(
          requestId,
          'session/delete',
          'Session must be archived before permanent delete (or pass force: true)',
        );
      }
      if (liveRun !== undefined && command.force === true) {
        await context.abortLiveSession(command.sessionId);
      }
      const deletion = await context.deleteSession(command.sessionId);
      if (!deletion) {
        return fail(requestId, 'session/delete', `Unknown session: ${command.sessionId}`);
      }
      context.push?.(
        sessionIndexUpdatedPush({ op: 'deleted', sessionId: command.sessionId }),
      );
      return ok(requestId, 'session/delete', {
        sessionId: command.sessionId,
        deleted: true,
        ...(deletion.cleanupWarning ? { cleanupWarning: deletion.cleanupWarning } : {}),
      });
      } finally {
        context.releaseSessionBody?.(command.sessionId);
      }
    }
    case 'session/duplicate': {
      const source = await getSessionRecord(indexPath, command.sessionId);
      if (!source) {
        return fail(requestId, 'session/duplicate', `Unknown session: ${command.sessionId}`);
      }
      const rejectedDuplicate = rejectUnavailableSessionBody(
        requestId,
        'session/duplicate',
        source,
        'duplicate',
      );
      if (rejectedDuplicate) {
        return rejectedDuplicate;
      }
      const targetScope =
        command.targetScope ??
        source.scope ??
        (source.projectPath
          ? ({ kind: 'project', projectPath: source.projectPath } as const)
          : ({ kind: 'general' } as const));
      const targetProjectPath =
        targetScope.kind === 'project' ? targetScope.projectPath.trim() : '';
      if (targetScope.kind === 'project' && !targetProjectPath) {
        return fail(
          requestId,
          'session/duplicate',
          'target project scope requires a non-empty projectPath',
        );
      }
      if (command.targetScope?.kind === 'project') {
        const project = (await listProjects(getPiwinProjectsPath(rootDir))).find(
          (candidate) => candidate.path === targetProjectPath,
        );
        if (!project || project.trust !== 'trusted') {
          return fail(
            requestId,
            'session/duplicate',
            'target project must be opened and trusted before continuing the session',
          );
        }
      }
      const createInput: CreateSessionInput = {
        projectPath: targetProjectPath,
        scope:
          targetScope.kind === 'project'
            ? { kind: 'project', projectPath: targetProjectPath }
            : { kind: 'general' },
      };
      if (typeof command.name === 'string' && command.name.trim().length > 0) {
        createInput.sessionName = command.name.trim();
      }
      const created = await context.createSession(createInput);
      try {
        const sourceStore = await context.getTranscriptStore(command.sessionId);
        const targetStore = await context.getTranscriptStore(created.id, targetProjectPath);
        let messageCount = 0;
        let lastMessage: SessionTranscriptMessage | undefined;
        const messageIdMap = new Map<string, string>();
        for await (const message of sourceStore.iterateActivePath(100)) {
          const cloned = cloneTranscriptMessage(message);
          messageIdMap.set(message.id, cloned.id);
          await appendDerivedMessage(targetStore, cloned);
          await copyNativeEntries(sourceStore, targetStore, message.id, cloned.id);
          messageCount += 1;
          lastMessage = cloned;
        }
        await copyModelContextLedger({
          sourceDbPath: getPiwinSessionModelContextDatabasePath(rootDir, command.sessionId),
          sourceSessionId: command.sessionId,
          targetDbPath: getPiwinSessionModelContextDatabasePath(rootDir, created.id),
          targetSessionId: created.id,
          messageIdMap,
        });
        const displayName =
          typeof command.name === 'string' && command.name.trim().length > 0
            ? command.name.trim()
            : command.targetScope
              ? (source.name ?? `session-${source.id.slice(0, 8)}`)
              : buildDuplicateSessionName(source.name, source.id);
        await context.bindSession(created, targetProjectPath, displayName, {
          kind: 'main',
          depth: 0,
        });
        const record =
          (await getSessionRecord(indexPath, created.id)) ??
          createSessionRecord({
            id: created.id,
            projectPath: targetProjectPath,
            scope:
              targetScope.kind === 'project'
                ? { kind: 'project', projectPath: targetProjectPath }
                : { kind: 'general' },
            ...(targetScope.kind === 'project'
              ? { workingDirectory: targetProjectPath }
              : {}),
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
        const duplicated = indexRecordToSummary(record);
        context.push?.(
          sessionIndexUpdatedPush({
            op: 'created',
            sessionId: created.id,
            session: duplicated,
          }),
        );
        return ok(requestId, 'session/duplicate', {
          sessionId: created.id,
          sourceSessionId: command.sessionId,
          session: duplicated,
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
      const rejectedFork = rejectUnavailableSessionBody(requestId, 'session/fork', source, 'fork');
      if (rejectedFork) {
        return rejectedFork;
      }
      if (source.isArchived === true) {
        return fail(requestId, 'session/fork', 'Source session is archived');
      }
      const sourceStore = await context.getTranscriptStore(command.sessionId);
      const selected = await resolveForkAssistantMessage(sourceStore, command.messageId);
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
      const mediaRoot = getPiwinMediaDir(rootDir);
      const lineage = await getSessionLineage({ indexPath }, command.sessionId);
      const existingForkNames = lineage.nodes
        .map((node) => node.name)
        .filter((name): name is string => typeof name === 'string' && name.length > 0);

      try {
        const targetStore = await context.getTranscriptStore(created.id, source.projectPath);
        let messageCount = 0;
        let lastMessage: SessionTranscriptMessage | undefined;
        let reachedSelection = false;
        const messageIdMap = new Map<string, string>();
        const retainedRunIds = new Set<string>();
        let lastSourceUserMessageId: string | undefined;
        for await (const message of sourceStore.iterateActivePath(100)) {
          const cloned = cloneTranscriptMessage(message);
          messageIdMap.set(message.id, cloned.id);
          if (message.role === 'user') lastSourceUserMessageId = message.id;
          if (message.runId) retainedRunIds.add(message.runId);
          if (cloned.runId) retainedRunIds.add(cloned.runId);
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
          await copyNativeEntries(sourceStore, targetStore, message.id, cloned.id);
          messageCount += 1;
          lastMessage = cloned;
          if (message.id === selected.id) {
            reachedSelection = true;
            break;
          }
        }
        await copyModelContextLedger({
          sourceDbPath: getPiwinSessionModelContextDatabasePath(rootDir, command.sessionId),
          sourceSessionId: command.sessionId,
          targetDbPath: getPiwinSessionModelContextDatabasePath(rootDir, created.id),
          targetSessionId: created.id,
          messageIdMap,
          retain: {
            sourceMessageIds: new Set(messageIdMap.keys()),
            runIds: retainedRunIds,
          },
          ...(lastSourceUserMessageId === undefined
            ? {}
            : { boundarySourceMessageId: lastSourceUserMessageId }),
          boundaryCreatedAt: selected.createdAt,
        });
        if (!reachedSelection) {
          throw new Error(
            `Message not found while streaming source transcript: ${selected.id}`,
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
          sourceMessageId: selected.id,
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
        const forked = indexRecordToSummary(record);
        context.push?.(
          sessionIndexUpdatedPush({
            op: 'created',
            sessionId: created.id,
            session: forked,
          }),
        );
        return ok(requestId, 'session/fork', {
          sessionId: created.id,
          sourceSessionId: command.sessionId,
          session: forked,
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
    case 'session/model-context-summary': {
      const rootDir = getPiwinRoot(context.piwinRoot);
      const record = await getSessionRecord(
        getPiwinSessionIndexPath(rootDir),
        command.sessionId,
      );
      if (!record) {
        return fail(
          requestId,
          'session/model-context-summary',
          `Unknown session: ${command.sessionId}`,
        );
      }
      const store = await openModelContextStore({
        dbPath: getPiwinSessionModelContextDatabasePath(rootDir, command.sessionId),
        sessionId: command.sessionId,
      });
      try {
        const coverage = await store.getCoverage();
        const summaries = await store.listSummaries();
        return ok(requestId, 'session/model-context-summary', {
          sessionId: command.sessionId,
          coverage,
          summaries,
        });
      } finally {
        store.close();
      }
    }
    default:
      return null;
  }
}

async function buildCurrentLifecyclePlan(
  rootDir: string,
  indexPath: string,
): Promise<SessionLifecyclePlan> {
  const [config, document] = await Promise.all([
    loadPiwinConfig(rootDir),
    loadSessionIndex(indexPath),
  ]);
  return createSessionLifecyclePlan({
    records: document.sessions,
    policy: config.session?.lifecycle?.archive,
  });
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
    message.thinkingStartedAt !== undefined ||
    message.thinkingEndedAt !== undefined ||
    message.outcome !== undefined ||
    message.terminalMessage !== undefined ||
    message.subagentActivity !== undefined
      ? {
          metadata: {
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

async function resolveForkAssistantMessage(
  store: SessionTranscriptStore,
  messageId: string | undefined,
): Promise<SessionTranscriptMessage | undefined> {
  if (messageId !== undefined) {
    return store.getMessage(messageId);
  }
  const tail = await store.listTail(200);
  for (let index = tail.length - 1; index >= 0; index -= 1) {
    const message = tail[index];
    if (message?.role === 'assistant' && message.status === 'done') {
      return message;
    }
  }
  return undefined;
}

/**
 * Carry native context copies (spec: session-conversation-tree §4.2) onto the
 * derived row so fork/duplicate targets can cold-activate with full-fidelity
 * replay instead of text-only seeds.
 */
async function copyNativeEntries(
  sourceStore: SessionTranscriptStore,
  targetStore: SessionTranscriptStore,
  sourceMessageId: string,
  targetMessageId: string,
): Promise<void> {
  const entries = await sourceStore.readNativeEntries(sourceMessageId);
  if (entries.length === 0) return;
  await targetStore.appendNativeEntries(
    targetMessageId,
    entries.map((entry, index) => ({ ordinal: index, entry })),
  );
}
