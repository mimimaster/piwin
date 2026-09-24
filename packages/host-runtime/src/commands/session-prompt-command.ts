/**
 * session/prompt admission and immediate acceptance.
 * Detached turn execution lives in session-turn-executor.ts.
 */
import type {
  ExecutionRunRecord,
  HostCommand,
  HostResponse,
  SessionRunAcceptedData,
} from '@piwin/contracts';
import {
  formatError,
  resolveOrchestrationScheme,
  OrchestrationSchemeError,
} from '@piwin/contracts';
import {
  createSupersededByNewPromptAbortReason,
  formatRunAbortReason,
} from '../run-abort-reason.js';
import { getSessionRecord, loadSessionPlan } from '@piwin/session';
import { fail, ok } from '../response-helpers.js';
import { rejectUnavailableSessionBody } from '../session-body-guard.js';
import { sessionBusyResponse } from '../session-body-gate.js';
import { getPiwinRoot, getPiwinSessionIndexPath, getPiwinSessionPlanPath } from '../paths.js';
import type { SessionLiveContext } from './session-live-context.js';
import { type PromptCommand } from './prompt-preparation.js';
import { finalizeSupersededTurn } from './run-control-commands.js';
import {
  createForegroundRunMismatch,
  evaluatePromptForegroundAdmission,
  formatForegroundRunMismatchError,
  isForegroundRunActiveError,
} from './session-prompt-admission.js';
import { listKnownChatModelKeys } from './prompt-preparation.js';
import { executeSessionTurn } from './session-turn-executor.js';
import { requestedTurnPolicy } from './pause-turn-policy.js';
import { rebaseForPromptTree } from './session-prompt-rebase.js';
import { resolveSessionTurnProfile } from './session-turn-profile.js';

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
          : null;
      const planPath = persistedPlanIntent
        ? getPiwinSessionPlanPath(getPiwinRoot(context.piwinRoot), command.sessionId)
        : undefined;
      const startingPlan = planPath ? await loadSessionPlan(planPath) : null;
      const startingPlanRevision = startingPlan?.revision ?? -1;
      const activeCheckpoint = await context.getActivePauseCheckpoint(command.sessionId);
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
      // ADR 0055 / 0064: branch or retry moves the leaf before run
      // registration. A bad target or an active run fails the request.
      const treeRefusal = await rebaseForPromptTree(context, command, requestId);
      if (treeRefusal !== null) {
        return treeRefusal;
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
      // Desired = input.model ?? index record ?? last-applied. Voice-delegation
      // omits input.model; Host still applies the desired composer profile.
      const turnProfile = resolveSessionTurnProfile({
        input: command.input,
        record: promptRecord,
        appliedModel: context.sessionModels.get(command.sessionId),
        hasLiveHandle: context.sessions.has(command.sessionId),
      });
      const { previousModel, desiredModel, desiredThinkingLevel } = turnProfile;
      // A session MCP switch changes the frozen tool surface, which only a
      // rebuilt generation can pick up — same detached replacement path as a
      // cross-Provider model switch.
      const requiresModelRuntimeReplacement =
        turnProfile.requiresModelRuntimeReplacement ||
        (context.sessions.has(command.sessionId) &&
          context.sessionMcpOverrideChanged?.(
            command.sessionId,
            promptRecord?.disabledMcpServerIds,
          ) === true);
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
          context.updateRunPhase(liveRun.runId, 'cancelling', 'Superseded by a newer user message');
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
      context.setRunTurnPolicy?.(run.runId, requestedTurnPolicy(command.input, conversationChat));
      context.updateRunPhase(run.runId, 'preparing');

      // Preparation and the provider turn are deliberately detached from the
      // request path. runWithContext owns the async context, while the
      // executor owns the run's single terminal transition.
      context.runWithContext(run.runId, async () => {
        await executeSessionTurn({
          context,
          command,
          run,
          conversationChat,
          persistedPlanIntent,
          planPath,
          startingPlanRevision,
          previousModel,
          requiresModelRuntimeReplacement,
          desiredModel,
          desiredThinkingLevel,
          supersededRun,
          supersededCheckpointId:
            command.input.source === 'resume' ? undefined : activeCheckpoint?.checkpointId,
        });
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
