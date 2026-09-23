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
  wrapLiveDelegationForAgent,
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
import type { SessionLiveContext } from './session-live-context.js';
import { shouldInjectLiveWorkPreamble } from '../voice/live-work-preamble.js';

import {
  instructionPayloadFromPromptInput,
  prepareRunInterventionPayload,
  sameInstructionPayload,
  toBackendRunIntervention,
  validateRunInterventionInput,
  type PreparedRunIntervention,
} from './prepare-run-intervention.js';

function fingerprintRunIntervention(input: {
  sessionId: string;
  runId: string;
  userMessageId: string;
  payload: import('@piwin/contracts').UserInstructionPayload;
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        sessionId: input.sessionId,
        runId: input.runId,
        userMessageId: input.userMessageId,
        text: input.payload.text,
        attachments: input.payload.attachments ?? [],
        contextRefs: input.payload.contextRefs ?? [],
      }),
    )
    .digest('hex');
}

function validateInterventionTarget(
  context: SessionLiveContext,
  sessionId: string,
  runId: string,
): ExecutionRunRecord | string {
  const active = context.getForegroundRun(sessionId);
  if (!active) return `no-active-run: session ${sessionId} has no foreground run`;
  if (active.runId !== runId) {
    return `run-mismatch: requested ${runId}, active ${active.runId}`;
  }
  if (active.status === 'cancelling') return 'run-cancelling: intervention is unavailable';
  if (context.isPauseRequested(active.runId) || active.phase === 'pausing') {
    return 'run-pausing: intervention is unavailable';
  }
  if (active.runtimeGenerationId === undefined) {
    return 'runtime-generation-unavailable: active Run is not bound to a backend generation';
  }
  return active;
}

async function armPendingIntervention(
  context: SessionLiveContext,
  intervention: RunInterventionRecord,
  prepared: PreparedRunIntervention,
): Promise<void> {
  const session = context.requireSession(intervention.sessionId);
  if (!session.armRunIntervention) {
    throw new Error('run-intervention-backend-unsupported');
  }
  await session.armRunIntervention(toBackendRunIntervention(intervention, prepared));
}

/**
 * A rejected edit/cancel means the client acted on a stale row (usually a
 * lost lifecycle push). Re-push the durable record so the card leaves
 * 「等待当前步骤完成」 without waiting for a transcript reload.
 */
async function resyncStaleIntervention(
  context: SessionLiveContext,
  store: Awaited<ReturnType<SessionLiveContext['getTranscriptStore']>>,
  interventionId: string,
): Promise<void> {
  const latest = await store.getRunIntervention(interventionId);
  if (latest !== undefined) {
    context.push({ type: 'run/intervention-updated', intervention: latest });
  }
}

/**
 * Pre-flight the durable queued turn an adoption wants to convert. The store
 * conversion re-checks status/revision atomically; this guard exists to fail
 * before any mutation when the request targets the wrong record, a replace-mode
 * turn, or a payload that drifted from the frozen queued input.
 */
async function validateQueuedTurnAdoption(
  command: Extract<HostCommand, { type: 'run/intervention-submit' }>,
  store: Awaited<ReturnType<SessionLiveContext['getTranscriptStore']>>,
): Promise<Error | undefined> {
  const adoption = command.adoptQueuedTurn;
  if (adoption === undefined) {
    return new Error('intervention-adopt-invalid: adoptQueuedTurn is required');
  }
  const { queuedTurnId, expectedRevision } = adoption;
  if (!queuedTurnId.trim() || !Number.isSafeInteger(expectedRevision) || expectedRevision <= 0) {
    return new Error(
      'intervention-adopt-invalid: queuedTurnId and a positive expectedRevision are required',
    );
  }
  const queuedTurn = await store.getQueuedTurn(queuedTurnId);
  if (!queuedTurn || queuedTurn.sessionId !== command.sessionId) {
    return new Error('queued-turn-not-found');
  }
  if (queuedTurn.userMessageId !== command.userMessageId) {
    return new Error('idempotency-conflict');
  }
  if (queuedTurn.mode !== 'next') {
    return new Error('queued-turn-mode-invalid: only a normal next turn can be converted');
  }
  if (
    !sameInstructionPayload(instructionPayloadFromPromptInput(queuedTurn.input), command.input)
  ) {
    return new Error(
      'intervention-adopt-payload-mismatch: input must equal the queued turn text, attachments, and context references',
    );
  }
  return undefined;
}

