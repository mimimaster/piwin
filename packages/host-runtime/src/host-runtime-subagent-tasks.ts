/**
 * Extracted from HostRuntime. Behavior is unchanged; HostRuntime remains
 * the composition root and calls these functions with a kernel view of `this`.
 */

import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { formatError } from '@piwin/contracts';
import { resolveBundledSkillsRoot, scanSkills } from '@piwin/skills';
import { deleteResultSnapshotRef, removeWorktree, runGitCommand } from '@piwin/git';

import { getSessionRecord, upsertSessionRecord, createSubagentRunStore } from '@piwin/session';
import { loadPiwinConfig } from './config-store.js';
import { getPiwinGeneralWorkspacePath, getPiwinRoot, getPiwinSessionIndexPath } from './paths.js';
import { indexRecordToSummary } from './session-summary-map.js';
import { SubagentOrchestrator } from './subagent-orchestrator.js';
import { planSubagentSpawn } from './subagent-lifecycle-service.js';
import { resolveSubagentProfiles } from './subagent-profile-resolver.js';
import { resolveChatModel } from './resolve-chat-model.js';
import type { SubagentDeliveryPolicySource } from './subagent-delivery-policy.js';
import { reconcileSubagentBatchStatusAfterWorktreeAction } from './subagent-batch-status.js';
import {
  invocationActivityForResult,
  invocationStatusForResult,
} from './subagent-invocation-state.js';
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
import { selectChildResult } from './subagent-child-result-select.js';
import { discardSubagentResultForLead } from './subagent-result-discard.js';
import { resolveSubagentParentLocation } from './subagent-parent-scope.js';
import { handleSessionLiveCommand } from './commands/session-live-commands.js';
import {
  deliverDetachedReport,
  formatDetachedReport,
} from './detached-subagent-reports.js';
import {
  applyStatusFromIntegration,
  subagentApplyIdempotencyKey,
  subagentApplyRequestHash,
  type SubagentApplyWriterStatus,
} from './subagent-apply-reservation.js';
import type {
  SubagentBatchRequest,
  SubagentIntegrationStatus,
  SubagentTaskResult,
  SubagentWorkspaceLease,
} from '@piwin/contracts';

export {
  buildShellContinuationTask,
  prepareRetainedSubagentContinuation,
};
export type {
  PreparedSubagentContinuation,
  SubagentContinuationPrepDeps,
} from './subagent-continuation-prep.js';

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

export async function resolveRetainedSubagentWorktreeLease(
  deps: HostRuntimeKernel,
  child: import('@piwin/contracts').SessionIndexRecord,
): Promise<Extract<SubagentWorkspaceLease, { mode: 'worktree' }>> {
  const integrationStatus = child.subagentLifecycle?.integrationStatus;
  if (
    !child.worktreePath ||
    (integrationStatus !== 'retained' &&
      integrationStatus !== 'conflict' &&
      integrationStatus !== 'failed')
  ) {
    throw new Error(
      'subagent worktree is no longer retained; start a new isolated task to continue',
    );
  }
  const rootDir = getPiwinRoot(deps.options.piwinRoot);
  const manifests = await createSubagentRunStore({
    runsDir: join(rootDir, 'subagent-runs'),
  }).listManifests();
  const matchingLease = manifests
    .flatMap((manifest) =>
      manifest.tasks.flatMap((task) => {
        const result = manifest.results[task.id];
        const lease = manifest.leases[task.id];
        return result?.childSessionId === child.id && lease?.mode === 'worktree' ? [lease] : [];
      }),
    )
    .reverse()
    .find((lease) => lease.worktreePath === child.worktreePath);
  if (!matchingLease) {
    throw new Error(
      'subagent worktree lease is unavailable; start a new isolated task to continue',
    );
  }
  // The frozen Git snapshot is the durable copy. A live checkout is only needed
  // when there is none: a shared writer slot may have been reset or rebuilt
  // since, which is normal and not a reason to refuse.
  const snapshot = await resolveSubagentContinuationRestore(deps, child).catch(() => undefined);
  if (!snapshot && matchingLease.slotId !== undefined) {
    // A slot path always exists (it is shared), so checking it proves nothing:
    // without a frozen tree the child's own state is gone.
    throw new Error(
      'subagent result snapshot is unavailable; start a new isolated task to continue',
    );
  }
  if (!snapshot) {
    const insideWorktree = await runGitCommand({
      cwd: matchingLease.worktreePath,
      args: ['rev-parse', '--is-inside-work-tree'],
      allowFailure: true,
    });
    if (insideWorktree.stdout.trim() !== 'true') {
      throw new Error('subagent worktree is invalid; start a new isolated task to continue');
    }
  }
  return matchingLease;
}

