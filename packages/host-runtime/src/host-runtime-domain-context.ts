/**
 * Extracted from HostRuntime. Behavior is unchanged; HostRuntime remains
 * the composition root and calls these functions with a kernel view of `this`.
 */

import { randomUUID } from 'node:crypto';

import { loadSessionPlan, PlanMutationError } from '@piwin/session';
import type { SessionPlan } from '@piwin/contracts';
import { loadPiwinConfig } from './config-store.js';
import { getPiwinRoot, getPiwinSessionPlanPath } from './paths.js';
import type { HostCommandContext } from './commands/host-command-context.js';
import { type WalkthroughCommandContext } from './commands/walkthrough-commands.js';
import { createTwoStageCompleteJson } from './doccards-draft-cards.js';
import { openDoccardReviewSession } from './doccards-review-session.js';
import type { SubagentBatchRequest, SubagentReviewRef } from '@piwin/contracts';
import { findPersistedReview } from './subagent-review-service.js';

import type { HostRuntimeKernel } from './host-runtime-kernel.js';
import { cancelRunsForSubscriptionProvider } from './cancel-subscription-runs.js';
import { readOpenaiCodexLiveAuth } from './voice/codex-live-token.js';

/**
 * Builds the WalkthroughCommandContext seam (spec §11.1) shared by the SDK
 * and RPC adapters. The seam reads config/transcript/plan from disk and the
 * live session model from the in-memory map, so walkthrough handlers never
 * depend on HostRuntime directly.
 */
export function buildWalkthroughContext(deps: HostRuntimeKernel): WalkthroughCommandContext {
  return {
    ...(deps.options.piwinRoot !== undefined ? { piwinRoot: deps.options.piwinRoot } : {}),
    push: (message) => deps.push(message),
    loadTranscriptMessages: (sessionId) => deps.loadTranscriptMessages(sessionId),
    getTranscriptMessage: (sessionId, messageId) =>
      deps.withTranscriptStore(sessionId, (store) => store.getMessage(messageId)),
    hasLaterAssistant: (sessionId, messageId, runId) =>
      deps.withTranscriptStore(sessionId, (store) => store.hasLaterAssistant(messageId, runId)),
    loadSessionPlan: (sessionId) => deps.loadSessionPlanForWalkthrough(sessionId),
    loadConfig: () => loadPiwinConfig(deps.options.piwinRoot),
    resolveSessionModel: (sessionId) => deps.sessionModels.get(sessionId),
  };
}

export async function loadSessionPlanForWalkthrough(
  deps: HostRuntimeKernel,
  sessionId: string,
): Promise<SessionPlan | null> {
  const rootDir = getPiwinRoot(deps.options.piwinRoot);
  const planPath = getPiwinSessionPlanPath(rootDir, sessionId);
  return loadSessionPlan(planPath);
}

function buildFlashcardStudyContext(
  deps: HostRuntimeKernel,
): import('./commands/flashcard-study-commands.js').FlashcardStudyCommandContext {
  const idempotencyKey = deps.commandRequestStore.getStore()?.idempotencyKey;
  return {
    getStudyService: () => deps.getStudyService(),
    controllerIdentity: deps.devicePrincipalStore.getStore() ?? 'local',
    ...(idempotencyKey ? { idempotencyKey } : {}),
  };
}

