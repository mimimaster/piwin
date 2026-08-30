import { createHash, randomUUID } from 'node:crypto';
/**
 * Live session IPC: create/spawn/prompt/compact/export and sub-agent lifecycle.
 * HostRuntime provides SessionLiveContext (maps + ensureLiveSession/bindSession/…).
 */
import { mkdir, open, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve as resolvePath } from 'node:path';
import type {
  AgentHost,
  CreateSessionInput,
  CreateSessionOptions,
  ExecutionRunRecord,
  RunTerminalCode,
  HostCommand,
  HostPush,
  HostResponse,
  ModelRef,
  ThinkingLevel,
  PiwinConfig,
  PromptInput,
  QueuedTurnRecord,
  RunInterventionRecord,
  SessionHandle,
  SessionCompactData,
  SessionCompactExportData,
  SessionCompactResult,
  SessionIndexRecord,
  SessionResumeData,
  SessionRunAcceptedData,
  SessionTranscriptPageData,
  SessionTranscriptMessage,
} from '@piwin/contracts';
import {
  SESSION_TRANSCRIPT_PAGE_DEFAULT_BYTES,
  SESSION_TRANSCRIPT_PAGE_DEFAULT_ITEMS,
  SESSION_TRANSCRIPT_WINDOW_DEFAULT_AFTER_ITEMS,
  SESSION_TRANSCRIPT_WINDOW_DEFAULT_BEFORE_ITEMS,
  formatError,
  isSessionBodyAvailable,
  DEFAULT_PERMISSION_PRESET,
  resolvePreset,
  mergeAgentModeIntoPrompt,
  resolveOrchestrationScheme,
  mergeOrchestrationSchemeIntoPrompt,
  OrchestrationSchemeError,
  isModelEnabled,
  isProviderEnabled,
  modelSupportsCapability,
  estimatePendingPromptTokens,
  readContextOccupiedTokens,
  resolveModelContextBudget,
  type ResolvedOrchestrationScheme,
  RUN_INTERVENTION_MAX_PENDING_BYTES_PER_RUN,
  RUN_INTERVENTION_MAX_PENDING_PER_RUN,
  RUN_INTERVENTION_MAX_TEXT_BYTES,
} from '@piwin/contracts';
import type { RunAbortReason } from '../run-abort-reason.js';
import {
  createPauseRequestedAbortReason,
  createSupersededByNewPromptAbortReason,
  createUserStopAbortReason,
  formatRunAbortReason,
} from '../run-abort-reason.js';
import {
  clearSessionPlan,
  createSessionRecord,
  createSubagentRunStore,
  streamTranscriptExport,
  getSessionRecord,
  listChildSessions,
  loadSessionPlan,
  mergeProductHistoryIntoPrompt,
  saveSessionPlan,
  exportCompactionMarkdown,
  buildCompactionSeedMessages,
  suggestSessionExportBasename,
  suggestCompactionExportBasename,
  upsertSessionRecord,
  readToolOutputSnapshot,
  openModelContextStore,
  readOrInsertUnknownContextState,
  type SessionTranscriptStore,
} from '@piwin/session';
import { formatSideChatContextBlock, mergeSideChatContextIntoPrompt } from '@piwin/session';
import { redactToolText } from '@piwin/agent-host';
import { extractFileOpsFromUnknown, formatFilesTouchedBlock } from '../compaction-file-ops.js';
import { formatPlanForModelContext } from '../format-plan-context.js';
import { createProductShellSession } from '../product-shell-session.js';
import { createModelPromptAssembly, type ModelPromptAssembly } from '../model-context-assembly.js';
import { persistAndPushAssembly } from '../model-context-record.js';
import { resolvePromptContextRefs } from '../prompt/resolve-prompt-context-refs.js';
import { fail, ok } from '../response-helpers.js';
import { sessionBusyResponse } from '../session-body-gate.js';
import { sessionIndexUpdatedPush } from '../session-index-push.js';
import { rejectUnavailableSessionBody } from '../session-body-guard.js';
import { indexRecordToSummary } from '../session-summary-map.js';
import {
  getPiwinProjectsPath,
  getPiwinRoot,
  getPiwinSessionDir,
  getPiwinSessionIndexPath,
  getPiwinSessionModelContextDatabasePath,
  getPiwinSessionPlanPath,
} from '../paths.js';
import { isRegisteredProjectRoot, loadProjectStore } from '@piwin/project';
import type { TranscriptRecorder } from '../transcript-recorder.js';
import { SessionRuntimeController } from '../sessions/session-runtime-controller.js';
import { createSessionMessageResponse } from '../session-message-response.js';
import {
  indexProjectPathForScope,
  resolveSessionLocation,
  stripBoundProjectId,
  scopeFromIndexRecord,
  workingDirectoryFromIndexRecord,
} from '../session-scope.js';
import { repairLegacySessionNames } from '../session-name-repair.js';
import { settleOrphanStreamingMessages } from '../transcript-stream-settler.js';
import { findEnabledModel } from '../provider-helpers.js';
import type { SessionLiveContext } from './session-live-context.js';
import { handleCompactionCommand } from './compaction-live.js';
import {
  createResolveRefsDeps,
  persistSessionComposerProfile,
} from './prompt-preparation.js';
import { resolveSessionOutputPath } from './compaction-live.js';
import { handleRunControlCommand } from './run-control-commands.js';
import { handleRunInterventionCommand } from './run-intervention-commands.js';
import {
  handleSessionBranchCommand,
  pushBranchUpdated,
} from './session-branch-commands.js';
import { handleSessionPromptCommand } from './session-prompt-command.js';

