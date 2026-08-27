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
import type { SessionLiveContext, TerminateHostRunOptions } from './session-live-context.js';
import { handleSessionLiveCommand } from './session-live-commands.js';
import { RESUME_CONTINUATION_PROMPT } from './prompt-preparation.js';

/**
 * Start cancellation side effects without making the control response depend
 * on provider or process-manager latency. The foreground prompt remains the
 * only owner allowed to emit the run terminal event.
 */
function scheduleAbortCleanup(
  context: SessionLiveContext,
  sessionId: string,
  runId?: string,
): void {
  if (runId === undefined) {
    void Promise.all([
      abortLiveSession(context, sessionId),
      context.stopProcessesForSession(sessionId),
    ]).catch((error: unknown) => {
      const message = formatError(error);
      context.push({
        type: 'host/log',
        level: 'warn',
        message: `session abort cleanup failed: ${message}`,
      });
    });
    return;
  }
  void finalizeCancelledRun(context, sessionId, runId).catch((error: unknown) => {
    const message = formatError(error);
    context.push({
      type: 'host/log',
      level: 'warn',
      message: `session abort cleanup failed: ${message}`,
    });
  });
}

const DEFAULT_ABORT_CLEANUP_TIMEOUT_MS = 2_000;

async function settlesWithin(promise: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(false);
    }, timeoutMs);
    void promise.then(() => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(true);
    });
  });
}

function schedulePauseCleanup(context: SessionLiveContext, sessionId: string, runId: string): void {
  void finalizePausedRun(context, sessionId, runId).catch((error: unknown) => {
    const message = formatError(error);
    context.push({
      type: 'host/log',
      level: 'warn',
      message: `session pause cleanup failed: ${message}`,
    });
  });
}

function mergeTerminateOptions(
  extras: TerminateHostRunOptions | undefined,
  extra: TerminateHostRunOptions,
): TerminateHostRunOptions {
  return {
    ...(extras?.skipJobCleanup === true || extra.skipJobCleanup === true
      ? { skipJobCleanup: true }
      : {}),
    ...(extras?.agentStopReason === undefined ? {} : { agentStopReason: extras.agentStopReason }),
    ...(extra.agentStopReason === undefined ? {} : { agentStopReason: extra.agentStopReason }),
    ...(extras?.failure === undefined ? {} : { failure: extras.failure }),
    ...(extra.failure === undefined ? {} : { failure: extra.failure }),
  };
}

export async function finalizeAbortedRun(
  context: SessionLiveContext,
  sessionId: string,
  runId: string,
  extras?: TerminateHostRunOptions,
): Promise<void> {
  if (context.isPauseRequested(runId)) {
    await finalizePausedRun(context, sessionId, runId, extras);
    return;
  }
  await finalizeCancelledRun(context, sessionId, runId, undefined, 'cancelled', extras);
}

/**
 * Join the actual session operation and host-owned cleanup before publishing
 * the cancellation terminal. The run ID guard prevents a stale abort from
 * terminating a newer foreground run for the same session.
 */
export async function finalizeCancelledRun(
  context: SessionLiveContext,
  sessionId: string,
  runId: string,
  message?: string,
  code: RunTerminalCode = 'cancelled',
  extras?: TerminateHostRunOptions,
): Promise<void> {
  const admitted = context.getForegroundRun(sessionId);
  const newerOwnsSession = admitted !== undefined && admitted.runId !== runId;
  if (newerOwnsSession) {
    await context.terminateRun(sessionId, runId, 'cancelled', code, message, extras);
    return;
  }
  if (admitted === undefined || admitted.runId !== runId) {
    return;
  }
  await abortAndTerminalizeRun(context, sessionId, runId, message, code, extras);
}

/**
 * After a replace-run ack: cancel the old provider turn and terminalize it
 * even though the new Run is already admitted. The new run waits on join()
 * before calling prompt().
 */
export async function finalizeSupersededTurn(
  context: SessionLiveContext,
  sessionId: string,
  runId: string,
  message?: string,
  code: RunTerminalCode = 'superseded-by-new-prompt',
  extras?: TerminateHostRunOptions,
): Promise<void> {
  await abortAndTerminalizeRun(context, sessionId, runId, message, code, extras);
}