export async function buildDomainContext(
  deps: HostRuntimeKernel,
): Promise<import('./commands/domain-command-dispatch.js').DomainDispatchContext> {
  const subagentOrchestrator = deps.subagentOrchestrator;
  const hostContext: HostCommandContext = {
    ...(deps.options.piwinRoot !== undefined ? { piwinRoot: deps.options.piwinRoot } : {}),
    ...(deps.turnChangeRuntime
      ? {
          workspaceWriteGate: deps.turnChangeRuntime.gate,
          turnChangeRuntime: deps.turnChangeRuntime,
        }
      : {}),
    push: (message) => deps.push(message),
    requireSession: (sessionId) => deps.requireSession(sessionId),
    requireDurableSession: (sessionId) => deps.requireDurableSession(sessionId),
    getMcpManager: () => deps.getMcpManager(),
    getLoadedExtensions: (sessionId) => deps.runtimeController.getLoadedExtensions(sessionId),
    listLoadedExtensionRevisions: () => deps.runtimeController.listLoadedExtensionRevisions(),
    getJobController: () => deps.getJobController(),
    getBrowserSession: () => deps.browserSession ?? undefined,
    ensureBrowserSession: () => deps.ensureBrowserSession(),
    todoStore: deps.todoStore,
    petStateStore: await deps.ensurePetStateStore(),
    runCronJob: (job) => deps.runCronJob(job),
    pendingPermissions: deps.pendingPermissions,
    pendingExtensionUi: deps.pendingExtensionUi,
    rememberProjectPermission: (sessionId, action, detail, scope, projectPath) =>
      deps.rememberProjectPermission(sessionId, action, detail, scope, projectPath),
    rememberSessionPermission: (sessionId, action, detail) =>
      deps.rememberSessionPermission(sessionId, action, detail),
    isSessionBodyReserved: (sessionId) => deps.sessionBodyGate.isReserved(sessionId),
    sessionPermissionOverrides: deps.sessionPermissionOverrides,
    setSessionPermissionOverride: (sessionId, mode) =>
      deps.setSessionPermissionOverride(sessionId, mode),
    clearSessionPermissionOverride: (sessionId) => deps.clearSessionPermissionOverride(sessionId),
    planExecution: {
      promptSession: (sessionId, text, parentRunId) =>
        deps.promptPlanSession(sessionId, text, parentRunId),
      abortSession: (sessionId) => deps.abortPlanSession(sessionId),
      startPlanRun: (sessionId, planId) => {
        if (deps.runRegistry.getForegroundRun(sessionId)) {
          throw new PlanMutationError(
            '当前会话仍在运行，请等待本轮结束后再执行计划。',
          );
        }
        const generationId =
          deps.runtimeController.getStatus(sessionId).generationId ??
          `plan-generation-${randomUUID()}`;
        const run = deps.runRegistry.create({
          kind: 'plan-execution',
          sessionId,
          planId,
          runtimeGenerationId: generationId,
        });
        const started = deps.runRegistry.start(run.runId);
        if (!started) {
          throw new Error(`plan Run failed to start: ${run.runId}`);
        }
        return { runId: started.runId };
      },
      finishPlanRun: (runId, status, error) => {
        deps.runRegistry.terminate(runId, status, status, error);
      },
      cancelPlanRun: (runId) => {
        if (runId) {
          deps.subagentOrchestrator?.cancelBatchesForParentRun(runId);
          deps.runRegistry.cancelRun(runId);
        }
      },
      mergeBatchSummaries: async (parentSessionId, results) => {
        for (const result of results) {
          const childSessionId = result.childSessionId;
          if (!childSessionId || !result.summaryPreview) continue;
          deps.subagentTaskResults.set(childSessionId, result);
          const messageId = randomUUID();
          const alreadyMerged = await deps.persistSubagentMerge(
            parentSessionId,
            childSessionId,
            result,
            messageId,
          );
          if (!alreadyMerged) {
            deps.push({
              type: 'subagent/merged',
              parentSessionId,
              childSessionId,
              messageId,
            });
          }
        }
      },
      runBatch: async (request, parentRunId) => {
        if (!deps.subagentOrchestrator) {
          return {
            runId: 'no-orchestrator',
            status: 'failed' as const,
            results: request.tasks.map((task) => ({
              runId: 'no-orchestrator',
              taskId: task.id,
              executionStatus: 'failed' as const,
              summaryStatus: 'not-requested' as const,
              integrationStatus: 'not-requested' as const,
            })),
          };
        }
        // ORCH §8.4: clamp multi-task batches under an active parent scheme.
        let batchRequest = request;
        const activeScheme = parentRunId
          ? deps.runOrchestrationSchemes.get(parentRunId)
          : undefined;
        if (activeScheme) {
          if (request.tasks.length > activeScheme.maxTasksPerRun) {
            throw new Error(
              `orchestration scheme maxTasksPerRun (${activeScheme.maxTasksPerRun}) exceeded for this turn`,
            );
          }
          const clampedConcurrency = Math.min(
            request.maxConcurrency ?? activeScheme.maxConcurrency,
            activeScheme.maxConcurrency,
          );
          batchRequest = {
            ...request,
            maxConcurrency: Math.max(1, clampedConcurrency),
          };
        }
        const preparedRequest = await deps.prepareSubagentBatch(batchRequest, 'plan');
        const handle = deps.subagentOrchestrator.startBatch(preparedRequest, parentRunId);
        return handle.completion;
      },
    },
    walkthrough: {
      context: deps.buildWalkthroughContext(),
      registry: deps.walkthroughRegistry,
    },
    knowledge: {
      getNotesServices: () => deps.getNotesServices(),
      getCardStore: () => deps.getCardStore(),
      getFolderRag: () => deps.getFolderRag(),
      loadConfig: () => loadPiwinConfig(deps.options.piwinRoot),
      push: (message) => deps.push(message),
      ingestionJobs: deps.doccardsIngestion,
      generationJobs: deps.doccardsGeneration,
      completeJson: createTwoStageCompleteJson(() => loadPiwinConfig(deps.options.piwinRoot)),
      openReviewSession: (input) =>
        openDoccardReviewSession({
          ...input,
          createSession: (createInput) => deps.createSession(createInput),
          bindSession: (session, projectPath, sessionName, lineage) =>
            deps.bindSession(session, projectPath, sessionName, lineage),
          getTranscriptStore: (sessionId, projectPath) =>
            deps.transcriptStores.get(sessionId, projectPath),
        }),
      ...(deps.options.piwinRoot ? { piwinRoot: deps.options.piwinRoot } : {}),
    },
    flashcardStudy: buildFlashcardStudyContext(deps),
    ...(deps.subscriptionAuth ? { subscriptionAuth: deps.subscriptionAuth } : {}),
    devicePrincipalId: deps.devicePrincipalStore.getStore() ?? 'local',
    cancelRunsForProvider: (providerId) => cancelRunsForSubscriptionProvider(deps, providerId),
    ...(subagentOrchestrator
      ? {
          subagent: {
            prepareBatch: (request: SubagentBatchRequest) => deps.prepareSubagentBatch(request),
            startBatch: (request: SubagentBatchRequest, parentRunId?: string) =>
              subagentOrchestrator.startBatch(request, parentRunId),
            getBatchProjection: (runId: string) =>
              subagentOrchestrator.getBatchProjectionAsync(runId),
            cancelBatch: (runId: string, options?: { initiator?: 'user' }) =>
              subagentOrchestrator.cancelBatch(runId, options),
            continueChild: (childSessionId: string, text: string) =>
              deps.continueSubagentChild(subagentOrchestrator, childSessionId, text),
            actOnWorktree: (childSessionId: string, action: 'apply' | 'retain' | 'discard') =>
              deps.actOnSubagentWorktree(childSessionId, action),
            previewWorktreeGc: () => {
              const gc = deps.subagentWorktreeGc;
              if (!gc) {
                return Promise.reject(new Error('subagent worktree gc is not ready'));
              }
              return gc.preview();
            },
            reclaimWorktreeGc: () => {
              const gc = deps.subagentWorktreeGc;
              if (!gc) {
                return Promise.reject(new Error('subagent worktree gc is not ready'));
              }
              return gc.reclaim({ mode: 'manual' });
            },
            ...(deps.subagentResultService
              ? {
                  resultService: deps.subagentResultService,
                  startParentPrompt: async (input: {
                    parentSessionId: string;
                    text: string;
                    resultId: string;
                  }) => {
                    const accepted = await deps.promptPlanSession(
                      input.parentSessionId,
                      input.text,
                    );
                    return { runId: accepted.runId };
                  },
                  applyResult: async (input: {
                    resultId: string;
                    expectedRevision: number;
                    operationId: string;
                  }) => {
                    const summary = deps.subagentResultService?.get(input.resultId);
                    const childSessionId = summary?.childSessionId;
                    if (!childSessionId) {
                      throw new Error(`subagent result not found: ${input.resultId}`);
                    }
                    const outcome = await deps.actOnSubagentWorktree(childSessionId, 'apply');
                    return {
                      operationId: input.operationId,
                      status: outcome.applyStatus,
                    };
                  },
                  loadReview: async (ref: SubagentReviewRef) =>
                    deps.subagentRunStore
                      ? findPersistedReview(deps.subagentRunStore, ref)
                      : undefined,
                }
              : {}),
          },
        }
      : {}),
  };
  return {
    ...hostContext,
    ...(deps.liveCallCoordinator ? { liveCallCoordinator: deps.liveCallCoordinator } : {}),
    ...(deps.liveIntendedSession ? { liveIntendedSession: deps.liveIntendedSession } : {}),
    ...(deps.liveSettings ? { liveSettings: deps.liveSettings } : {}),
    resolveOwnerDeviceId: () => deps.devicePrincipalStore.getStore() ?? 'local',
    refreshLivePrereqs: async () => {
      const config = await loadPiwinConfig(deps.options.piwinRoot);
      deps.liveEnabledFromConfig = true;
      try {
        await deps.subscriptionAuth?.refreshProvider('openai-codex');
      } catch {
        // Presence still comes from the refreshed-or-stale file read.
      }
      deps.codexLiveAuthPresent = (await readOpenaiCodexLiveAuth()) !== null;
    },
    sessionProduct: {
      ...(deps.options.piwinRoot !== undefined ? { piwinRoot: deps.options.piwinRoot } : {}),
      createSession: (input) => deps.createSession(input),
      loadTranscriptMessages: (sessionId) => deps.loadTranscriptMessages(sessionId),
      getTranscriptStore: (sessionId, projectPath) =>
        deps.getTranscriptStore(sessionId, projectPath),
      withTranscriptStore: (sessionId, operation, projectPath) =>
        deps.withTranscriptStore(sessionId, operation, projectPath),
      abortLiveSession: (sessionId) => deps.abortLiveSession(sessionId),
      disposeLiveSession: (sessionId) => deps.disposeLiveSession(sessionId),
      archiveSession: (sessionId) => deps.archiveSessionForMaintenance(sessionId),
      tryArchiveLifecycleCandidate: (input) => deps.tryArchiveLifecycleCandidate(input),
      deleteSession: (sessionId) => deps.deleteSessionForMaintenance(sessionId),
      bindSession: (session, projectPath, sessionName, lineage) =>
        deps.bindSession(session, projectPath, sessionName, lineage),
      push: (message) => deps.push(message),
      pushStatus: () => deps.pushStatus(),
      tryReserveSessionBody: (sessionId) => deps.sessionBodyGate.tryReserve(sessionId),
      releaseSessionBody: (sessionId) => deps.sessionBodyGate.release(sessionId),
      isSessionBodyReserved: (sessionId) => deps.sessionBodyGate.isReserved(sessionId),
      getForegroundRun: (sessionId) => deps.runRegistry.getForegroundRun(sessionId),
      getContextSnapshot: (sessionId) => deps.sessionContextCoordinator.getSnapshot(sessionId),
    },
    sessionPack: {
      ...(deps.options.piwinRoot !== undefined ? { piwinRoot: deps.options.piwinRoot } : {}),
      withTranscriptMaintenance: (sessionId, operation) =>
        deps.transcriptStores.withMaintenanceLease(sessionId, operation),
      isLiveSession: (sessionId) =>
        deps.runtimeController.hasActiveGeneration(sessionId) || deps.sessions.has(sessionId),
    },
    sessionColdStorage: {
      ...(deps.options.piwinRoot !== undefined ? { piwinRoot: deps.options.piwinRoot } : {}),
      withTranscriptMaintenance: (sessionId, operation) =>
        deps.transcriptStores.withMaintenanceLease(sessionId, operation),
      storageCoordinator: deps.sessionStorageCoordinator,
      isLiveSession: (sessionId) =>
        deps.runtimeController.hasActiveGeneration(sessionId) || deps.sessions.has(sessionId),
      rememberPlan: (plan) => {
        deps.coldStoragePlans.set(plan.planId, plan);
      },
      takePlan: (planId) => deps.coldStoragePlans.get(planId),
    },
  };
}
