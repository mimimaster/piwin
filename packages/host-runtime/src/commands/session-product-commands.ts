/**
 * Product-layer session index commands (list/pin/rename/archive/delete/duplicate/search).
 * Keep live prompt/spawn/compaction in HostRuntime — this module owns index lifecycle only.
 */

import { formatError } from '@piwin/contracts';
import { rejectUnavailableSessionBody } from '../session-body-guard.js';
import type { HostCommand, HostResponse, SessionIndexRecord, SessionDeleteResult, SessionLifecycleApplyResult, SessionLifecyclePlan } from '@piwin/contracts';
import { createSessionLifecyclePlan, deriveDefaultNameFromMessage, getSessionRecord, isPrimarySessionRecord, listSessionsForProject, loadSessionIndex, createSessionIndexPage, SessionIndexCursorError, pinSessionRecord, projectSessionIndex, renameSessionRecord, searchSessions, setSessionAutoName, unarchiveSessionRecord, unpinSessionRecord, openModelContextStore, readOrInsertUnknownContextState } from '@piwin/session';
import { getSessionLineage, listAllSessionRecords } from '@piwin/session';

import { fail, ok } from '../response-helpers.js';
import { sessionBusyResponse } from '../session-body-gate.js';
import { sessionIndexUpdatedPush } from '../session-index-push.js';
import { indexRecordToSummary } from '../session-summary-map.js';

import { getPiwinRoot, getPiwinSessionModelContextDatabasePath, getPiwinSessionIndexPath } from '../paths.js';
import { loadPiwinConfig } from '../config-store.js';
import { resolveListFilter, resolveScopeRefToListIntent } from '../session-scope.js';
import { repairLegacySessionNames } from '../session-name-repair.js';

import type { SessionProductCommandContext } from './session-product-command-context.js';
import { handleSessionDuplicate, handleSessionFork, type SessionDeriveDeps } from './session-derive-commands.js';

export type { SessionProductCommandContext } from './session-product-command-context.js';

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
  'session/context-get',
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

  const derive: SessionDeriveDeps = { context, rootDir, indexPath };

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
      context.push?.(sessionIndexUpdatedPush({ op: 'pinned', sessionId: record.id, session }));
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
      context.push?.(sessionIndexUpdatedPush({ op: 'unpinned', sessionId: record.id, session }));
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
      context.push?.(sessionIndexUpdatedPush({ op: 'archived', sessionId: record.id, session }));
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
      context.push?.(sessionIndexUpdatedPush({ op: 'unarchived', sessionId: record.id, session }));
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
        context.push?.(sessionIndexUpdatedPush({ op: 'deleted', sessionId: command.sessionId }));
        const result: SessionDeleteResult = {
          sessionId: command.sessionId,
          deleted: true,
          ...(deletion.cleanupWarning ? { cleanupWarning: deletion.cleanupWarning } : {}),
          ...(deletion.turnChangeRecordsKept ? { turnChangeRecordsKept: deletion.turnChangeRecordsKept } : {}),
        };
        return ok(requestId, 'session/delete', result);
      } finally {
        context.releaseSessionBody?.(command.sessionId);
      }
    }
    case 'session/duplicate':
      return handleSessionDuplicate(command, requestId, derive);
    case 'session/fork':
      return handleSessionFork(command, requestId, derive);
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
      const record = await getSessionRecord(getPiwinSessionIndexPath(rootDir), command.sessionId);
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
    case 'session/context-get': {
      const record = await getSessionRecord(indexPath, command.sessionId);
      if (!record) {
        return fail(requestId, 'session/context-get', `Unknown session: ${command.sessionId}`);
      }
      const rejectedContext = rejectUnavailableSessionBody(
        requestId,
        'session/context-get',
        record,
        'context',
      );
      if (rejectedContext) {
        return rejectedContext;
      }
      const snapshot = context.getContextSnapshot
        ? await context.getContextSnapshot(command.sessionId)
        : await context.withTranscriptStore(command.sessionId, (store) =>
            readOrInsertUnknownContextState(store, {
              sessionId: command.sessionId,
              reason: 'never-sampled',
              updatedAt: new Date().toISOString(),
            }),
          );
      return ok(requestId, 'session/context-get', snapshot);
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