async function abortAndTerminalizeRun(
  context: SessionLiveContext,
  sessionId: string,
  runId: string,
  message?: string,
  code: RunTerminalCode = 'cancelled',
  extras?: TerminateHostRunOptions,
): Promise<void> {
  const cleanupPromise = Promise.allSettled([
    abortLiveSession(context, sessionId),
    context.stopProcessesForSession(sessionId),
  ]);
  const cleanupSettled = await settlesWithin(
    cleanupPromise,
    context.abortCleanupTimeoutMs ?? DEFAULT_ABORT_CLEANUP_TIMEOUT_MS,
  );
  if (!cleanupSettled) {
    const timeoutMessage =
      'The runtime did not acknowledge Stop in time and was detached. The next prompt will use a fresh runtime.';
    context.push({
      type: 'host/log',
      level: 'warn',
      message: `session abort cleanup timed out: ${sessionId}/${runId}`,
    });
    await context.terminateRun(
      sessionId,
      runId,
      'cancelled',
      code,
      timeoutMessage,
      mergeTerminateOptions(extras, { skipJobCleanup: true }),
    );
    context.quarantineSessionRuntime(sessionId, runId);
    return;
  }
  const cleanupResults = await cleanupPromise;
  for (const cleanupResult of cleanupResults) {
    if (cleanupResult.status === 'rejected') {
      const detail = formatError(cleanupResult.reason);
      context.push({
        type: 'host/log',
        level: 'warn',
        message: `session abort cleanup failed: ${detail}`,
      });
    }
  }
  await context.terminateRun(sessionId, runId, 'cancelled', code, message, extras);
}

/** Persist the partial transcript before publishing the paused terminal. */
async function finalizePausedRun(
  context: SessionLiveContext,
  sessionId: string,
  runId: string,
  extras?: TerminateHostRunOptions,
): Promise<void> {
  if (context.getForegroundRun(sessionId)?.runId !== runId) {
    return;
  }
  if (!context.isPauseRequested(runId)) {
    await finalizeCancelledRun(context, sessionId, runId, undefined, 'cancelled', extras);
    return;
  }
  const cleanupPromise = Promise.allSettled([
    abortLiveSession(context, sessionId),
    context.stopProcessesForSession(sessionId),
  ]);
  const cleanupSettled = await settlesWithin(
    cleanupPromise,
    context.abortCleanupTimeoutMs ?? DEFAULT_ABORT_CLEANUP_TIMEOUT_MS,
  );
  if (cleanupSettled) {
    const cleanupResults = await cleanupPromise;
    for (const cleanupResult of cleanupResults) {
      if (cleanupResult.status === 'rejected') {
        const detail = formatError(cleanupResult.reason);
        context.push({
          type: 'host/log',
          level: 'warn',
          message: `session pause cleanup failed: ${detail}`,
        });
      }
    }
  } else {
    context.push({
      type: 'host/log',
      level: 'warn',
      message: `session pause cleanup timed out: ${sessionId}/${runId}`,
    });
  }
  if (context.getForegroundRun(sessionId)?.runId !== runId) {
    return;
  }
  try {
    if (context.flushTranscriptRecorder) {
      await context.flushTranscriptRecorder(sessionId);
    }
    const run = context.getForegroundRun(sessionId);
    if (run === undefined || run.runId !== runId || !context.isPauseRequested(runId)) {
      return;
    }
    const checkpoint = await context.withTranscriptStore(sessionId, async (store) => {
      const sourceUserMessage = await store.lastMessageByRole('user');
      const lastAssistantMessage = await store.lastMessageByRole('assistant');
      return store.createPauseCheckpoint({
        sessionId,
        sourceRunId: runId,
        ...(run.resumeCheckpointId !== undefined ? { checkpointId: run.resumeCheckpointId } : {}),
        ...(run.runtimeGenerationId !== undefined
          ? { runtimeGenerationId: run.runtimeGenerationId }
          : {}),
        createdAt: new Date().toISOString(),
        ...(sourceUserMessage?.id !== undefined
          ? { sourceUserMessageId: sourceUserMessage.id }
          : {}),
        ...(lastAssistantMessage?.id !== undefined
          ? { lastAssistantMessageId: lastAssistantMessage.id }
          : {}),
        transcriptRevision: await store.getRevision(),
      });
    });
    context.attachResumeCheckpoint(runId, checkpoint.checkpointId);
    const terminalMessage = cleanupSettled
      ? 'Run paused; a resumable checkpoint was saved.'
      : 'Run paused from durable output after the runtime missed the cleanup deadline. The next prompt will use a fresh runtime.';
    if (cleanupSettled) {
      await context.terminateRun(sessionId, runId, 'paused', 'paused', terminalMessage, extras);
    } else {
      await context.terminateRun(
        sessionId,
        runId,
        'paused',
        'paused',
        terminalMessage,
        mergeTerminateOptions(extras, { skipJobCleanup: true }),
      );
      context.quarantineSessionRuntime(sessionId, runId);
    }
  } catch (error) {
    const message = formatError(error);
    context.push({
      type: 'host/log',
      level: 'error',
      message: `pause checkpoint creation failed: ${message}`,
    });
    if (cleanupSettled) {
      await context.terminateRun(
        sessionId,
        runId,
        'failed',
        'failed',
        `Pause could not be saved: ${message}`,
      );
    } else {
      await context.terminateRun(
        sessionId,
        runId,
        'failed',
        'failed',
        `Pause could not be saved: ${message}`,
        { skipJobCleanup: true },
      );
      context.quarantineSessionRuntime(sessionId, runId);
    }
  }
}

