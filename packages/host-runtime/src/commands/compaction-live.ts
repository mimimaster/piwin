/**
 * Split from session-live-commands.ts — pure relocation, no behavior change.
 */

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
  SessionPauseAcceptedData,
  SessionPauseCheckpoint,
  SessionPauseCheckpointInput,
  SessionResumeRunAcceptedData,
  SessionTranscriptPageData,
  SessionTranscriptMessage,
} from '@piwin/contracts';
import {
  SESSION_TRANSCRIPT_PAGE_DEFAULT_BYTES,
  SESSION_TRANSCRIPT_PAGE_DEFAULT_ITEMS,
  SESSION_TRANSCRIPT_WINDOW_DEFAULT_AFTER_ITEMS,
  SESSION_TRANSCRIPT_WINDOW_DEFAULT_BEFORE_ITEMS,
  formatError,
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
  scopeFromIndexRecord,
  workingDirectoryFromIndexRecord,
} from '../session-scope.js';
import { repairLegacySessionNames } from '../session-name-repair.js';
import { findEnabledModel } from '../provider-helpers.js';
import type { SessionLiveContext } from './session-live-context.js';

async function compactLiveSession(
  context: SessionLiveContext,
  sessionId: string,
  customInstructions?: string,
): Promise<SessionCompactResult> {
  const session = context.requireSession(sessionId);
  return compactSessionHandle(context, sessionId, session, customInstructions, true);
}

type TargetCompactionResult = SessionCompactResult & {
  compacted: boolean;
  targetInputBudget: number;
};

export async function compactLiveSessionForTarget(
  context: SessionLiveContext,
  sessionId: string,
  targetModel: ModelRef,
  pendingPromptTokens = 0,
  customInstructions?: string,
): Promise<TargetCompactionResult> {
  const config = await context.loadConfig();
  const configuredTarget = findEnabledModel(config, targetModel.providerId, targetModel.modelId);
  if (!configuredTarget || !modelSupportsCapability(configuredTarget, 'chat')) {
    throw new Error(
      `model-unavailable: ${targetModel.providerId}/${targetModel.modelId} is not an enabled chat model`,
    );
  }

  const targetBudget = resolveModelContextBudget({
    ...(configuredTarget.contextWindow !== undefined
      ? { contextWindow: configuredTarget.contextWindow }
      : {}),
    ...(configuredTarget.maxOutputTokens !== undefined
      ? { maxOutputTokens: configuredTarget.maxOutputTokens }
      : {}),
  });
  const usage = await context.loadSessionUsage(sessionId);
  const occupiedTokens = readContextOccupiedTokens(usage);
  const requiredTokens =
    occupiedTokens === undefined ? undefined : occupiedTokens + Math.max(0, pendingPromptTokens);
  const sourceModel = context.sessionModels.get(sessionId);
  const alreadyUsingTarget =
    sourceModel?.providerId === targetModel.providerId &&
    sourceModel.modelId === targetModel.modelId &&
    sourceModel.protocol === targetModel.protocol;

  // Cold sessions reconstruct a bounded product-history window on activation;
  // there is no native source-model context to mutate before the switch.
  if (
    alreadyUsingTarget ||
    !context.sessions.has(sessionId) ||
    requiredTokens === undefined ||
    requiredTokens <= targetBudget.inputBudget
  ) {
    return {
      ok: true,
      compacted: false,
      targetInputBudget: targetBudget.inputBudget,
      message: alreadyUsingTarget
        ? 'Session is already using the target model'
        : requiredTokens === undefined
          ? 'Target context could not be measured; final provider limits still apply'
          : 'Current context fits the target model budget',
    };
  }

  const targetInstructions = [
    customInstructions?.trim(),
    `Prepare this session for migration to ${targetModel.providerId}/${targetModel.modelId}.`,
    `The resulting model context must not exceed ${targetBudget.inputBudget} tokens, including retained recent turns.`,
    'Preserve goals, constraints, decisions, plan status, files changed, test results, unresolved errors, and pending user intent.',
  ]
    .filter((value): value is string => Boolean(value))
    .join('\n');
  const result = await compactLiveSession(context, sessionId, targetInstructions);
  if (!result.ok) {
    throw new Error(result.message ?? 'Target-model compaction failed');
  }

  const postCompactTokens = result.tokensAfter;
  if (postCompactTokens === undefined) {
    throw new Error(
      `context-limit-unverified: compaction did not report post-compact tokens for target budget ${targetBudget.inputBudget}`,
    );
  }
  if (postCompactTokens + Math.max(0, pendingPromptTokens) > targetBudget.inputBudget) {
    throw new Error(
      `context-limit-exceeded: compacted context ${postCompactTokens + Math.max(0, pendingPromptTokens)} exceeds target input budget ${targetBudget.inputBudget}`,
    );
  }

  return {
    ...result,
    compacted: true,
    targetInputBudget: targetBudget.inputBudget,
  };
}