export type { SessionLiveContext } from './session-live-context.js';

const TYPES = new Set<HostCommand['type']>([
  'session/create',
  'session/list-children',
  'session/branch-list',
  'session/branch-switch',
  'session/truncate-from',
  'session/resume',
  'session/outline-page',
  'session/user-message-index',
  'session/transcript-page',
  'session/transcript-window',
  'session/messages',
  'session/foreground-run',
  'session/prompt',
  'session/pause',
  'session/resume-run',
  'session/abort',
  'session/steer',
  'run/intervention-submit',
  'run/intervention-edit',
  'run/intervention-cancel',
  'session/follow_up',
  'session/compact',
  'session/compact-export',
  'session/compact-abort',
  'session/compaction-settings',
  'session/set-auto-compaction',
  'session/export',
  'session/tool-output',
  'session/message-child',
  'session/runtime-status',
  'session/reload-runtime',
]);

export function isSessionLiveCommand(command: HostCommand): boolean {
  return TYPES.has(command.type);
}

/**
 * One compaction implementation shared by the slash command and compact
 * export. The export flow uses the same Pi compact operation, but suppresses
 * live-session bookkeeping when it runs on an ephemeral snapshot.
 */

export async function handleSessionLiveCommand(
  command: HostCommand,
  requestId: string | undefined,
  context: SessionLiveContext,
): Promise<HostResponse | null> {
  if (!TYPES.has(command.type)) {
    return null;
  }  const delegated =
    (await handleRunInterventionCommand(command, requestId, context)) ??
    (await handleCompactionCommand(command, requestId, context)) ??
    (await handleRunControlCommand(command, requestId, context)) ??
    (await handleSessionBranchCommand(command, requestId, context)) ??
    (await handleSessionPromptCommand(command, requestId, context));
  if (delegated !== null) return delegated;
  switch (command.type) {
    case 'session/create': {
      let createInput = command.input;
      try {
        const location = await resolveSessionLocation(command.input, context.piwinRoot);
        createInput = {
          ...stripBoundProjectId(command.input),
          scope: location.scope,
          // Index field: empty for general. Adapters re-resolve workingDirectory.
          projectPath: indexProjectPathForScope(location.scope),
        };
      } catch (error) {
        const message = formatError(error);
        return fail(requestId, 'session/create', message);
      }
      const session = await context.createSession(createInput);
      const lineage: {
        parentSessionId?: string;
        kind?: 'main' | 'subagent';
        depth?: number;
        subagentStatus?: 'running' | 'done' | 'failed' | 'cancelled';
        task?: string;
        presentation?: CreateSessionInput['presentation'];
      } = {
        kind: command.input.parentSessionId ? 'subagent' : 'main',
        depth: command.input.parentSessionId ? 1 : 0,
      };
      if (command.input.parentSessionId) {
        lineage.parentSessionId = command.input.parentSessionId;
        lineage.subagentStatus = 'running';
      }
      if (command.input.task) {
        lineage.task = command.input.task;
      }
      if (command.input.presentation) {
        lineage.presentation = command.input.presentation;
      }
      try {
        await context.bindSession(
          session,
          createInput.projectPath,
          command.input.sessionName,
          lineage,
        );
      } catch (error) {
        await context.disposeLiveSession(session.id).catch(() => undefined);
        throw error;
      }
      // Seed the session composer profile at create time so a new session
      // remembers the model even before the first prompt is sent.
      if (command.input.model || command.input.thinkingLevel !== undefined) {
        if (command.input.model) {
          context.sessionModels.set(session.id, command.input.model);
        }
        await persistSessionComposerProfile(context, session.id, {
          ...(command.input.model ? { model: command.input.model } : {}),
          ...(command.input.thinkingLevel !== undefined
            ? { thinkingLevel: command.input.thinkingLevel }
            : {}),
        });
      }
      context.pushStatus();
      try {
        const createdRecord = await getSessionRecord(
          getPiwinSessionIndexPath(getPiwinRoot(context.piwinRoot)),
          session.id,
        );
        context.push(
          sessionIndexUpdatedPush({
            op: 'created',
            sessionId: session.id,
            ...(createdRecord === undefined
              ? {}
              : { session: indexRecordToSummary(createdRecord) }),
          }),
        );
      } catch {
        // Index write is best-effort; create still succeeded.
      }
      return ok(requestId, 'session/create', {
        sessionId: session.id,
      });
    }
    case 'session/list-children': {
      const rootDir = getPiwinRoot(context.piwinRoot);
      const children = await listChildSessions(
        getPiwinSessionIndexPath(rootDir),
        command.parentSessionId,
      );
      const invocations = await createSubagentRunStore({
        runsDir: join(rootDir, 'subagent-runs'),
      }).listInvocations(command.parentSessionId);
      return ok(requestId, 'session/list-children', {
        parentSessionId: command.parentSessionId,
        sessions: children.map(indexRecordToSummary),
        invocations,
      });
    }
    case 'session/truncate-from': {
      const rootDir = getPiwinRoot(context.piwinRoot);
      const indexPath = getPiwinSessionIndexPath(rootDir);
      const record = await getSessionRecord(indexPath, command.sessionId);
      if (!record) {
        return fail(requestId, 'session/truncate-from', `Unknown session: ${command.sessionId}`);
      }
      const rejectedTruncate = rejectUnavailableSessionBody(
        requestId,
        'session/truncate-from',
        record,
        'truncate',
      );
      if (rejectedTruncate) {
        return rejectedTruncate;
      }
      if (context.getForegroundRun(command.sessionId)) {
        return sessionBusyResponse(
          requestId,
          'session/truncate-from',
          command.sessionId,
          'foreground-run',
        );
      }
      if (!context.tryReserveSessionBody(command.sessionId)) {
        return sessionBusyResponse(
          requestId,
          'session/truncate-from',
          command.sessionId,
          'body-job',
        );
      }
      try {
      const store = await context.getTranscriptStore(command.sessionId);
      const truncationAnchor = await store.getMessage(command.messageId);
      if (truncationAnchor === undefined) {
        return fail(
          requestId,
          'session/truncate-from',
          `Message not found in transcript: ${command.messageId}`,
        );
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
      await context.disposeLiveSession(command.sessionId, 'manual');
      const truncated = await store.truncateFrom(command.messageId);
      if (!truncated.found) {
        throw new Error(`Transcript changed before truncate: ${command.messageId}`);
      }
      if (anchorOnActivePath) {
        const modelContextStore = await openModelContextStore({
          dbPath: getPiwinSessionModelContextDatabasePath(rootDir, command.sessionId),
          sessionId: command.sessionId,
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
      await pushBranchUpdated(context, command.sessionId, store);
      // Leaf write and occupancy invalidate are consecutive store ops, not one
      // SQLite transaction (`truncateFrom` does not accept context CAS).
      await context.sessionContextCoordinator?.invalidate(command.sessionId, {
        reason: 'truncate',
        empty: truncated.remainingCount === 0,
        contextBoundary: { activeLeafMessageId: await store.getActiveLeaf() },
      });
      return ok(requestId, 'session/truncate-from', {
        sessionId: command.sessionId,
        removedCount: truncated.removedCount,
        remainingCount: truncated.remainingCount,
        ...createSessionMessageResponse(command.sessionId, remaining, command.messageProjection),
        session: indexRecordToSummary(record),
      });
      } finally {
        context.releaseSessionBody(command.sessionId);
      }
    }
    case 'session/resume': {
      const rootDir = getPiwinRoot(context.piwinRoot);
      const indexPath = getPiwinSessionIndexPath(rootDir);
      let existing = await getSessionRecord(indexPath, command.sessionId);
      if (!existing) {
        return fail(requestId, 'session/resume', `Unknown session: ${command.sessionId}`, {
          code: 'session-not-found',
        });
      }
      const rejectedResume = rejectUnavailableSessionBody(
        requestId,
        'session/resume',
        existing,
        'resume',
      );
      if (rejectedResume) {
        return rejectedResume;
      }
      const store = await context.getTranscriptStore(command.sessionId);
      if (context.getForegroundRun(command.sessionId) === undefined) {
        await settleOrphanStreamingMessages(store);
        const reconciled = await store.finalizeOpenRunInterventions(
          'run-ended',
          new Date().toISOString(),
        );
        for (const intervention of reconciled) {
          context.push({ type: 'run/intervention-updated', intervention });
        }
      }
      const transcriptPage = await store.transcriptPage({
        sessionId: command.sessionId,
        limit: SESSION_TRANSCRIPT_PAGE_DEFAULT_ITEMS,
        maximumBytes: SESSION_TRANSCRIPT_PAGE_DEFAULT_BYTES,
      });
      if (transcriptPage.status !== 'page') {
        throw new Error('Cursorless transcript tail unexpectedly returned stale');
      }
      const firstUserMessage = await store.firstMessageByRole('user');
      const [repairedExisting] = await repairLegacySessionNames({
        indexPath,
        records: [existing],
        loadTranscriptMessages: async () =>
          firstUserMessage === undefined ? [] : [firstUserMessage],
        onRepaired: (record) => {
          if (record.name) {
            context.push({
              type: 'session/name-updated',
              sessionId: record.id,
              name: record.name,
              nameSource: 'text',
            });
          }
        },
        onWarning: (message) => {
          context.push({ type: 'host/log', level: 'warn', message });
        },
      });
      existing = repairedExisting ?? existing;
      // Durable read (ADR 0040 §1): selecting a chat must not allocate a Pi
      // session or worker. Only a bounded newest page is returned; older
      // history stays Host-owned and is paged on demand.
      // Residency is actual bound-handle state, not product-session existence.
      const live = context.sessions.has(command.sessionId);
      // Restore the last composer model into the in-memory map so subsequent
      // host features (walkthrough, naming, transcript snapshot) see it even
      // before the next prompt. Prefer index, then last assistant message.
      const restoredModel = existing.model ?? (await store.recentModel()) ?? undefined;
      if (restoredModel) {
        context.sessionModels.set(command.sessionId, restoredModel);
      }
      const contextSnapshot = context.sessionContextCoordinator
        ? await context.sessionContextCoordinator.getSnapshot(command.sessionId)
        : await readOrInsertUnknownContextState(store, {
            sessionId: command.sessionId,
            reason: 'never-sampled',
            updatedAt: new Date().toISOString(),
          });
      const lastRequestUsage = await store.readLatestAssistantUsageForActivePath();
      const restoredUsage =
        context.sessionContextCoordinator?.projectLegacyUsage(contextSnapshot) ??
        (await context.loadSessionUsage(command.sessionId));
      const data: SessionResumeData = {
        sessionId: command.sessionId,
        live,
        messages: transcriptPage.messages,
        transcriptPage: transcriptPage.page,
        projectPath: existing.projectPath,
        // ADR 0040 §9: bounded recent window, never the complete outline.
        outline: (await store.outlinePage({ sessionId: command.sessionId, limit: 40 })).nodes,
        contextSnapshot,
        lastRequestUsage,
      };
      const pauseCheckpoint = await store.getActivePauseCheckpoint();
      if (pauseCheckpoint !== undefined) {
        data.pauseCheckpoint = pauseCheckpoint;
      }
      const resumeScope = scopeFromIndexRecord(existing);
      data.scope = resumeScope;
      const resumeWorkingDirectory = workingDirectoryFromIndexRecord(existing);
      if (resumeWorkingDirectory) {
        data.workingDirectory = resumeWorkingDirectory;
      }
      if (existing.name) {
        data.name = existing.name;
      }
      if (restoredModel) {
        data.model = restoredModel;
      }
      if (existing.thinkingLevel) {
        data.thinkingLevel = existing.thinkingLevel;
      }
      if (restoredUsage) {
        data.contextUsage = restoredUsage;
      }
      return ok(requestId, 'session/resume', data);
    }
    case 'session/outline-page': {
      const rootDir = getPiwinRoot(context.piwinRoot);
      const existing = await getSessionRecord(
        getPiwinSessionIndexPath(rootDir),
        command.query.sessionId,
      );
      if (!existing) {
        return fail(
          requestId,
          'session/outline-page',
          `Unknown session: ${command.query.sessionId}`,
        );
      }
      const rejectedOutline = rejectUnavailableSessionBody(
        requestId,
        'session/outline-page',
        existing,
        'transcript',
      );
      if (rejectedOutline) {
        return rejectedOutline;
      }
      try {
        const page = await (
          await context.getTranscriptStore(command.query.sessionId)
        ).outlinePage(command.query);
        return ok(requestId, 'session/outline-page', page);
      } catch (error) {
        if (error instanceof RangeError) {
          return fail(requestId, 'session/outline-page', error.message);
        }
        throw error;
      }
    }
    case 'session/user-message-index': {
      const rootDir = getPiwinRoot(context.piwinRoot);
      const existing = await getSessionRecord(
        getPiwinSessionIndexPath(rootDir),
        command.query.sessionId,
      );
      if (!existing) {
        return fail(
          requestId,
          'session/user-message-index',
          `Unknown session: ${command.query.sessionId}`,
        );
      }
      const rejectedUserIndex = rejectUnavailableSessionBody(
        requestId,
        'session/user-message-index',
        existing,
        'transcript',
      );
      if (rejectedUserIndex) {
        return rejectedUserIndex;
      }
      try {
        const index = await (
          await context.getTranscriptStore(command.query.sessionId)
        ).userMessageIndex(command.query);
        return ok(requestId, 'session/user-message-index', index);
      } catch (error) {
        if (error instanceof RangeError) {
          return fail(requestId, 'session/user-message-index', error.message);
        }
        throw error;
      }
    }
    case 'session/transcript-page': {
      const rootDir = getPiwinRoot(context.piwinRoot);
      const existing = await getSessionRecord(
        getPiwinSessionIndexPath(rootDir),
        command.query.sessionId,
      );
      if (!existing) {
        return fail(
          requestId,
          'session/transcript-page',
          `Unknown session: ${command.query.sessionId}`,
        );
      }
      const rejectedPage = rejectUnavailableSessionBody(
        requestId,
        'session/transcript-page',
        existing,
        'transcript',
      );
      if (rejectedPage) {
        return rejectedPage;
      }
      try {
        const page = await (
          await context.getTranscriptStore(command.query.sessionId)
        ).transcriptPage(command.query);
        return ok(requestId, 'session/transcript-page', page);
      } catch (error) {
        if (error instanceof RangeError) {
          return fail(requestId, 'session/transcript-page', error.message);
        }
        throw error;
      }
    }
    case 'session/transcript-window': {
      const rootDir = getPiwinRoot(context.piwinRoot);
      const existing = await getSessionRecord(
        getPiwinSessionIndexPath(rootDir),
        command.query.sessionId,
      );
      if (!existing) {
        return fail(
          requestId,
          'session/transcript-window',
          `Unknown session: ${command.query.sessionId}`,
        );
      }
      const rejectedWindow = rejectUnavailableSessionBody(
        requestId,
        'session/transcript-window',
        existing,
        'transcript',
      );
      if (rejectedWindow) {
        return rejectedWindow;
      }
      try {
        const window = await (
          await context.getTranscriptStore(command.query.sessionId)
        ).transcriptWindow({
          ...command.query,
          beforeItems: command.query.beforeItems ?? SESSION_TRANSCRIPT_WINDOW_DEFAULT_BEFORE_ITEMS,
          afterItems: command.query.afterItems ?? SESSION_TRANSCRIPT_WINDOW_DEFAULT_AFTER_ITEMS,
        });
        return ok(requestId, 'session/transcript-window', window);
      } catch (error) {
        if (error instanceof RangeError) {
          return fail(requestId, 'session/transcript-window', error.message);
        }
        throw error;
      }
    }
    case 'session/runtime-status': {
      // ADR 0040: cold sessions have no live handle but still need truthful
      // residency diagnostics (Cold + lastEvictionReason). Accept any durable
      // product session id; do not require a resident runtime.
      const rootDir = getPiwinRoot(context.piwinRoot);
      const record = await getSessionRecord(getPiwinSessionIndexPath(rootDir), command.sessionId);
      if (!record && !context.sessions.has(command.sessionId)) {
        return fail(requestId, 'session/runtime-status', `Unknown session: ${command.sessionId}`);
      }
      const status = context.runtimeController.getStatus(command.sessionId);
      if (!record || isSessionBodyAvailable(record)) {
        const pauseCheckpoint = await context.getActivePauseCheckpoint(command.sessionId);
        if (pauseCheckpoint !== undefined) {
          status.pauseCheckpoint = pauseCheckpoint;
        }
      }
      return ok(requestId, 'session/runtime-status', { status });
    }
    case 'session/reload-runtime': {
      context.requireSession(command.sessionId);
      try {
        const result = await context.reloadRuntime({
          sessionId: command.sessionId,
          expectedSettingsRevision: command.expectedSettingsRevision,
          when: command.when,
        });
        return ok(requestId, 'session/reload-runtime', {
          sessionId: command.sessionId,
          generationId: result.generationId,
          settingsRevision: result.settingsRevision,
          state: 'active' as const,
        });
      } catch (error) {
        const message = formatError(error);
        return fail(requestId, 'session/reload-runtime', message);
      }
    }
    case 'session/messages': {
      const messagesRecord = await getSessionRecord(
        getPiwinSessionIndexPath(getPiwinRoot(context.piwinRoot)),
        command.sessionId,
      );
      if (messagesRecord) {
        const rejectedMessages = rejectUnavailableSessionBody(
          requestId,
          'session/messages',
          messagesRecord,
          'transcript',
        );
        if (rejectedMessages) {
          return rejectedMessages;
        }
      }
      const page = await (
        await context.getTranscriptStore(command.sessionId)
      ).transcriptPage({
        sessionId: command.sessionId,
        limit: SESSION_TRANSCRIPT_PAGE_DEFAULT_ITEMS,
        maximumBytes: SESSION_TRANSCRIPT_PAGE_DEFAULT_BYTES,
      });
      if (page.status !== 'page') {
        throw new Error('Cursorless transcript tail unexpectedly returned stale');
      }
      return ok(requestId, 'session/messages', {
        sessionId: command.sessionId,
        messages: page.messages,
      });
    }
    case 'session/foreground-run': {
      // ADR 0038 reconciliation query: clients that suspect a lost terminal
      // push ask the registry directly. Works for any durable session, live
      // or not — no active runtime simply means no foreground run.

      if (!context.sessions.has(command.sessionId)) {
        const rootDir = getPiwinRoot(context.piwinRoot);
        const record = await getSessionRecord(
          getPiwinSessionIndexPath(rootDir),
          command.sessionId,
        );
        if (!record) {
          return fail(requestId, 'session/foreground-run', `Unknown session: ${command.sessionId}`);
        }
      }
      const run = context.getForegroundRun(command.sessionId);
      return ok(requestId, 'session/foreground-run', {
        sessionId: command.sessionId,
        run: run === undefined ? null : { ...run },
      });
    }
    case 'session/export': {
      const rootDir = getPiwinRoot(context.piwinRoot);
      const indexPath = getPiwinSessionIndexPath(rootDir);
      const record = await getSessionRecord(indexPath, command.sessionId);
      if (!record) {
        return fail(requestId, 'session/export', `Unknown session: ${command.sessionId}`);
      }
      const rejectedExport = rejectUnavailableSessionBody(
        requestId,
        'session/export',
        record,
        'export',
      );
      if (rejectedExport) {
        return rejectedExport;
      }
      const format: 'html' | 'md' = command.format === 'html' ? 'html' : 'md';
      const redactTools = command.redactTools === true;
      const store = await context.getTranscriptStore(command.sessionId);
      const exportOptions = {
        format,
        redactTools,
        sessionId: command.sessionId,
        projectPath: record.projectPath,
        ...(record.name ? { title: record.name } : {}),
        exportedAt: new Date().toISOString(),
      };
      const outputPath = resolveSessionOutputPath(
        rootDir,
        command.sessionId,
        command.outputPath,
        suggestSessionExportBasename(command.sessionId, format),
      );
      await mkdir(dirname(outputPath), { recursive: true });
      const output = await open(outputPath, 'w');
      let byteLength = 0;
      try {
        for await (const chunk of streamTranscriptExport(store.iterateActivePath(100), exportOptions)) {
          await output.write(chunk, undefined, 'utf8');
          byteLength += Buffer.byteLength(chunk, 'utf8');
        }
      } finally {
        await output.close();
      }
      return ok(requestId, 'session/export', {
        sessionId: command.sessionId,
        format,
        redactTools,
        path: outputPath,
        byteLength,
      });
    }

    case 'session/tool-output': {
      const store = await context.getTranscriptStore(command.sessionId);
      const message = await store.getMessage(command.messageId);
      if (!message) {
        return ok(requestId, 'session/tool-output', {
          status: 'unavailable' as const,
          reason: 'not-found' as const,
        });
      }
      const snapshot = readToolOutputSnapshot({
        message,
        toolCallId: command.toolCallId,
        ...(typeof command.maxBytes === 'number' ? { maxBytes: command.maxBytes } : {}),
      });
      if (snapshot.status === 'unavailable') {
        return ok(requestId, 'session/tool-output', snapshot);
      }
      // Redact secrets again at read time (transcript may predate stricter
      // patterns); re-bound so the response is always bounded.
      const redacted = redactToolText(snapshot.output);
      const redactionMarked = redacted.redacted || snapshot.redacted;
      return ok(requestId, 'session/tool-output', {
        ...snapshot,
        output: redacted.text,
        redacted: redactionMarked,
      });
    }

    case 'session/message-child': {
      const rootDir = getPiwinRoot(context.piwinRoot);
      const indexPath = getPiwinSessionIndexPath(rootDir);
      const child = await getSessionRecord(indexPath, command.childSessionId);
      if (!child || child.parentSessionId !== command.parentSessionId) {
        return fail(requestId, 'session/message-child', 'Invalid parent/child relationship');
      }
      const text = command.text.trim();
      if (!text) {
        return fail(requestId, 'session/message-child', 'text is required');
      }
      const live = await context.ensureLiveSession(command.childSessionId);
      await context.recordUserPrompt(command.childSessionId, { text });
      await live.prompt({ text });
      return ok(requestId, 'session/message-child', {
        childSessionId: command.childSessionId,
      });
    }
    default:
      return null;
  }
}