/**
 * Latest frozen snapshot for a child, with the base it was frozen against.
 *
 * A continuation resumes in the shared writer slot, which has been reset since
 * this child last ran, so the child's state has to be checked back out of Git
 * objects. The base is the lease commit the child started from, not the
 * parent's current HEAD: restoring against a moved parent would hand the child
 * a different starting point than its predecessor had.
 */
export async function resolveSubagentContinuationRestore(
  deps: HostRuntimeKernel,
  child: import('@piwin/contracts').SessionIndexRecord,
): Promise<{ baseCommit: string; tree: string } | undefined> {
  const rootDir = getPiwinRoot(deps.options.piwinRoot);
  const manifests = await createSubagentRunStore({
    runsDir: join(rootDir, 'subagent-runs'),
  }).listManifests();
  const matches = manifests
    .flatMap((manifest) =>
      manifest.tasks.flatMap((task) => {
        const result = manifest.results[task.id];
        const lease = manifest.leases[task.id];
        if (
          result?.childSessionId !== child.id ||
          lease?.mode !== 'worktree' ||
          !result.gitSnapshot
        ) {
          return [];
        }
        return [
          {
            updatedAtMs: Date.parse(manifest.updatedAt) || 0,
            baseCommit: lease.baseCommit,
            tree: result.gitSnapshot.tree,
          },
        ];
      }),
    )
    .sort((left, right) => left.updatedAtMs - right.updatedAtMs);
  const latest = matches[matches.length - 1];
  return latest ? { baseCommit: latest.baseCommit, tree: latest.tree } : undefined;
}

export type SubagentWorktreeActionResult = {
  integrationStatus: SubagentIntegrationStatus;
  applyStatus: SubagentApplyWriterStatus;
};

export async function actOnSubagentWorktree(
  deps: HostRuntimeKernel,
  childSessionId: string,
  action: 'apply' | 'retain' | 'discard',
  signal?: AbortSignal,
  /**
   * One specific run/task of the child. A persistent sidekick lane reuses a
   * child across runs, so "the child's result" alone can only ever name the
   * latest one and older undecided results could never be settled.
   */
  target?: { runId: string; taskId: string },
): Promise<SubagentWorktreeActionResult> {
  const coordinator = deps.subagentIntegrationCoordinator;
  if (!coordinator) {
    throw new Error('subagent worktree integration is not available');
  }
  const rootDir = getPiwinRoot(deps.options.piwinRoot);
  const indexPath = getPiwinSessionIndexPath(rootDir);
  const child = await getSessionRecord(indexPath, childSessionId);
  if (!child || child.kind !== 'subagent' || !child.parentSessionId) {
    throw new Error(`subagent child session not found: ${childSessionId}`);
  }
  if (
    child.subagentStatus === 'running' ||
    child.subagentLifecycle?.executionStatus === 'queued' ||
    child.subagentLifecycle?.executionStatus === 'running'
  ) {
    throw new Error('subagent is still running; wait for it to finish before handling changes');
  }

  const lease = await deps.resolveRetainedSubagentWorktreeLease(child);
  const runStore = createSubagentRunStore({ runsDir: join(rootDir, 'subagent-runs') });
  const manifests = await runStore.listManifests();
  const childResults = manifests
    .flatMap((manifest) =>
      manifest.tasks.flatMap((task) => {
        const result = manifest.results[task.id];
        const taskLease = manifest.leases[task.id];
        return result?.childSessionId === childSessionId &&
          taskLease?.mode === 'worktree' &&
          taskLease.worktreePath === lease.worktreePath
          ? [{ manifest, task, result }]
          : [];
      }),
    )
    .reverse();
  // The child's own record follows its newest result only; settling an older
  // run must not overwrite what the newer one says.
  const { entry: retainedTask, isLatest: isLatestResult } = selectChildResult(childResults, target);
  if (!retainedTask) {
    throw new Error('subagent worktree result is unavailable; start a new isolated task');
  }

  let result: SubagentTaskResult;
  if (action === 'apply') {
    result = await coordinator.integrate(
      retainedTask.result,
      lease,
      signal ? { signal } : {},
    );
  } else if (action === 'discard') {
    // A shared writer slot is not this task's to delete: discarding the result
    // returns the copy to the pool, it does not reclaim the checkout.
    if (lease.slotId === undefined) {
      await removeWorktree({
        projectPath: lease.parentRepoPath,
        worktreePath: lease.worktreePath,
        force: true,
        worktreeBranch: lease.worktreeBranch,
      });
    }
    // Nothing will read this result's snapshot again, so release the ref that
    // kept its objects alive instead of accumulating refs per decided result.
    const discardedResultId = retainedTask.result.resultRef?.resultId;
    if (discardedResultId !== undefined) {
      await deleteResultSnapshotRef({
        repoPath: lease.parentRepoPath,
        resultId: discardedResultId,
      }).catch(() => undefined);
    }
    const { worktreePath: _discardedWorktreePath, ...resultWithoutWorktree } = retainedTask.result;
    result = {
      ...resultWithoutWorktree,
      integrationStatus: 'discarded',
    };
  } else {
    await coordinator.retain(lease.worktreePath, 'retained by user');
    result = { ...retainedTask.result, integrationStatus: 'retained' };
  }

  return settleRetainedTaskResult(deps, {
    runStore,
    retainedTask,
    result,
    childSessionId,
    worktreePath: lease.worktreePath,
    isLatestResult,
  });
}

