/**
 * Extracted from HostRuntime. Behavior is unchanged; HostRuntime remains
 * the composition root and calls these functions with a kernel view of `this`.
 */

import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { formatError } from '@piwin/contracts';
import { resolveBundledSkillsRoot, scanSkills } from '@piwin/skills';

import { getSessionRecord } from '@piwin/session';
import { loadPiwinConfig } from './config-store.js';
import { getPiwinGeneralWorkspacePath, getPiwinRoot, getPiwinSessionIndexPath } from './paths.js';
import { SubagentOrchestrator } from './subagent-orchestrator.js';
import { planSubagentSpawn } from './subagent-lifecycle-service.js';
import { resolveSubagentProfiles } from './subagent-profile-resolver.js';
import { resolveChatModel } from './resolve-chat-model.js';
import type { SubagentDeliveryPolicySource } from './subagent-delivery-policy.js';
import type { SubagentRunSeam } from './subagent-run-tool.js';
import { createSubagentControlSeam, type SubagentControlDeps } from './host-runtime-subagent-start.js';
import { bindSubagentReviewTarget } from './subagent-review-context.js';
import {
  createSubagentReviewService,
  findPersistedReview,
  loadPersistedReviewObservation,
} from './subagent-review-service.js';
import { createSubagentVerificationService } from './subagent-verification-service.js';
import {
  applyReviewedSubagentResult,
  SubagentApplyOutcomeUnknownError,
} from './subagent-result-apply.js';
import { startReviewedContinuation } from './subagent-continue.js';
import { workspaceIdForRoot } from './turn-changes/coordinator.js';
import {
  buildShellContinuationTask,
  prepareRetainedSubagentContinuation,
} from './subagent-continuation-prep.js';
import { resolveFusionSidekickLane } from './fusion-sidekick-lane.js';
import { resolveSubagentBaseCommit } from './subagent-base-checkout.js';
import { discardSubagentResultForLead } from './subagent-result-discard.js';
import { resolveSubagentParentLocation } from './subagent-parent-scope.js';
import { handleSessionLiveCommand } from './commands/session-live-commands.js';
import {
  deliverDetachedReport,
  formatDetachedReport,
} from './detached-subagent-reports.js';
import {
  subagentApplyIdempotencyKey,
  subagentApplyRequestHash,
} from './subagent-apply-reservation.js';
import type { SubagentBatchRequest } from '@piwin/contracts';

export {
  buildShellContinuationTask,
  prepareRetainedSubagentContinuation,
};
export type {
  PreparedSubagentContinuation,
  SubagentContinuationPrepDeps,
} from './subagent-continuation-prep.js';

import {
  actOnSubagentWorktree,
  discardSubagentResult,
  resolveRetainedSubagentWorktreeLease,
  resolveSubagentContinuationRestore,
} from './host-runtime-subagent-worktree-results.js';
import type { HostRuntimeKernel } from './host-runtime-kernel.js';

/**
 * A detached tester finished: merge its child (the inline card and the
 * contract Result), queue the report, and deliver it once the session is idle.
 */
