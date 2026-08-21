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
import { rejectUnavailableSessionBody } from '../session-body-guard.js';
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
import { scheduleReplyWriterAfterRun } from './reply-writer-live.js';
import { compactLiveSessionForTarget } from './compaction-live.js';
import {
  injectProductHistoryOnce,
  persistSessionComposerProfile,
  preparePromptInput,
  type PromptCommand,
  throwIfPromptPreparationAborted,
} from './prompt-preparation.js';
import { injectBranchCalibrationOnce } from './branch-calibration.js';
import { finalizeAbortedRun, finalizeSupersededTurn } from './run-control-commands.js';
import { pushBranchUpdated } from './session-branch-commands.js';
import {
  createForegroundRunMismatch,
  evaluatePromptForegroundAdmission,
  formatForegroundRunMismatchError,
  isForegroundRunActiveError,
} from './session-prompt-admission.js';
import { listKnownChatModelKeys } from './prompt-preparation.js';

/**
 * ADR 0055 branch prompt: move the active leaf to the target user row's
 * parent so the recorded prompt becomes its sibling branch. Returns a
 * failure response when branching is impossible; null continues the prompt.
 */
async function rebaseForBranchPrompt(
  context: SessionLiveContext,
  command: PromptCommand,
  requestId: string | undefined,
): Promise<HostResponse | null> {
  const targetId = command.input.branchFromMessageId;
  if (targetId === undefined) return null;
  if (context.getForegroundRun(command.sessionId)) {
    return fail(
      requestId,
      'session/prompt',
      `run-active: cannot branch from ${targetId} while a run is active`,
    );
  }
  // session/prompt is not a transcript-leased command, and disposeLiveSession
  // below closes the cached store — validate on one handle, then re-acquire.
  const probe = await context.getTranscriptStore(command.sessionId);
  const target = await probe.getMessage(targetId);
  if (target === undefined) {
    return fail(requestId, 'session/prompt', `branch-target-not-found: ${targetId}`);
  }
  if (target.role !== 'user') {
    return fail(requestId, 'session/prompt', `branch-target-not-user: ${targetId}`);
  }
  const parentId = await probe.getParentMessageId(targetId);
  if (parentId === undefined) {
    return fail(requestId, 'session/prompt', `branch-target-not-found: ${targetId}`);
  }
  // The live generation replayed the abandoned branch's context; dispose so
  // the cold prompt path reseeds along the new branch (ADR 0040 §7).
  await context.disposeLiveSession(command.sessionId, 'branch-switch');
  const store = await context.getTranscriptStore(command.sessionId);
  await store.rebaseActiveLeaf(parentId);
  await pushBranchUpdated(context, command.sessionId, store);
  return null;
}