/** Everything that follows a decision about a retained result, shared by every way of making it. */
async function settleRetainedTaskResult(
  deps: HostRuntimeKernel,
  input: {
    runStore: ReturnType<typeof createSubagentRunStore>;
    retainedTask: {
      manifest: { runId: string; parentSessionId: string };
      task: { id: string };
    };
    result: SubagentTaskResult;
    childSessionId: string;
    /** Where the copy lived, when one is still on record; absent for a record-only settle. */
    worktreePath: string | undefined;
    /** The child's own record follows its newest result only. */
    isLatestResult: boolean;
  },
): Promise<SubagentWorktreeActionResult> {
  const { runStore, retainedTask, result, childSessionId, worktreePath, isLatestResult } = input;
  const indexPath = getPiwinSessionIndexPath(getPiwinRoot(deps.options.piwinRoot));
  await runStore.recordResult(retainedTask.manifest.runId, retainedTask.task.id, result);
  await deps.persistSubagentTaskResult(retainedTask.manifest.parentSessionId, result);
  const refreshedManifest = await runStore.loadManifest(retainedTask.manifest.runId);
  if (refreshedManifest) {
    const results = Object.values(refreshedManifest.results);
    const nextStatus = reconcileSubagentBatchStatusAfterWorktreeAction(
      refreshedManifest.status,
      results,
    );
    if (nextStatus !== refreshedManifest.status) {
      await runStore.setStatus(refreshedManifest.runId, nextStatus);
    }
    const invocation = Object.values(refreshedManifest.invocations).find(
      (candidate) => candidate.taskId === retainedTask.task.id,
    );
    if (invocation) {
      const updatedInvocation = {
        ...invocation,
        status: invocationStatusForResult(result),
        activity: invocationActivityForResult(result),
        revision: invocation.revision + 1,
        updatedAt: new Date().toISOString(),
      };
      await runStore.recordInvocation(refreshedManifest.runId, updatedInvocation);
      deps.push({
        type: 'subagent/invocation-updated',
        parentSessionId: retainedTask.manifest.parentSessionId,
        invocation: updatedInvocation,
      });
    }
    deps.push({
      type: 'subagent/task-updated',
      runId: refreshedManifest.runId,
      parentSessionId: retainedTask.manifest.parentSessionId,
      result,
    });
    deps.push({
      type: 'subagent/batch-updated',
      runId: refreshedManifest.runId,
      parentSessionId: retainedTask.manifest.parentSessionId,
      result: {
        runId: refreshedManifest.runId,
        status: nextStatus,
        results,
      },
    });
  }

  const updated = isLatestResult ? await getSessionRecord(indexPath, childSessionId) : undefined;
  if (updated) {
    const worktreeStillExists =
      worktreePath === undefined
        ? false
        : await access(worktreePath)
            .then(() => true)
            .catch(() => false);
    if (
      result.integrationStatus === 'discarded' ||
      (result.integrationStatus === 'applied' && !worktreeStillExists)
    ) {
      delete updated.worktreePath;
      delete updated.worktreeBranch;
    }
    updated.subagentLifecycle = {
      executionStatus: updated.subagentLifecycle?.executionStatus ?? result.executionStatus,
      summaryStatus: updated.subagentLifecycle?.summaryStatus ?? result.summaryStatus,
      integrationStatus: result.integrationStatus,
    };
    updated.updatedAt = new Date().toISOString();
    await upsertSessionRecord(indexPath, updated);
    deps.push({
      type: 'subagent/updated',
      parentSessionId: retainedTask.manifest.parentSessionId,
      child: indexRecordToSummary(updated),
    });
  }
  const resultId = result.resultRef?.resultId;
  const reservationStatus =
    resultId === undefined
      ? undefined
      : deps.turnChangeRuntime?.store.getSubagentApplyReservation({ resultId })?.status;
  return {
    integrationStatus: result.integrationStatus,
    applyStatus: applyStatusFromIntegration({
      integrationStatus: result.integrationStatus,
      ...(reservationStatus === undefined ? {} : { reservationStatus }),
    }),
  };
}