async function settleDetachedBatch(
  deps: HostRuntimeKernel,
  merge: SubagentRunSeam['merge'],
  input: {
    sessionId: string;
    runId: string;
    schemeId?: string;
    result: import('@piwin/contracts').SubagentBatchResult;
  },
): Promise<void> {
  for (const task of input.result.results) {
    let summaryPreview = task.summaryPreview;
    if (task.childSessionId) {
      try {
        const merged = await merge(task.childSessionId);
        summaryPreview = merged.summaryPreview ?? summaryPreview;
      } catch (error) {
        deps.push({
          type: 'host/log',
          level: 'warn',
          message: `detached subagent ${task.childSessionId} merge failed: ${formatError(error)}`,
        });
      }
    }
    // The tester's edits are never applied. Reclaim its copy now: left as a
    // pending candidate it would sit in the leftover-worktree inventory until
    // someone cleaned it by hand.
    if (task.childSessionId && task.worktreePath) {
      try {
        await actOnSubagentWorktree(deps, task.childSessionId, 'discard');
      } catch (error) {
        deps.push({
          type: 'host/log',
          level: 'warn',
          message: `detached subagent ${task.childSessionId} worktree cleanup failed: ${formatError(error)}`,
        });
      }
    }
    deps.detachedSubagents.addReport(
      input.sessionId,
      formatDetachedReport({
        runId: input.runId,
        executionStatus: task.executionStatus,
        ...(summaryPreview ? { summaryPreview } : {}),
        ...(task.error ? { error: task.error } : {}),
      }),
    );
  }
  await deliverDetachedReport(
    {
      registry: deps.detachedSubagents,
      getForegroundRunId: (sessionId) => deps.runRegistry.getForegroundRun(sessionId)?.runId,
      joinRun: (runId) => deps.runRegistry.join(runId),
      admitContinuation: async (sessionId, schemeId) => {
        const response = await handleSessionLiveCommand(
          {
            type: 'session/prompt',
            sessionId,
            input: {
              text: '',
              source: 'continuation',
              ...(schemeId ? { orchestrationSchemeId: schemeId } : {}),
            },
          },
          undefined,
          deps.buildSessionLiveContext(),
        );
        if (response?.success) return { success: true };
        return {
          success: false,
          error: response && !response.success ? response.error : 'prompt was not handled',
        };
      },
      push: (message) => deps.push(message),
    },
    input.sessionId,
    input.schemeId,
  );
}