async function compactSessionHandle(
  context: SessionLiveContext,
  sessionId: string,
  session: SessionHandle,
  customInstructions: string | undefined,
  emitSessionFacts: boolean,
): Promise<SessionCompactResult> {
  const compact = session.compact;
  if (!compact) {
    throw new Error('compaction is not supported on this session (RPC or inactive product shell)');
  }

  const startedAt = Date.now();
  // ADR 0040 §5: compaction is a backend operation outside RunRegistry, so it
  // takes an explicit residency protection lease — a compacting runtime is
  // never evicted.
  const protectedRuntime = context.protectRuntime(sessionId);
  try {
    const result = customInstructions ? await compact(customInstructions) : await compact();
    const durationMs =
      typeof result.durationMs === 'number' ? result.durationMs : Date.now() - startedAt;
    const fileOps =
      result.fileOps ??
      extractFileOpsFromUnknown(result) ??
      extractFileOpsFromUnknown({ summary: result.summary });
    const enrichedResult: SessionCompactResult = {
      ...result,
      durationMs,
      ...(fileOps ? { fileOps } : {}),
    };

    if (emitSessionFacts && fileOps) {
      const block = formatFilesTouchedBlock(fileOps);
      context.sessionFilesTouched.set(sessionId, block);
      context.push({
        type: 'event',
        sessionId,
        event: {
          type: 'compaction/end',
          ok: enrichedResult.ok,
          ...(enrichedResult.message ? { message: enrichedResult.message } : {}),
          ...(enrichedResult.summary ? { summary: enrichedResult.summary } : {}),
          ...(typeof enrichedResult.tokensBefore === 'number'
            ? { tokensBefore: enrichedResult.tokensBefore }
            : {}),
          ...(typeof enrichedResult.tokensAfter === 'number'
            ? { tokensAfter: enrichedResult.tokensAfter }
            : {}),
          durationMs,
          fileOps,
        },
      });
    }

    return enrichedResult;
  } finally {
    if (protectedRuntime) {
      context.releaseRuntimeProtection(sessionId);
    }
  }
}

/**
 * Compact a disposable copy of the product transcript. `duplicate`'s public
 * command persists a new session, so this flow reuses its pure clone
 * primitive and only passes the clone into Pi's in-memory session manager.
 */