export async function handleSessionPromptCommand(
  command: HostCommand,
  requestId: string | undefined,
  context: SessionLiveContext,
): Promise<HostResponse | null> {
  switch (command.type) {
    case 'session/prompt': {
      const promptRecord = await getSessionRecord(
        getPiwinSessionIndexPath(getPiwinRoot(context.piwinRoot)),
        command.sessionId,
      );
      if (promptRecord) {
        const rejectedPrompt = rejectUnavailableSessionBody(
          requestId,
          'session/prompt',
          promptRecord,
          'prompt',
        );
        if (rejectedPrompt) {
          return rejectedPrompt;
        }
      }
      if (context.isSessionBodyReserved(command.sessionId)) {
        return sessionBusyResponse(requestId, 'session/prompt', command.sessionId, 'body-job');
      }
      // CHT-301: durable, Host-owned conversation classification. The client
      // cannot opt a pure-chat Conversation into agent semantics by sending
      // stale agent-only fields — they are ignored, not honored.
      const conversationChat =
        (await context.resolveIsConversationChat?.(command.sessionId)) === true;
      const persistedPlanIntent = conversationChat
        ? null
        : command.input.skillId === 'writing-plans'
          ? ('writing-plans-skill' as const)
          : command.input.agentMode === 'plan'
            ? ('plan-mode' as const)
            : null;
      const planPath = persistedPlanIntent
        ? getPiwinSessionPlanPath(getPiwinRoot(context.piwinRoot), command.sessionId)
        : undefined;
      const startingPlan = planPath ? await loadSessionPlan(planPath) : null;
      const startingPlanRevision = startingPlan?.revision ?? -1;
      const activeCheckpoint = await context.getActivePauseCheckpoint(command.sessionId);
      if (command.input.source !== 'resume' && activeCheckpoint !== undefined) {
        return fail(
          requestId,
          'session/prompt',
          `paused-run: session ${command.sessionId} has resumable checkpoint ${activeCheckpoint.checkpointId}`,
        );
      }
      if (command.input.source === 'resume') {
        if (
          command.input.resumeCheckpointId === undefined ||
          activeCheckpoint?.checkpointId !== command.input.resumeCheckpointId
        ) {
          return fail(
            requestId,
            'session/prompt',
            'resume-checkpoint-mismatch: continuation does not own the active checkpoint',
          );
        }
      }
      // ADR 0055: a branch prompt replaces an existing user turn as a sibling
      // branch. Validate and rebase before any run registration — a bad
      // target or an active run fails the request, never a silent fallback
      // to the current path.
      if (command.input.branchFromMessageId !== undefined) {
        const branchRefusal = await rebaseForBranchPrompt(context, command, requestId);
        if (branchRefusal !== null) {
          return branchRefusal;
        }
      }
      // Product: a newer user message supersedes an in-flight run (Stop is
      // optional) unless a remote shell sent an explicit foreground gate.
      const existingRun = context.getForegroundRun(command.sessionId);
      if (existingRun && command.admission === 'queued-turn') {
        return fail(
          requestId,
          'session/prompt',
          `run-active: queued turn cannot admit while ${existingRun.runId} is foreground`,
        );
      }

      // Validate the durable session record before registering ownership
      // (ADR 0040 §1). A bound live handle is already validated; a cold
      // prompt must pass a durable index record — prompting must not require
      // an already-bound handle, since the detached Run activates it on
      // demand. Everything after this point is tracked preparation and must
      // not delay the ack.
      if (!context.sessions.has(command.sessionId)) {
        const durableRecord = await getSessionRecord(
          getPiwinSessionIndexPath(getPiwinRoot(context.piwinRoot)),
          command.sessionId,
        );
        if (!durableRecord) {
          return fail(requestId, 'session/prompt', `Unknown session: ${command.sessionId}`);
        }
      }
      // Validate synchronous security-sensitive input before accepting the
      // run. Preparation may move to the background, but invalid media
      // paths must still fail the request instead of becoming an async
      // terminal error after the UI has shown an accepted run.
      try {
        context.validatePromptAttachments(command.input);
      } catch (error) {
        const message = formatError(error);
        return fail(requestId, 'session/prompt', message);
      }
      // ORCH: fail closed on unknown/invalid scheme before accepting the run.
      // CHT-302: conversations ignore the field entirely — a stale id must
      // neither widen capabilities nor fail the prompt.
      const orchId = command.input.orchestrationSchemeId?.trim();
      if (!conversationChat && orchId && orchId !== 'off') {
        try {
          const config = await context.loadConfig();
          const knownProfileIds = await context.listKnownSubagentProfileIds();
          const subagents = config.subagents;
          resolveOrchestrationScheme(
            {
              schemes: subagents?.schemes,
              maxConcurrency: subagents?.maxConcurrency,
              maxTasksPerRun: subagents?.maxTasksPerRun,
            },
            orchId,
            {
              knownProfileIds,
              knownModelKeys: listKnownChatModelKeys(config),
              globalMaxConcurrency: subagents?.maxConcurrency,
              globalMaxTasksPerRun: subagents?.maxTasksPerRun,
            },
          );
        } catch (error) {
          const message =
            error instanceof OrchestrationSchemeError ? error.message : formatError(error);
          return fail(requestId, 'session/prompt', message);
        }
      }
      // CHT-303: conversations never prepare a Subagent runtime. Agent
      // rebuilds stay on the detached Run path below so this ack cannot
      // wait on disposeLiveSession.
      // A live SDK/RPC generation owns the Provider envelope compiled at its
      // creation. If the next turn selects another Provider, the old
      // generation cannot resolve that model even though the durable config
      // can. Keep this Run detached from the old generation while Host builds
      // the replacement below; same-Provider model switches still use Pi's
      // native setModel path without a rebuild.
      const previousModel = command.input.model
        ? context.sessionModels.get(command.sessionId)
        : undefined;
      const requiresModelRuntimeReplacement =
        command.input.model !== undefined &&
        context.sessions.has(command.sessionId) &&
        (previousModel === undefined ||
          previousModel.providerId !== command.input.model.providerId);
      const explicitForeground = command.foreground;
      let reservedAdmission = false;
      if (explicitForeground !== undefined) {
        if (!context.tryReservePromptAdmission(command.sessionId)) {
          const transitioning = evaluatePromptForegroundAdmission({
            admission: explicitForeground,
            existingRun: context.getForegroundRun(command.sessionId),
            reserved: true,
          });
          if (transitioning === undefined) {
            return fail(requestId, 'session/prompt', 'foreground-run-mismatch: transitioning');
          }
          return fail(
            requestId,
            'session/prompt',
            formatForegroundRunMismatchError(transitioning),
            transitioning,
          );
        }
        reservedAdmission = true;
      }

      let run: ExecutionRunRecord;
      let supersededRun: ExecutionRunRecord | undefined;
      try {
        const liveRun = context.getForegroundRun(command.sessionId);
        if (explicitForeground !== undefined) {
          const admissionProblem = evaluatePromptForegroundAdmission({
            admission: explicitForeground,
            existingRun: liveRun,
            reserved: false,
          });
          if (admissionProblem !== undefined) {
            return fail(
              requestId,
              'session/prompt',
              formatForegroundRunMismatchError(admissionProblem),
              admissionProblem,
            );
          }
          if (explicitForeground.kind === 'replace-run') {
            supersededRun = liveRun;
          }
        } else if (liveRun) {
          // Same as replace-run: admit the new Run first, terminalize the old
          // turn after the ack. Awaiting finalizeCancelledRun here blocks the
          // prompt ACK on provider abort / process teardown and paints
          // "Host 还没确认" while the socket is fine.
          const supersedeReason = createSupersededByNewPromptAbortReason();
          context.updateRunPhase(
            liveRun.runId,
            'cancelling',
            'Superseded by a newer user message',
          );
          context.requestCancelRun(command.sessionId, liveRun.runId, supersedeReason);
          context.settlePendingPermissionsForSession(command.sessionId);
          context.settlePendingExtensionUiForSession(command.sessionId);
          supersededRun = liveRun;
        }
        const resumeCheckpointId =
          command.input.source === 'resume' ? command.input.resumeCheckpointId : undefined;
        const registerOptions = requiresModelRuntimeReplacement
          ? { deferRuntimeGeneration: true }
          : undefined;
        try {
          run =
            supersededRun === undefined
              ? context.registerForegroundRun(
                  command.sessionId,
                  resumeCheckpointId,
                  registerOptions,
                )
              : context.replaceForegroundRun(
                  command.sessionId,
                  supersededRun.runId,
                  resumeCheckpointId,
                  registerOptions,
                );
        } catch (error) {
          if (explicitForeground !== undefined && isForegroundRunActiveError(error)) {
            const current = context.getForegroundRun(command.sessionId);
            const problem = createForegroundRunMismatch(
              reservedAdmission ? 'transitioning' : 'active',
              current,
            );
            return fail(
              requestId,
              'session/prompt',
              formatForegroundRunMismatchError(problem),
              problem,
            );
          }
          return fail(requestId, 'session/prompt', formatError(error));
        }
      } finally {
        if (reservedAdmission) {
          context.releasePromptAdmission(command.sessionId);
        }
      }

      const acceptedAt = new Date().toISOString();
      context.updateRunPhase(run.runId, 'accepted');
      context.updateRunPhase(run.runId, 'preparing');

      // Preparation and the provider turn are deliberately detached from the
      // request path. runWithContext owns the async context, while this
      // callback owns the run's single terminal transition.
      context.runWithContext(run.runId, async () => {
        try {
          if (!conversationChat) {
            const delegationMode =
              command.input.delegationMode === 'disabled' ? 'disabled' : 'auto';
            await context.prepareDelegationRuntime?.(command.sessionId, delegationMode);
            if (context.getRunSignal(run.runId)?.aborted) {
              await finalizeAbortedRun(context, command.sessionId, run.runId);
              return;
            }
          }
          if (command.input.model) {
            await compactLiveSessionForTarget(
              context,
              command.sessionId,
              command.input.model,
              estimatePendingPromptTokens({
                text: command.input.text,
                ...(command.input.attachments
                  ? { attachmentCount: command.input.attachments.length }
                  : {}),
                ...(command.input.contextRefs
                  ? { contextRefCount: command.input.contextRefs.length }
                  : {}),
              }),
            );
          }
          const assembly = createModelPromptAssembly();
          const { promptInput, userMessageId } = await preparePromptInput(
            context,
            command,
            run,
            assembly,
            conversationChat,
          );
          if (context.getRunSignal(run.runId)?.aborted) {
            await finalizeAbortedRun(context, command.sessionId, run.runId);
            return;
          }

          if (requiresModelRuntimeReplacement) {
            try {
              await context.replaceRuntimeForModel(command.sessionId);
            } catch (error) {
              // The durable composer profile remains the user's requested
              // model, but keep the in-memory source marker aligned with the
              // still-live generation so the next prompt retries replacement
              // instead of sending the same missing Provider to the old one.
              if (previousModel === undefined) {
                context.sessionModels.delete(command.sessionId);
              } else {
                context.sessionModels.set(command.sessionId, previousModel);
              }
              throw error;
            }
            if (context.getRunSignal(run.runId)?.aborted) {
              await finalizeAbortedRun(context, command.sessionId, run.runId);
              return;
            }
          }

          if (supersededRun !== undefined) {
            await context.joinRun(supersededRun.runId);
            if (context.getRunSignal(run.runId)?.aborted) {
              await finalizeAbortedRun(context, command.sessionId, run.runId);
              return;
            }
          }

          // ADR 0040 §7: activate a cold runtime for the stable product
          // session id. The new generation is attached to this Run before
          // tool execution is admitted, so Host tool frames pass admission.
          const liveSession = await context.activateSessionRuntime(
            command.sessionId,
            run.runId,
            context.getRunSignal(run.runId),
            promptInput.clientMessageId,
          );
          if (context.getRunSignal(run.runId)?.aborted) {
            await finalizeAbortedRun(context, command.sessionId, run.runId);
            return;
          }

          // A reconstructed generation owns no native context: inject bounded
          // product history exactly once before provider execution. Later
          // turns reuse the backend's own conversation state.
          const historyBefore = promptInput.text;
          await injectProductHistoryOnce(context, command.sessionId, promptInput);
          if (promptInput.text !== historyBefore) {
            assembly.add({
              kind: 'product-history',
              label: 'Product history',
              trustOrigin: 'piwin',
              text: promptInput.text.slice(
                0,
                Math.max(0, promptInput.text.length - historyBefore.length),
              ),
            });
          }
          // Disk truth after a confirmed branch switch: its own ledger entry,
          // never accounted as product history.
          const calibrationBefore = promptInput.text;
          await injectBranchCalibrationOnce(context, command.sessionId, promptInput);
          if (promptInput.text !== calibrationBefore) {
            assembly.add({
              kind: 'runtime-observed',
              label: 'Branch calibration',
              trustOrigin: 'piwin',
              text: promptInput.text.slice(
                0,
                Math.max(0, promptInput.text.length - calibrationBefore.length),
              ),
            });
          }
          const summary = assembly.toSummary({
            sessionId: command.sessionId,
            runId: run.runId,
            requestClass: command.input.source === 'resume' ? 'pause-resume' : 'prompt',
            requestOrdinal: await context.nextModelRequestOrdinal(command.sessionId),
            ...(userMessageId === undefined ? {} : { userMessageId }),
          });
          await persistAndPushAssembly({
            ...(context.piwinRoot === undefined ? {} : { piwinRoot: context.piwinRoot }),
            summary,
            push: context.push,
          });
          if (context.getRunSignal(run.runId)?.aborted) {
            await finalizeAbortedRun(context, command.sessionId, run.runId);
            return;
          }

          await liveSession.prompt(promptInput);
          if (context.getRunSignal(run.runId)?.aborted) {
            await finalizeAbortedRun(context, command.sessionId, run.runId);
            return;
          }

          // Detect silent / failed completion: prompt() resolved without a
          // streamed answer. Prefer the upstream provider error when Pi already
          // emitted one (often via stopReason:'error'); only invent the generic
          // empty-response copy when nothing upstream arrived.
          const currentRun = context.getForegroundRun(command.sessionId);
          if (currentRun && !context.hasRunReceivedFirstToken(run.runId)) {
            const upstreamError = context.getRunLastAgentError(run.runId)?.trim();
            const failureMessage =
              upstreamError && upstreamError.length > 0
                ? upstreamError
                : 'The model produced no response. This may indicate an unavailable ' +
                  'model, invalid API key, or provider error. Check your provider ' +
                  'configuration and try again.';
            const alreadySurfaced = Boolean(upstreamError && upstreamError.length > 0);
            if (!alreadySurfaced) {
              const errorEvent = {
                type: 'error' as const,
                message: failureMessage,
                retriable: true,
                runId: run.runId,
              };
              // Persist before terminalizing: push alone fans out to shells and
              // does not write the transcript recorder.
              const recorder = context.transcriptRecorders.get(command.sessionId);
              if (recorder) {
                await recorder.recordEvent(errorEvent).catch(() => undefined);
                await recorder.flush().catch(() => undefined);
              }
              context.push({
                type: 'event',
                sessionId: command.sessionId,
                event: errorEvent,
              });
            }
            await context.terminateRun(
              command.sessionId,
              run.runId,
              'failed',
              undefined,
              failureMessage,
            );
            return;
          }

          if (planPath) {
            const completedPlan = await loadSessionPlan(planPath);
            if (
              !completedPlan ||
              completedPlan.revision <= startingPlanRevision ||
              (persistedPlanIntent === 'writing-plans-skill' &&
                (completedPlan.source !== 'skill' || completedPlan.skillId !== 'writing-plans'))
            ) {
              throw new Error(
                'plan-not-persisted: Plan mode and writing-plans must finish by creating or revising the durable SessionPlan with piwin_plan_create',
              );
            }
          }

          // Touch the index BEFORE the terminal event so the auto-name trigger
          // (fired from terminateRun) sees messageCount for the run that just
          // completed. Otherwise naming is delayed until the next exchange.
          if (command.input.source !== 'resume') {
            try {
              await context.touchSession(command.sessionId, command.input.text);
            } catch (error) {
              const message = formatError(error);
              context.push({
                type: 'host/log',
                level: 'warn',
                message: `session index touch failed: ${message}`,
              });
            }
          }
          await context.terminateRun(command.sessionId, run.runId, 'completed');
          void scheduleReplyWriterAfterRun(context, {
            sessionId: command.sessionId,
            runId: run.runId,
          });
        } catch (error) {
          if (context.getRunSignal(run.runId)?.aborted) {
            await finalizeAbortedRun(context, command.sessionId, run.runId);
            return;
          }
          const message = formatError(error);
          // ADR 0040 §4: a memory-pressure admission failure terminalizes the
          // Run with the stable code so clients can distinguish it from an
          // ordinary provider failure.
          const terminalCode =
            (error as { code?: string } | null)?.code === 'runtime-memory-pressure'
              ? ('runtime-memory-pressure' as const)
              : undefined;
          const errorEvent = {
            type: 'error' as const,
            message,
            retriable: true,
            runId: run.runId,
          };
          const recorder = context.transcriptRecorders.get(command.sessionId);
          if (recorder) {
            await recorder.recordEvent(errorEvent).catch(() => undefined);
            await recorder.flush().catch(() => undefined);
          }
          // Emit the agent error while the run is still foreground so Desktop
          // can stamp the assistant bubble before run/terminal marks the id stale.
          context.push({
            type: 'event',
            sessionId: command.sessionId,
            event: errorEvent,
          });
          await context.terminateRun(command.sessionId, run.runId, 'failed', terminalCode, message);
        }
      });

      const accepted: SessionRunAcceptedData = {
        sessionId: command.sessionId,
        runId: run.runId,
        acceptedAt,
      };
      if (supersededRun !== undefined) {
        const previous = supersededRun;
        setTimeout(() => {
          const supersedeReason = createSupersededByNewPromptAbortReason();
          context.updateRunPhase(
            previous.runId,
            'cancelling',
            'Superseded by a newer user message',
          );
          context.requestCancelRun(command.sessionId, previous.runId, supersedeReason);
          context.settlePendingPermissionsForSession(command.sessionId);
          context.settlePendingExtensionUiForSession(command.sessionId);
          void finalizeSupersededTurn(
            context,
            command.sessionId,
            previous.runId,
            formatRunAbortReason(supersedeReason),
            'superseded-by-new-prompt',
          );
        });
      }
      return ok(requestId, 'session/prompt', accepted);
    }
    default:
      return null;
  }
}