export function getSubagentSeam(
  deps: HostRuntimeKernel,
  sessionId: string,
): SubagentRunSeam | undefined {
  if (!deps.subagentOrchestrator) return undefined;
  const activeRunId = deps.runExecutionContext.getStore();
  if (activeRunId && deps.runDelegationModes.get(activeRunId) === 'disabled') {
    return undefined;
  }
  const orchestrator = deps.subagentOrchestrator;

  const merge: SubagentRunSeam['merge'] = async (childSessionId) => {
    const result = deps.subagentTaskResults.get(childSessionId);
    if (!result) {
      throw new Error(`subagent result not found: ${childSessionId}`);
    }
    const messageId = randomUUID();
    const alreadyMerged = await deps.persistSubagentMerge(
      sessionId,
      childSessionId,
      result,
      messageId,
    );
    if (!alreadyMerged) {
      deps.push({
        type: 'subagent/merged',
        parentSessionId: sessionId,
        childSessionId,
        messageId,
      });
    }
    return {
      ...(result.summaryPreview ? { summaryPreview: result.summaryPreview } : {}),
      alreadyMerged,
    };
  };

  const controlDeps: SubagentControlDeps = {
    orchestrator,
    schemeAdmissionGate: deps.schemeAdmissionGate,
    runRegistry: deps.runRegistry,
    getParentRunId: () => deps.runExecutionContext.getStore(),
    getDelegationMode: (runId: string) => deps.runDelegationModes.get(runId),
    getActiveScheme: (runId: string) => deps.runOrchestrationSchemes.get(runId),
    prepareBatch: (request: SubagentBatchRequest, source: SubagentDeliveryPolicySource) =>
      deps.prepareSubagentBatch(request, source),
    whenReady: () => deps.whenSubagentStartupRecoveryReady(),
    taskResults: deps.subagentTaskResults,
    bindReviewTarget: (input) =>
      bindSubagentReviewTarget({
        parentSessionId: input.parentSessionId,
        reviewOf: input.reviewOf,
        resolvedIsolation: input.resolvedIsolation,
        ...(input.role ? { role: input.role } : {}),
        getResult: (resultId) => deps.subagentResultService?.get(resultId),
        ...(deps.turnChangeRuntime
          ? {
              hasFrozenChanges: (changes: { changeSetId: string; revision: number }) =>
                deps.turnChangeRuntime?.store.getChangeVersion(
                  changes.changeSetId,
                  changes.revision,
                ) !== undefined,
            }
          : {}),
      }),
    merge,
    observePersistedReview: async (runId: string) => {
      if (!deps.subagentRunStore) return undefined;
      return loadPersistedReviewObservation(deps.subagentRunStore, runId);
    },
    detachedRegistry: deps.detachedSubagents,
    onDetachedBatchSettled: (input) => {
      void settleDetachedBatch(deps, merge, input);
    },
    resolveFusionLane: (parentSessionId, request) =>
      resolveFusionSidekickLane(
        deps,
        parentSessionId,
        (laneId, error) => {
          deps.push({
            type: 'host/log',
            level: 'warn',
            message: `fusion sidekick ${laneId} cannot continue; starting a fresh sidekick: ${formatError(error)}`,
          });
        },
        () => resolveParentBaseCommit(deps, parentSessionId, request.baseBranch),
      ),
  };
  const seam = createSubagentControlSeam(controlDeps, sessionId);
  return {
    ...seam,
    getActiveScheme: (runId: string) => deps.runOrchestrationSchemes.get(runId),
    continueReviewed: async (input) =>
      startReviewedContinuation(
        {
          ...controlDeps,
          prepareContinuation: (childSessionId) =>
            prepareRetainedSubagentContinuation(deps, childSessionId),
          getResult: (resultId) => deps.subagentResultService?.get(resultId),
          listResults: (parentSessionId) =>
            deps.subagentResultService?.list({ parentSessionId }).items ?? [],
          loadReview: async (ref) =>
            deps.subagentRunStore ? findPersistedReview(deps.subagentRunStore, ref) : undefined,
          isAdmissionClosed: (runId) => deps.runRegistry.isAdmissionClosed(runId),
          continueGate: deps.reviewedContinueGate,
        },
        sessionId,
        input,
      ),
    submitLeadReview: async (input) => {
      if (!deps.subagentRunStore || !deps.subagentResultService) {
        return { ok: false, code: 'tool-not-available', message: 'subagent review is not available' };
      }
      return createSubagentReviewService({
        runStore: deps.subagentRunStore,
        resultService: deps.subagentResultService,
        publish: (message) => deps.push(message),
      }).submitLead(input);
    },
    applyReviewed: async (input) => {
      const resultService = deps.subagentResultService;
      if (!resultService) {
        return { ok: false, code: 'tool-not-available', message: 'subagent apply is not available' };
      }
      const projectPath = deps.sessionProjects.get(sessionId);
      return applyReviewedSubagentResult(
        {
          resultService,
          loadReview: async (ref) =>
            deps.subagentRunStore ? findPersistedReview(deps.subagentRunStore, ref) : undefined,
          applyResult: async (applyInput) => {
            const summary = resultService.get(applyInput.resultId);
            const childSessionId = summary?.childSessionId;
            if (!childSessionId) {
              throw new Error(`subagent result not found: ${applyInput.resultId}`);
            }
            try {
              const outcome = await deps.actOnSubagentWorktree(
                childSessionId,
                'apply',
                applyInput.signal,
              );
              if (applyInput.signal?.aborted && outcome.applyStatus !== 'succeeded') {
                throw new SubagentApplyOutcomeUnknownError(applyInput.operationId);
              }
              return {
                operationId: applyInput.operationId,
                status: outcome.applyStatus,
                integrationStatus: outcome.integrationStatus,
              };
            } catch (error) {
              if (applyInput.signal?.aborted || error instanceof SubagentApplyOutcomeUnknownError) {
                throw error instanceof SubagentApplyOutcomeUnknownError
                  ? error
                  : new SubagentApplyOutcomeUnknownError(applyInput.operationId);
              }
              throw error;
            }
          },
          persistApply: async (input) => {
            await deps.subagentRunStore?.projectResultApply(input.batchRunId, input.taskId, {
              appliedChanges: input.appliedChanges,
              latestOperationId: input.latestOperationId,
            });
          },
          ...(deps.turnChangeRuntime && projectPath
            ? {
                probeWrite: async () => {
                  const acquired = await deps.turnChangeRuntime?.gate.tryAcquire({
                    workspaceId: workspaceIdForRoot(projectPath),
                    rootPath: projectPath,
                    kind: 'integration',
                    mode: 'exclusive',
                    wait: false,
                  });
                  if (!acquired) return { ok: true as const };
                  if (!acquired.ok) {
                    // A workspace waiting for an undo repair is busy for apply too.
                    return {
                      ok: false as const,
                      code: acquired.reason === 'aborted' ? 'aborted' : 'workspace-busy',
                    };
                  }
                  acquired.lease.release();
                  return { ok: true as const };
                },
              }
            : {}),
          publish: (message) => deps.push(message),
        },
        {
          parentSessionId: sessionId,
          result: input.result,
          approvedBy: input.approvedBy,
          idempotencyKey: subagentApplyIdempotencyKey(input.result.resultId),
          requestHash: subagentApplyRequestHash(input.result.resultId, input.result.revision),
          ...(input.signal ? { signal: input.signal } : {}),
        },
      );
    },
    discardResult: async (input) => {
      const resultService = deps.subagentResultService;
      if (!resultService) {
        return { ok: false, code: 'tool-not-available', message: 'subagent discard is not available' };
      }
      return discardSubagentResultForLead(
        {
          resultService,
          applyInFlight: (resultId) =>
            deps.turnChangeRuntime?.store.getSubagentApplyReservation({ resultId })?.status ===
            'applying',
          discard: (entry) => discardSubagentResult(deps, entry),
          publish: (message) => deps.push(message),
        },
        { parentSessionId: sessionId, result: input.result },
      );
    },
    submitVerification: async (input) => {
      const resultService = deps.subagentResultService;
      const runStore = deps.subagentRunStore;
      if (!resultService || !runStore) {
        return {
          ok: false,
          code: 'tool-not-available',
          message: 'subagent verification is not available',
        };
      }
      return createSubagentVerificationService({
        runStore,
        resultService,
        publish: (message) => deps.push(message),
      }).submit({
        parentSessionId: sessionId,
        parentRunId: input.parentRunId,
        result: input.result,
        approvedBy: input.approvedBy,
        applyOperationId: input.applyOperationId,
        status: input.status,
        checks: input.checks,
      });
    },
  };
}