async function compactTranscriptSnapshot(
  context: SessionLiveContext,
  record: SessionIndexRecord,
  customInstructions?: string,
): Promise<SessionCompactResult> {
  if (context.compactExportOperations.has(record.id)) {
    return { ok: false, message: 'compaction-active: compact-export already running for this session' };
  }
  const operation: {
    sourceSessionId: string;
    temporarySession?: SessionHandle;
    abortRequested: boolean;
  } = {
    sourceSessionId: record.id,
    abortRequested: false,
  };
  // Register before any await so an early abort is not missed.
  context.compactExportOperations.set(record.id, operation);

  let temporarySession: SessionHandle | undefined;
  let operationFailed = false;
  let operationError: unknown;
  try {
    if (operation.abortRequested) {
      return { ok: false, message: 'Compaction cancelled' };
    }
    const history = await context.withTranscriptStore(record.id, (store) =>
      store.buildHistoryWindow({ maxMessages: 200, maxChars: 200_000 }),
    );
    if (operation.abortRequested) {
      return { ok: false, message: 'Compaction cancelled' };
    }
    const snapshotMessages: SessionTranscriptMessage[] = history.map((message, index) => ({
      id: `compact-history-${index}`,
      role: message.role as SessionTranscriptMessage['role'],
      text: message.text,
      createdAt: new Date().toISOString(),
      status: 'done',
    }));
    const seedMessages = buildCompactionSeedMessages(snapshotMessages);
    if (seedMessages.length === 0) {
      return { ok: false, message: 'Session has no messages to summarize' };
    }
    seedMessages.push({
      role: 'user',
      text: '[Internal snapshot boundary: summarize the preceding conversation.]',
      timestamp: Date.now(),
    });

    const createInput: CreateSessionInput = {
      projectPath: record.projectPath,
      ...(record.scope ? { scope: record.scope } : {}),
      ...(record.workingDirectory ? { cwd: record.workingDirectory } : {}),
      ...(record.name ? { sessionName: record.name } : {}),
    };
    temporarySession = await context.createSession(createInput, { seedMessages });
    operation.temporarySession = temporarySession;
    if (operation.abortRequested) {
      temporarySession.abortCompaction?.();
      return { ok: false, message: 'Compaction cancelled' };
    }
    return await compactSessionHandle(
      context,
      temporarySession.id,
      temporarySession,
      customInstructions,
      false,
    );
  } catch (error) {
    operationFailed = true;
    operationError = error;
    throw error;
  } finally {
    const registered = context.compactExportOperations.get(record.id);
    if (registered === operation) {
      context.compactExportOperations.delete(record.id);
    }
    if (temporarySession) {
      try {
        await context.disposeLiveSession(temporarySession.id);
      } catch (cleanupError) {
        if (operationFailed) {
          throw new AggregateError(
            [operationError, cleanupError],
            `failed to clean up compact snapshot ${temporarySession.id}`,
          );
        }
        throw cleanupError;
      }
    }
  }
}

function toSessionCompactData(
  result: SessionCompactResult & { compacted?: boolean; targetInputBudget?: number },
): SessionCompactData {
  const data: SessionCompactData = { ok: result.ok };
  if (typeof result.compacted === 'boolean') data.compacted = result.compacted;
  if (typeof result.targetInputBudget === 'number') {
    data.targetInputBudget = result.targetInputBudget;
  }
  if (result.message) data.message = result.message;
  if (result.summary) data.summary = result.summary;
  if (typeof result.tokensBefore === 'number') data.tokensBefore = result.tokensBefore;
  if (typeof result.tokensAfter === 'number') data.tokensAfter = result.tokensAfter;
  if (typeof result.durationMs === 'number') data.durationMs = result.durationMs;
  if (result.fileOps) data.fileOps = result.fileOps;
  return data;
}

export function resolveSessionOutputPath(
  rootDir: string,
  sessionId: string,
  requestedPath: string | undefined,
  defaultBasename: string,
): string {
  if (requestedPath && requestedPath.trim()) {
    const candidate = requestedPath.trim();
    return isAbsolute(candidate) ? candidate : resolvePath(candidate);
  }
  return resolvePath(getPiwinSessionDir(rootDir, sessionId), 'exports', defaultBasename);
}

