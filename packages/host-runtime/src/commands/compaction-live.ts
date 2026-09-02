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
  SessionSeedMessage,
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
  classifyCompactionNoOp,
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
import { extractFileOpsFromUnknown } from '../compaction-file-ops.js';
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

function isAlreadyCompactedMessage(message: string | undefined): boolean {
  return classifyCompactionNoOp(message) === 'already-compacted';
}

type TargetCompactionResult = SessionCompactResult & {
  compacted: boolean;
  targetInputBudget: number;
};

async function compactLiveSessionForTargetAttempt(
  context: SessionLiveContext,
  sessionId: string,
  customInstructions: string,
): Promise<SessionCompactResult> {
  try {
    return await compactLiveSession(context, sessionId, customInstructions);
  } catch (error) {
    const message = formatError(error);
    if (isAlreadyCompactedMessage(message) || classifyCompactionNoOp(message) === 'too-small') {
      return { ok: false, message };
    }
    throw error;
  }
}

async function resolveAlreadyCompactedTarget(
  context: SessionLiveContext,
  sessionId: string,
  targetBudget: { inputBudget: number },
  pendingPromptTokens: number,
  compactResult: SessionCompactResult,
): Promise<TargetCompactionResult> {
  const latestUsage = await context.loadSessionUsage(sessionId);
  const latestOccupied = readContextOccupiedTokens(latestUsage);
  const postCompactTokens = compactResult.tokensAfter ?? latestOccupied;
  if (postCompactTokens === undefined) {
    throw new Error(
      `context-limit-unverified: native context is already compacted but occupancy could not be measured for target input budget ${targetBudget.inputBudget}`,
    );
  }
  if (postCompactTokens + Math.max(0, pendingPromptTokens) > targetBudget.inputBudget) {
    throw new Error(
      `context-limit-exceeded: compacted context ${postCompactTokens + Math.max(0, pendingPromptTokens)} exceeds target input budget ${targetBudget.inputBudget}`,
    );
  }
  return {
    ok: true,
    compacted: false,
    targetInputBudget: targetBudget.inputBudget,
    tokensAfter: postCompactTokens,
    message: 'Native context is already compacted and fits the target model budget',
  };
}

async function loadProductCompactionSeeds(
  context: SessionLiveContext,
  sessionId: string,
): Promise<SessionSeedMessage[]> {
  const history = await context.withTranscriptStore(sessionId, (store) =>
    store.buildHistoryWindow({ maxMessages: 200, maxChars: 200_000 }),
  );
  const snapshotMessages: SessionTranscriptMessage[] = history.map((message, index) => ({
    id: `compact-history-${index}`,
    role: message.role as SessionTranscriptMessage['role'],
    text: message.text,
    createdAt: new Date().toISOString(),
    status: 'done',
  }));
  return buildCompactionSeedMessages(snapshotMessages);
}