/**
 * Discard one undecided result: the lead's `piwin_subagent_result_discard` and
 * the expiry of results nobody decided (see subagent-result-expiry) both land here.
 *
 * When a copy or frozen snapshot is still there this is an ordinary discard.
 * When neither is (the worktree was removed and the snapshot ref is gone) there
 * is nothing on disk to release and only the record is left; refusing would
 * leave it `retained` and re-fail on every launch.
 */
export async function discardSubagentResult(
  deps: HostRuntimeKernel,
  entry: { childSessionId: string; runId: string; taskId: string },
): Promise<SubagentWorktreeActionResult> {
  const rootDir = getPiwinRoot(deps.options.piwinRoot);
  const indexPath = getPiwinSessionIndexPath(rootDir);
  const child = await getSessionRecord(indexPath, entry.childSessionId);
  const reachable = child
    ? await deps.resolveRetainedSubagentWorktreeLease(child).then(
        () => true,
        () => false,
      )
    : false;
  const target = { runId: entry.runId, taskId: entry.taskId };
  if (reachable) {
    return actOnSubagentWorktree(deps, entry.childSessionId, 'discard', undefined, target);
  }

  const runStore = createSubagentRunStore({ runsDir: join(rootDir, 'subagent-runs') });
  const manifest = await runStore.loadManifest(entry.runId);
  const task = manifest?.tasks.find((candidate) => candidate.id === entry.taskId);
  const stored = manifest?.results[entry.taskId];
  const lease = manifest?.leases[entry.taskId];
  if (!manifest || !task || !stored) {
    throw new Error(`subagent result ${entry.runId}/${entry.taskId} is no longer on record`);
  }
  const resultId = stored.resultRef?.resultId;
  if (resultId !== undefined && lease?.mode === 'worktree') {
    await deleteResultSnapshotRef({ repoPath: lease.parentRepoPath, resultId }).catch(
      () => undefined,
    );
  }
  const { worktreePath: _gone, ...withoutWorktree } = stored;
  const latest = selectChildResult(
    (await runStore.listManifests()).flatMap((candidate) =>
      candidate.tasks.flatMap((candidateTask) => {
        const candidateResult = candidate.results[candidateTask.id];
        return candidateResult?.childSessionId === entry.childSessionId
          ? [{ manifest: candidate, task: candidateTask, result: candidateResult }]
          : [];
      }),
    ).reverse(),
  );
  return settleRetainedTaskResult(deps, {
    runStore,
    retainedTask: { manifest, task },
    result: { ...withoutWorktree, integrationStatus: 'discarded' },
    childSessionId: entry.childSessionId,
    worktreePath: undefined,
    isLatestResult: latest.entry?.manifest.runId === entry.runId && latest.entry.task.id === entry.taskId,
  });
}