export async function handleCompactionCommand(
  command: HostCommand,
  requestId: string | undefined,
  context: SessionLiveContext,
): Promise<HostResponse | null> {
  switch (command.type) {
    case 'session/compact': {
      const liveRun = context.getForegroundRun(command.sessionId);
      const runLive =
        liveRun !== undefined &&
        (liveRun.status === 'queued' ||
          liveRun.status === 'running' ||
          liveRun.status === 'cancelling');
      if (runLive && command.targetModel === undefined) {
        return sessionBusyResponse(
          requestId,
          'session/compact',
          command.sessionId,
          'foreground-run',
        );
      }
      if (!context.tryReserveSessionBody(command.sessionId)) {
        return sessionBusyResponse(requestId, 'session/compact', command.sessionId, 'body-job');
      }
      try {
        const result = command.targetModel
          ? await compactLiveSessionForTarget(
              context,
              command.sessionId,
              command.targetModel,
              0,
              command.customInstructions,
            )
          : await compactLiveSession(context, command.sessionId, command.customInstructions);
        return ok(requestId, 'session/compact', toSessionCompactData(result));
      } finally {
        context.releaseSessionBody(command.sessionId);
      }
    }
    case 'session/compact-export': {
      const rootDir = getPiwinRoot(context.piwinRoot);
      const indexPath = getPiwinSessionIndexPath(rootDir);
      const record = await getSessionRecord(indexPath, command.sessionId);
      if (!record) {
        return fail(requestId, 'session/compact-export', `Unknown session: ${command.sessionId}`);
      }

      const result = await compactTranscriptSnapshot(context, record, command.customInstructions);
      if (!result.ok) {
        return fail(
          requestId,
          'session/compact-export',
          result.message ?? 'Session compaction failed',
        );
      }

      const content = exportCompactionMarkdown({ summary: result.summary ?? '' });
      const outputPath = resolveSessionOutputPath(
        rootDir,
        command.sessionId,
        command.outputPath,
        suggestCompactionExportBasename(command.sessionId),
      );
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, content, 'utf8');
      const data: SessionCompactExportData = {
        sessionId: command.sessionId,
        format: 'md',
        path: outputPath,
        byteLength: Buffer.byteLength(content, 'utf8'),
        ...(result.summary ? { summary: result.summary } : {}),
        ...(typeof result.tokensBefore === 'number' ? { tokensBefore: result.tokensBefore } : {}),
        ...(typeof result.tokensAfter === 'number' ? { tokensAfter: result.tokensAfter } : {}),
        ...(typeof result.durationMs === 'number' ? { durationMs: result.durationMs } : {}),
      };
      return ok(requestId, 'session/compact-export', data);
    }
    case 'session/compact-abort': {
      const exportOperation = context.compactExportOperations.get(command.sessionId);
      if (exportOperation) {
        exportOperation.abortRequested = true;
        exportOperation.temporarySession?.abortCompaction?.();
        return ok(requestId, 'session/compact-abort', { sessionId: command.sessionId });
      }
      // Ordinary live-session compaction abort (not compact-export).
      if (!context.sessions.has(command.sessionId)) {
        return ok(requestId, 'session/compact-abort', { sessionId: command.sessionId });
      }
      const session = context.requireSession(command.sessionId);
      if (session.abortCompaction) {
        session.abortCompaction();
      }
      return ok(requestId, 'session/compact-abort', { sessionId: command.sessionId });
    }
    case 'session/compaction-settings': {
      const session = context.requireSession(command.sessionId);
      const supported = typeof session.getAutoCompactionEnabled === 'function';
      const resolved = await context.resolveAutoCompaction(command.sessionId);
      return ok(requestId, 'session/compaction-settings', {
        supported,
        autoCompactionEnabled: supported
          ? Boolean(session.getAutoCompactionEnabled?.())
          : resolved.enabled,
        source: resolved.source,
        globalDefault: resolved.globalDefault,
      });
    }
    case 'session/set-auto-compaction': {
      const session = context.requireSession(command.sessionId);
      if (!session.setAutoCompactionEnabled) {
        return fail(
          requestId,
          'session/set-auto-compaction',
          'auto-compaction settings not supported on this session',
        );
      }
      context.sessionAutoCompactionOverrides.set(command.sessionId, command.enabled);
      session.setAutoCompactionEnabled(command.enabled);
      return ok(requestId, 'session/set-auto-compaction', {
        enabled: command.enabled,
        source: 'session' as const,
      });
    }
    default:
      return null;
  }
}