async function abortLiveSession(context: SessionLiveContext, sessionId: string): Promise<void> {
  try {
    await context.requireSession(sessionId).abort();
  } catch (error) {
    const message = formatError(error);
    context.push({
      type: 'host/log',
      level: 'warn',
      message: `session abort failed: ${message}`,
    });
  }
}

export async function handleRunControlCommand(
  command: HostCommand,
  requestId: string | undefined,
  context: SessionLiveContext,
): Promise<HostResponse | null> {
  switch (command.type) {
    case 'session/pause': {
      const activeCheckpoint = await context.getActivePauseCheckpoint(command.sessionId);
      const active = context.getForegroundRun(command.sessionId);
      if (!active) {
        if (activeCheckpoint !== undefined) {
          const data: SessionPauseAcceptedData = {
            sessionId: command.sessionId,
            state: 'paused',
            checkpointId: activeCheckpoint.checkpointId,
          };
          return ok(requestId, 'session/pause', data);
        }
        context.settlePendingExtensionUiForSession(command.sessionId);
        const data: SessionPauseAcceptedData = {
          sessionId: command.sessionId,
          state: 'paused',
          reason: 'no-active-run',
        };
        return ok(requestId, 'session/pause', data);
      }
      if (command.runId !== undefined && command.runId !== active.runId) {
        const data: SessionPauseAcceptedData = {
          sessionId: command.sessionId,
          runId: active.runId,
          state: 'pausing',
          reason: 'run-mismatch',
        };
        return ok(requestId, 'session/pause', data);
      }
      if (context.isPauseRequested(active.runId)) {
        const data: SessionPauseAcceptedData = {
          sessionId: command.sessionId,
          runId: active.runId,
          state: 'pausing',
        };
        return ok(requestId, 'session/pause', data);
      }
      if (context.hasActiveDescendants(active.runId)) {
        return fail(
          requestId,
          'session/pause',
          'pause-unsupported-active-descendants: foreground run owns active child runs',
        );
      }
      const pauseReason = createPauseRequestedAbortReason();
      context.updateRunPhase(active.runId, 'pausing', 'Saving a resumable checkpoint');
      const requested = context.requestPauseRun(command.sessionId, active.runId, pauseReason);
      if (!requested) {
        return ok(requestId, 'session/pause', {
          sessionId: command.sessionId,
          state: 'paused',
          reason: 'no-active-run',
        } satisfies SessionPauseAcceptedData);
      }
      context.settlePendingPermissionsForSession(command.sessionId);
      context.settlePendingExtensionUiForSession(command.sessionId);
      schedulePauseCleanup(context, command.sessionId, active.runId);
      return ok(requestId, 'session/pause', {
        sessionId: command.sessionId,
        runId: active.runId,
        state: 'pausing',
      } satisfies SessionPauseAcceptedData);
    }
    case 'session/resume-run': {
      const active = context.getForegroundRun(command.sessionId);
      if (active) {
        return fail(
          requestId,
          'session/resume-run',
          `run-active: session ${command.sessionId} already has foreground run ${active.runId}`,
        );
      }
      const checkpoint =
        command.checkpointId === undefined
          ? await context.getActivePauseCheckpoint(command.sessionId)
          : await context.getPauseCheckpoint(command.sessionId, command.checkpointId);
      if (checkpoint === undefined || checkpoint.status !== 'active') {
        return fail(
          requestId,
          'session/resume-run',
          `no-active-checkpoint: session ${command.sessionId} has no resumable checkpoint`,
        );
      }
      const resumePrompt: HostCommand = {
        ...(command.id !== undefined ? { id: command.id } : {}),
        type: 'session/prompt',
        sessionId: command.sessionId,
        input: {
          text: RESUME_CONTINUATION_PROMPT,
          source: 'resume',
          resumeCheckpointId: checkpoint.checkpointId,
        },
      };
      const response = await handleSessionLiveCommand(resumePrompt, requestId, context);
      if (response === null) {
        return fail(requestId, 'session/resume-run', 'resume prompt was not accepted');
      }
      if (!response.success) {
        return fail(requestId, 'session/resume-run', response.error);
      }
      const accepted = response.data as SessionRunAcceptedData | undefined;
      if (accepted === undefined || typeof accepted.runId !== 'string') {
        return fail(requestId, 'session/resume-run', 'resume prompt acknowledgement was invalid');
      }
      const data: SessionResumeRunAcceptedData = {
        sessionId: command.sessionId,
        runId: accepted.runId,
        checkpointId: checkpoint.checkpointId,
        acceptedAt: accepted.acceptedAt,
      };
      return ok(requestId, 'session/resume-run', data);
    }
    case 'session/abort': {
      const requestedRunId =
        'runId' in command && typeof command.runId === 'string' ? command.runId : undefined;
      const active = context.getForegroundRun(command.sessionId);
      if (!active) {
        // An orphaned Extension UI request must not survive after its run has
        // already disappeared, even though there is no active run left to
        // cancel.
        context.settlePendingExtensionUiForSession(command.sessionId);
        // Idempotent: no active run to cancel. Clear the durable checkpoint
        // before acknowledging so a subsequent prompt cannot race the Stop.
        try {
          await context.clearPauseCheckpoint(command.sessionId);
        } catch (error) {
          context.push({
            type: 'host/log',
            level: 'warn',
            message: `pause checkpoint clear failed: ${formatError(error)}`,
          });
        }
        scheduleAbortCleanup(context, command.sessionId);
        return ok(requestId, 'session/abort', {
          sessionId: command.sessionId,
          cancelled: false,
          reason: 'no-active-run',
        });
      }
      if (requestedRunId !== undefined && active.runId !== requestedRunId) {
        return ok(requestId, 'session/abort', {
          sessionId: command.sessionId,
          cancelled: false,
          reason: 'run-mismatch',
          activeRunId: active.runId,
        });
      }
      // Extension UI waits are not governed by the run AbortSignal. Resolve
      // them explicitly after validating run ownership; a stale abort must
      // never cancel a newer run's questionnaire.
      context.settlePendingExtensionUiForSession(command.sessionId);

      context.updateRunPhase(active.runId, 'cancelling', 'User stopped the run');
      const cancellationRequested = context.requestCancelRun(
        command.sessionId,
        active.runId,
        createUserStopAbortReason(),
      );
      if (!cancellationRequested) {
        return ok(requestId, 'session/abort', {
          sessionId: command.sessionId,
          cancelled: false,
          reason: 'no-active-run',
        });
      }
      context.settlePendingPermissionsForSession(command.sessionId);

      // The background prompt owns terminal confirmation. Neither provider
      // abort nor process cleanup is allowed to delay this acknowledgement.
      scheduleAbortCleanup(context, command.sessionId, active.runId);

      return ok(requestId, 'session/abort', {
        sessionId: command.sessionId,
        runId: active.runId,
        cancelled: true,
      });
    }
    default:
      return null;
  }
}