async function compactLiveSession(
  context: SessionLiveContext,
  sessionId: string,
  customInstructions?: string,
): Promise<SessionCompactResult> {
  // A warm product runtime owns the authoritative native Pi branch. Do not
  // infer its presence from getMessages(): the product handle deliberately
  // keeps that surface opaque to HostRuntime.
  let session = await context.ensureLiveSession(sessionId);
  // A cold runtime without native replay is the only case that needs a
  // product-transcript seed. This replacement is safe because the runtime
  // has no native context yet; warm runtimes stay untouched until compact
  // itself succeeds or throws.
  if (context.needsProductHistoryInjection(sessionId)) {
    const seedMessages = await loadProductCompactionSeeds(context, sessionId);
    if (seedMessages.length >= 2) {
      session = await context.reactivateWithSeedMessages(sessionId, seedMessages);
    }
  }
  return compactSessionHandle(context, sessionId, session, customInstructions);
}

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
    (requiredTokens !== undefined && requiredTokens <= targetBudget.inputBudget)
  ) {
    return {
      ok: true,
      compacted: false,
      targetInputBudget: targetBudget.inputBudget,
      message: alreadyUsingTarget
        ? 'Session is already using the target model'
        : 'Current context fits the target model budget',
    };
  }

  if (requiredTokens === undefined) {
    // A missing occupancy sample is not evidence that the target is over
    // budget. In particular, a cold product shell may already have a native
    // compaction seed queued for activation; eagerly waking it just to run
    // another compact made every model switch look like a compaction. Keep
    // the switch non-destructive and let the target provider enforce its own
    // hard limit. A later measured sample can still trigger this guard.
    return {
      ok: true,
      compacted: false,
      targetInputBudget: targetBudget.inputBudget,
      message: 'Target context occupancy is unavailable; preserving context for model switch',
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
  const result = await compactLiveSessionForTargetAttempt(context, sessionId, targetInstructions);
  if (!result.ok) {
    if (classifyCompactionNoOp(result.message) === 'too-small') {
      return {
        ok: true,
        compacted: false,
        targetInputBudget: targetBudget.inputBudget,
        message: 'Native context has nothing to compact; target model switch can proceed',
      };
    }
    if (isAlreadyCompactedMessage(result.message)) {
      return resolveAlreadyCompactedTarget(
        context,
        sessionId,
        targetBudget,
        pendingPromptTokens,
        result,
      );
    }
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
  options: { persistBoundary?: boolean } = {},
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

    if (options.persistBoundary !== false && enrichedResult.ok) {
      // Persist before returning to the caller. Model changes can replace the
      // backend immediately after `/compact` resolves, so an asynchronous
      // event-only write would race the replacement and lose the summary.
      await context.recordCompactionBoundary(sessionId, enrichedResult);
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
    return {
      ok: false,
      message: 'compaction-active: compact-export already running for this session',
    };
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
      { persistBoundary: false },
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
      // Model-switch prompts do not invoke target compaction. The public
      // command remains exclusive for every form, including targetModel, so
      // another client cannot compact/replace a generation owned by a live Run.
      if (runLive) {
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
      } catch (error) {
        return fail(requestId, 'session/compact', formatError(error));
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
      const session = context.sessions.get(command.sessionId);
      if (!session) {
        const record = await getSessionRecord(
          getPiwinSessionIndexPath(getPiwinRoot(context.piwinRoot)),
          command.sessionId,
        );
        if (!record) {
          return fail(
            requestId,
            'session/compaction-settings',
            `Unknown session: ${command.sessionId}`,
          );
        }
      }
      // A cold durable shell still has a valid Host policy even though no
      // native backend handle exists yet. Report that policy without forcing
      // activation merely to render the settings panel.
      const supported =
        session === undefined || typeof session.getAutoCompactionEnabled === 'function';
      const resolved = await context.resolveAutoCompaction(command.sessionId);
      // A lazy product shell reports a placeholder value until its first
      // activation. Prefer Host's resolved policy while no native runtime is
      // resident, otherwise the settings panel briefly shows a false value
      // even when the configured default is true.
      const runtimeReady = session?.needsProductHistoryInjection?.() !== true;
      const actual =
        session && supported && runtimeReady
          ? await session.getAutoCompactionEnabled?.()
          : undefined;
      const override = context.sessionAutoCompactionOverrides.get(command.sessionId);
      return ok(requestId, 'session/compaction-settings', {
        supported,
        autoCompactionEnabled: override ?? actual ?? resolved.enabled,
        source: resolved.source,
        globalDefault: resolved.globalDefault,
      });
    }
    case 'session/set-auto-compaction': {
      const session = context.sessions.get(command.sessionId);
      if (!session) {
        const record = await getSessionRecord(
          getPiwinSessionIndexPath(getPiwinRoot(context.piwinRoot)),
          command.sessionId,
        );
        if (!record) {
          return fail(
            requestId,
            'session/set-auto-compaction',
            `Unknown session: ${command.sessionId}`,
          );
        }
        // Keep the override Host-owned until the first activation. This
        // avoids allocating a backend just to change a session preference.
        context.sessionAutoCompactionOverrides.set(command.sessionId, command.enabled);
        return ok(requestId, 'session/set-auto-compaction', {
          enabled: command.enabled,
          source: 'session' as const,
        });
      }
      if (!session.setAutoCompactionEnabled) {
        return fail(
          requestId,
          'session/set-auto-compaction',
          'auto-compaction settings not supported on this session',
        );
      }
      await session.setAutoCompactionEnabled(command.enabled);
      context.sessionAutoCompactionOverrides.set(command.sessionId, command.enabled);
      return ok(requestId, 'session/set-auto-compaction', {
        enabled: command.enabled,
        source: 'session' as const,
      });
    }
    default:
      return null;
  }
}