export async function handleRunInterventionCommand(
  command: HostCommand,
  requestId: string | undefined,
  context: SessionLiveContext,
): Promise<HostResponse | null> {
  switch (command.type) {
    case 'run/intervention-submit': {
      const validationError = validateRunInterventionInput(command.input);
      if (validationError) return fail(requestId, command.type, validationError);
      if (!command.interventionId.trim() || !command.userMessageId.trim()) {
        return fail(
          requestId,
          command.type,
          'intervention-identity-invalid: interventionId and userMessageId are required',
        );
      }
      const target = validateInterventionTarget(context, command.sessionId, command.runId);
      let store: Awaited<ReturnType<SessionLiveContext['getTranscriptStore']>>;
      let existingById: RunInterventionRecord | undefined;
      if (typeof target === 'string') {
        try {
          store = await context.getTranscriptStore(command.sessionId);
          existingById = await store.getRunIntervention(command.interventionId);
        } catch {
          return fail(requestId, command.type, target);
        }
        if (existingById === undefined) {
          return fail(requestId, command.type, target);
        }
      } else {
        store = await context.getTranscriptStore(command.sessionId);
        existingById = await store.getRunIntervention(command.interventionId);
      }
      if (existingById !== undefined) {
        const replay = await store.createRunIntervention({
          interventionId: command.interventionId,
          sessionId: command.sessionId,
          runId: command.runId,
          runtimeGenerationId: existingById.runtimeGenerationId,
          userMessageId: command.userMessageId,
          input: command.input,
          preparedText: command.input.text,
          fingerprint: fingerprintRunIntervention({
            sessionId: command.sessionId,
            runId: command.runId,
            userMessageId: command.userMessageId,
            payload: command.input,
          }),
          submittedAt: existingById.submittedAt,
        });
        if (!('intervention' in replay)) {
          return fail(requestId, command.type, 'idempotency-conflict');
        }
        let replayedIntervention = replay.intervention;
        if (typeof target !== 'string' && replayedIntervention.status === 'pending') {
          if (target.runtimeGenerationId !== replayedIntervention.runtimeGenerationId) {
            const expired = await store.transitionRunIntervention({
              interventionId: replayedIntervention.interventionId,
              expectedRevision: replayedIntervention.revision,
              from: ['pending'],
              to: 'expired',
              updatedAt: new Date().toISOString(),
              terminalReason: 'generation-replaced',
            });
            if (expired !== undefined) {
              replayedIntervention = expired;
              context.push({ type: 'run/intervention-updated', intervention: expired });
            }
          } else {
            try {
              // Recover the narrow window where Host persistence succeeded but
              // the first ACK/arm did not. Backend arming is revision-idempotent.
              const prepared = await prepareRunInterventionPayload(
                context,
                replayedIntervention.input,
              );
              await armPendingIntervention(context, replayedIntervention, prepared);
            } catch {
              const latest = await store.getRunIntervention(replayedIntervention.interventionId);
              if (latest !== undefined && latest.status !== 'pending') {
                replayedIntervention = latest;
              } else {
                const failed = await store.transitionRunIntervention({
                  interventionId: replayedIntervention.interventionId,
                  expectedRevision: replayedIntervention.revision,
                  from: ['pending'],
                  to: 'failed',
                  updatedAt: new Date().toISOString(),
                  terminalReason: 'backend-rejected',
                });
                if (failed !== undefined) {
                  replayedIntervention = failed;
                  context.push({ type: 'run/intervention-updated', intervention: failed });
                }
              }
            }
          }
        }
        // Idempotent recovery is valid even after the target Run became
        // terminal: the client is recovering Host admission, not asking a
        // newer Run to consume the instruction.
        if (command.adoptQueuedTurn !== undefined) {
          // A conversion retry replays the same atomic outcome: the adopted
          // queued turn must already be cancelled into this intervention.
          const adopted = await store.getQueuedTurn(command.adoptQueuedTurn.queuedTurnId);
          if (
            !adopted ||
            adopted.userMessageId !== command.userMessageId ||
            adopted.status !== 'cancelled' ||
            adopted.terminalReason !== 'converted-to-intervention'
          ) {
            return fail(requestId, command.type, 'idempotency-conflict');
          }
          return ok(requestId, command.type, {
            intervention: replayedIntervention,
            queuedTurn: adopted,
          });
        }
        return ok(requestId, command.type, { intervention: replayedIntervention });
      }
      // An invalid target can only reach here if a concurrent cleanup removed
      // the record between the replay lookup and this check.
      if (typeof target === 'string') return fail(requestId, command.type, target);
      const runtimeGenerationId = target.runtimeGenerationId;
      if (runtimeGenerationId === undefined) {
        return fail(requestId, command.type, 'runtime-generation-unavailable');
      }
      if (command.adoptQueuedTurn !== undefined) {
        const adoptError = await validateQueuedTurnAdoption(command, store);
        if (adoptError instanceof Error) {
          return fail(requestId, command.type, adoptError.message);
        }
      }
      let prepared: PreparedRunIntervention;
      try {
        prepared = await prepareRunInterventionPayload(context, command.input);
      } catch (error) {
        return fail(requestId, command.type, formatError(error));
      }
      const preparedTarget = validateInterventionTarget(context, command.sessionId, command.runId);
      if (
        typeof preparedTarget === 'string' ||
        preparedTarget.runtimeGenerationId !== runtimeGenerationId
      ) {
        return fail(
          requestId,
          command.type,
          typeof preparedTarget === 'string' ? preparedTarget : 'runtime-generation-unavailable',
        );
      }
      const existingItems = await store.listRunInterventions(command.runId);
      const pendingItems = existingItems.filter(
        (item) => item.status === 'pending' || item.status === 'applying',
      );
      if (pendingItems.length >= RUN_INTERVENTION_MAX_PENDING_PER_RUN) {
        return fail(requestId, command.type, 'intervention-queue-full');
      }
      const pendingBytes = pendingItems.reduce(
        (total, item) => total + Buffer.byteLength(item.input.text, 'utf8'),
        0,
      );
      if (
        pendingBytes + Buffer.byteLength(prepared.preparedText, 'utf8') >
          RUN_INTERVENTION_MAX_PENDING_BYTES_PER_RUN
      ) {
        return fail(requestId, command.type, 'intervention-queue-bytes-exceeded');
      }
      const submittedAt = new Date().toISOString();
      const fingerprint = fingerprintRunIntervention({
        sessionId: command.sessionId,
        runId: command.runId,
        userMessageId: command.userMessageId,
        payload: command.input,
      });
      // An adoption converts the queued turn and its already-painted user row
      // in one store transaction; a plain submit creates a new user row.
      let cancelledQueuedTurn: QueuedTurnRecord | undefined;
      let intervention: RunInterventionRecord;
      if (command.adoptQueuedTurn !== undefined) {
        const converted = await store.convertQueuedTurnToIntervention({
          queuedTurnId: command.adoptQueuedTurn.queuedTurnId,
          expectedRevision: command.adoptQueuedTurn.expectedRevision,
          interventionId: command.interventionId,
          runId: command.runId,
          runtimeGenerationId,
          userMessageId: command.userMessageId,
          input: command.input,
          preparedText: prepared.preparedText,
          fingerprint,
          updatedAt: submittedAt,
        });
        if (!('intervention' in converted)) {
          // Store outcomes already carry the queued-turn- prefix except the
          // shared identity conflict.
          return fail(
            requestId,
            command.type,
            converted.outcome === 'idempotency-conflict'
              ? 'idempotency-conflict'
              : converted.outcome,
          );
        }
        intervention = converted.intervention;
        cancelledQueuedTurn = converted.queuedTurn;
        if (converted.outcome === 'converted') {
          context.push({ type: 'session/queued-turn-updated', queuedTurn: cancelledQueuedTurn });
          context.push({ type: 'run/intervention-updated', intervention });
        }
      } else {
        const created = await store.createRunIntervention({
          interventionId: command.interventionId,
          sessionId: command.sessionId,
          runId: command.runId,
          runtimeGenerationId,
          userMessageId: command.userMessageId,
          input: command.input,
          preparedText: prepared.preparedText,
          fingerprint,
          submittedAt,
        });
        if (!('intervention' in created)) {
          return fail(
            requestId,
            command.type,
            created.outcome === 'idempotency-conflict'
              ? 'idempotency-conflict'
              : 'user-message-id-conflict',
          );
        }
        intervention = created.intervention;
        if (created.outcome === 'created') {
          const userMessage = await store.getMessage(intervention.userMessageId);
          if (userMessage) {
            context.push({
              type: 'transcript/append',
              sessionId: command.sessionId,
              message: userMessage,
            });
          }
          context.push({ type: 'run/intervention-updated', intervention });
        }
      }
      const withAdoptedQueuedTurn = (): {
        intervention: RunInterventionRecord;
        queuedTurn?: QueuedTurnRecord;
      } => ({
        intervention,
        ...(cancelledQueuedTurn === undefined
          ? {}
          : { queuedTurn: cancelledQueuedTurn }),
      });
      if (intervention.status !== 'pending') {
        return ok(requestId, command.type, withAdoptedQueuedTurn());
      }
      const revalidated = validateInterventionTarget(context, command.sessionId, command.runId);
      if (
        typeof revalidated === 'string' ||
        revalidated.runtimeGenerationId !== runtimeGenerationId
      ) {
        const expired = await store.transitionRunIntervention({
          interventionId: intervention.interventionId,
          expectedRevision: intervention.revision,
          from: ['pending'],
          to: 'expired',
          updatedAt: new Date().toISOString(),
          terminalReason:
            typeof revalidated === 'string' && revalidated.startsWith('run-pausing')
              ? 'run-pausing'
              : 'run-ended',
        });
        if (expired) {
          intervention = expired;
          context.push({ type: 'run/intervention-updated', intervention });
        }
        return ok(requestId, command.type, withAdoptedQueuedTurn());
      }
      try {
        await armPendingIntervention(context, intervention, prepared);
      } catch {
        const failed = await store.transitionRunIntervention({
          interventionId: intervention.interventionId,
          expectedRevision: intervention.revision,
          from: ['pending'],
          to: 'failed',
          updatedAt: new Date().toISOString(),
          terminalReason: 'backend-rejected',
        });
        if (failed) {
          intervention = failed;
          context.push({ type: 'run/intervention-updated', intervention });
        }
      }
      return ok(requestId, command.type, withAdoptedQueuedTurn());
    }
    case 'run/intervention-edit': {
      const validationError = validateRunInterventionInput(command.input);
      if (validationError) return fail(requestId, command.type, validationError);
      const store = await context.getTranscriptStore(command.sessionId);
      const existing = await store.getRunIntervention(command.interventionId);
      if (!existing || existing.runId !== command.runId) {
        return fail(requestId, command.type, 'intervention-not-found');
      }
      const target = validateInterventionTarget(context, command.sessionId, command.runId);
      if (typeof target === 'string') {
        await resyncStaleIntervention(context, store, command.interventionId);
        return fail(requestId, command.type, target);
      }
      let prepared: PreparedRunIntervention;
      try {
        prepared = await prepareRunInterventionPayload(context, command.input);
      } catch (error) {
        return fail(requestId, command.type, formatError(error));
      }
      const updated = await store.updatePendingRunIntervention({
        interventionId: command.interventionId,
        expectedRevision: command.expectedRevision,
        input: command.input,
        preparedText: prepared.preparedText,
        fingerprint: fingerprintRunIntervention({
          sessionId: command.sessionId,
          runId: command.runId,
          userMessageId: existing.userMessageId,
          payload: command.input,
        }),
        updatedAt: new Date().toISOString(),
      });
      if (!updated) {
        await resyncStaleIntervention(context, store, command.interventionId);
        return fail(requestId, command.type, 'intervention-revision-conflict');
      }
      try {
        await armPendingIntervention(context, updated, prepared);
      } catch {
        const failed = await store.transitionRunIntervention({
          interventionId: updated.interventionId,
          expectedRevision: updated.revision,
          from: ['pending'],
          to: 'failed',
          updatedAt: new Date().toISOString(),
          terminalReason: 'backend-rejected',
        });
        if (failed) context.push({ type: 'run/intervention-updated', intervention: failed });
        return fail(requestId, command.type, 'intervention-backend-rejected');
      }
      context.push({ type: 'run/intervention-updated', intervention: updated });
      return ok(requestId, command.type, { intervention: updated });
    }
    case 'run/intervention-cancel': {
      const store = await context.getTranscriptStore(command.sessionId);
      const existing = await store.getRunIntervention(command.interventionId);
      if (!existing || existing.runId !== command.runId) {
        return fail(requestId, command.type, 'intervention-not-found');
      }
      const cancelled = await store.transitionRunIntervention({
        interventionId: command.interventionId,
        expectedRevision: command.expectedRevision,
        from: ['pending'],
        to: 'cancelled',
        updatedAt: new Date().toISOString(),
      });
      if (!cancelled) {
        await resyncStaleIntervention(context, store, command.interventionId);
        return fail(requestId, command.type, 'intervention-revision-conflict');
      }
      await context
        .requireSession(command.sessionId)
        .cancelRunIntervention?.(command.interventionId, command.expectedRevision)
        .catch(() => false);
      context.push({ type: 'run/intervention-updated', intervention: cancelled });
      return ok(requestId, command.type, { intervention: cancelled });
    }
    case 'session/steer': {
      const active = context.getForegroundRun(command.sessionId);
      if (!active) {
        return fail(
          requestId,
          'session/steer',
          `no-active-run: session ${command.sessionId} has no foreground run`,
        );
      }
      if (context.isPauseRequested(active.runId) || active.phase === 'pausing') {
        return fail(requestId, 'session/steer', 'run-pausing: steer is unavailable while pausing');
      }
      if (command.runId !== undefined && command.runId !== active.runId) {
        return fail(
          requestId,
          'session/steer',
          `run-mismatch: requested ${command.runId}, active ${active.runId}`,
        );
      }
      const agentSteer =
        command.source === 'voice-delegation'
          ? wrapLiveDelegationForAgent(command.message, {
              firstForCall: shouldInjectLiveWorkPreamble(command.voiceCallId),
            })
          : command.message;
      await context.requireSession(command.sessionId).steer(agentSteer);
      const userMessageId = command.clientMessageId?.trim() || randomUUID();
      await context.recordUserPrompt(command.sessionId, {
        text: command.message,
        clientMessageId: userMessageId,
        ...(command.source === 'voice-delegation'
          ? {
              source: 'voice-delegation' as const,
              ...(command.voiceCallId ? { voiceCallId: command.voiceCallId } : {}),
            }
          : {}),
      });
      const steerAssembly = createModelPromptAssembly();
      steerAssembly.add({
        kind: 'user',
        label: 'Steer',
        trustOrigin: 'user',
        text: command.message,
      });
      await persistAndPushAssembly({
        ...(context.piwinRoot === undefined ? {} : { piwinRoot: context.piwinRoot }),
        summary: steerAssembly.toSummary({
          sessionId: command.sessionId,
          runId: active.runId,
          requestClass: 'steer',
          requestOrdinal: await context.nextModelRequestOrdinal(command.sessionId),
          userMessageId,
        }),
        push: context.push,
      });
      return ok(requestId, 'session/steer', {
        sessionId: command.sessionId,
        runId: active.runId,
      });
    }
    case 'session/follow_up': {
      const active = context.getForegroundRun(command.sessionId);
      if (!active) {
        return fail(
          requestId,
          'session/follow_up',
          `no-active-run: session ${command.sessionId} has no foreground run`,
        );
      }
      if (context.isPauseRequested(active.runId) || active.phase === 'pausing') {
        return fail(
          requestId,
          'session/follow_up',
          'run-pausing: follow-up is unavailable while pausing',
        );
      }
      // Follow-up starts work through the live session, so it must carry
      // an explicit owner. This prevents events from an unowned request
      // being correlated with whichever run happens to be current later.
      if (command.runId !== active.runId) {
        return fail(
          requestId,
          'session/follow_up',
          `run-mismatch: requested ${command.runId ?? '<missing>'}, active ${active.runId}`,
        );
      }
      await context.requireSession(command.sessionId).followUp(command.message);
      const userMessageId = command.clientMessageId?.trim() || randomUUID();
      await context.recordUserPrompt(command.sessionId, {
        text: command.message,
        clientMessageId: userMessageId,
      });
      // Same run, new request. The follow-up has a normal product user row so
      // its capsule remains addressable after reload, duplicate, and fork.
      const followUpAssembly = createModelPromptAssembly();
      followUpAssembly.add({
        kind: 'user',
        label: 'Follow-up',
        trustOrigin: 'user',
        text: command.message,
      });
      await persistAndPushAssembly({
        ...(context.piwinRoot === undefined ? {} : { piwinRoot: context.piwinRoot }),
        summary: followUpAssembly.toSummary({
          sessionId: command.sessionId,
          runId: active.runId,
          requestClass: 'follow-up',
          requestOrdinal: await context.nextModelRequestOrdinal(command.sessionId),
          userMessageId,
        }),
        push: context.push,
      });
      return ok(requestId, 'session/follow_up', {
        sessionId: command.sessionId,
        runId: active.runId,
      });
    }
    default:
      return null;
  }
}