/**
 * Tip the next write child would start from for this parent session. Mirrors
 * the workspace service's resolution so a retained lane is compared against
 * the same base a fresh child would get.
 */
async function resolveParentBaseCommit(
  deps: HostRuntimeKernel,
  parentSessionId: string,
  baseBranch: string | undefined,
): Promise<string> {
  const rootDir = getPiwinRoot(deps.options.piwinRoot);
  const parentRecord = await getSessionRecord(getPiwinSessionIndexPath(rootDir), parentSessionId);
  if (!parentRecord) {
    throw new Error(`subagent parent session not found: ${parentSessionId}`);
  }
  const { workspacePath } = resolveSubagentParentLocation(
    parentRecord,
    'worktree',
    getPiwinGeneralWorkspacePath(rootDir),
  );
  return resolveSubagentBaseCommit({
    projectPath: workspacePath,
    ...(baseBranch ? { baseBranch } : {}),
    ...(parentRecord.workingDirectory ? { workingDirectory: parentRecord.workingDirectory } : {}),
  });
}

export async function prepareSubagentBatch(
  deps: HostRuntimeKernel,
  request: SubagentBatchRequest,
  source: SubagentDeliveryPolicySource = 'batch',
): Promise<SubagentBatchRequest> {
  const rootDir = getPiwinRoot(deps.options.piwinRoot);
  const config = await loadPiwinConfig(deps.options.piwinRoot);
  const parentRecord = await getSessionRecord(
    getPiwinSessionIndexPath(rootDir),
    request.parentSessionId,
  );
  const projectPath =
    deps.sessionProjects.get(request.parentSessionId) ??
    parentRecord?.workingDirectory ??
    parentRecord?.projectPath ??
    getPiwinGeneralWorkspacePath(rootDir);
  const parentModel = deps.sessionModels.get(request.parentSessionId) ?? parentRecord?.model;
  const freehandModel = source === 'model-tool-freehand'
    ? config.subagents?.freehandReadonlyModel
    : undefined;
  const profiles = freehandModel ? resolveSubagentProfiles(config) : [];
  const enabledSkillIds = (
    await scanSkills({
      piwinRoot: rootDir,
      projectPath,
      bundledRoot: resolveBundledSkillsRoot(),
      ...(config.skills ? { skillsConfig: config.skills } : {}),
    })
  )
    .filter((skill) => skill.enabled)
    .map((skill) => skill.id);

  const tasks = await Promise.all(request.tasks.map(async (task) => {
    const planned = planSubagentSpawn({
      config,
      request: {
        parentSessionId: request.parentSessionId,
        task: task.task,
        ...(task.sessionName ? { sessionName: task.sessionName } : {}),
        selector: {
          ...(task.profileId ? { profileId: task.profileId } : {}),
          ...(task.model ? { model: task.model } : {}),
          ...(task.thinkingLevel ? { thinkingLevel: task.thinkingLevel } : {}),
        },
        ...(task.role ? { role: task.role } : {}),
        ...(task.isolationOverride ? { mode: task.isolationOverride } : {}),
        ...(task.applyPolicy ? { applyPolicy: task.applyPolicy } : {}),
        ...(task.deliveryIntent ? { deliveryIntent: task.deliveryIntent } : {}),
        source,
        ...(task.allowedOutputPaths ? { allowedOutputPaths: [...task.allowedOutputPaths] } : {}),
        ...(task.retainWorktree !== undefined ? { retainWorktree: task.retainWorktree } : {}),
      },
      parentDepth: parentRecord?.depth ?? 0,
      parentKind: parentRecord?.kind,
      workingDirectory: projectPath,
      enabledSkillIds,
    });
    if ('error' in planned) {
      const detail = planned.code ? `${planned.code}: ${planned.error}` : planned.error;
      throw new Error(`subagent task ${task.id}: ${detail}`);
    }
    const configuredModel =
      freehandModel &&
      !planned.snapshot.model &&
      planned.snapshot.isolation === 'readonly' &&
      task.role?.toLowerCase() !== 'coder' &&
      task.role?.toLowerCase() !== 'implementer' &&
      profiles.find((profile) => profile.id === planned.snapshot.profileId)?.isolation !== 'worktree'
        ? freehandModel
        : undefined;
    const resolvedFreehandModel = configuredModel
      ? resolveChatModel(
          { providers: config.providers },
          configuredModel,
          await deps.subscriptionAuth?.chatResolveInput(),
        )
      : undefined;
    if (configuredModel && !resolvedFreehandModel) {
      throw new Error(
        `freehand read-only subagent model "${configuredModel.providerId}/${configuredModel.modelId}" is unavailable; choose an enabled chat model in Settings`,
      );
    }
    const model = planned.snapshot.model ?? resolvedFreehandModel?.ref ?? parentModel;
    return {
      ...task,
      ...(task.role ? { role: task.role } : {}),
      ...(planned.snapshot.profileId ? { profileId: planned.snapshot.profileId } : {}),
      ...(model ? { model } : {}),
      ...(planned.snapshot.thinkingLevel ? { thinkingLevel: planned.snapshot.thinkingLevel } : {}),
      isolationOverride: planned.snapshot.isolation,
      ...(planned.spawnOptions.applyPolicy
        ? { applyPolicy: planned.spawnOptions.applyPolicy }
        : {}),
      ...(planned.spawnOptions.deliveryIntent
        ? { deliveryIntent: planned.spawnOptions.deliveryIntent }
        : {}),
      legacyManual: planned.legacyManual,
      ...(planned.spawnOptions.retainWorktree !== undefined
        ? { retainWorktree: planned.spawnOptions.retainWorktree }
        : {}),
      ...(planned.snapshot.capabilities
        ? { capabilities: [...planned.snapshot.capabilities] }
        : {}),
      ...(planned.snapshot.skillIds ? { skillIds: [...planned.snapshot.skillIds] } : {}),
    };
  }));
  return { ...request, tasks };
}

export async function continueSubagentChild(
  deps: {
    options: { piwinRoot?: string };
    resolveRetainedSubagentWorktreeLease: HostRuntimeKernel['resolveRetainedSubagentWorktreeLease'];
    resolveSubagentContinuationRestore: HostRuntimeKernel['resolveSubagentContinuationRestore'];
    push: HostRuntimeKernel['push'];
  },
  orchestrator: Pick<SubagentOrchestrator, 'startBatch'>,
  childSessionId: string,
  text: string,
): Promise<{ runId: string }> {
  const prepared = await prepareRetainedSubagentContinuation(deps, childSessionId);
  const task = buildShellContinuationTask(prepared, text);
  const handle = orchestrator.startBatch({
    parentSessionId: prepared.child.parentSessionId ?? '',
    tasks: [task],
    maxConcurrency: 1,
    failurePolicy: 'continue',
  });
  void handle.completion.catch((error: unknown) => {
    deps.push({
      type: 'host/log',
      level: 'warn',
      message: `subagent continuation failed: ${formatError(error)}`,
    });
  });
  return { runId: handle.runId };
}
