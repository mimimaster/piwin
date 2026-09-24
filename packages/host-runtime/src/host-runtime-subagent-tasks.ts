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
    resolveFusionLane: (parentSessionId) =>
      resolveFusionSidekickLane(deps, parentSessionId, (laneId, error) => {
        deps.push({
          type: 'host/log',
          level: 'warn',
          message: `fusion sidekick ${laneId} cannot continue; starting a fresh sidekick: ${formatError(error)}`,
        });
      }),
  };
  const seam = createSubagentControlSeam(controlDeps, sessionId);
  return {
    ...seam,
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
                    return {
                      ok: false as const,
                      code: acquired.reason === 'workspace-busy' ? 'workspace-busy' : 'aborted',
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
  const retainedTask = manifests
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
    .reverse()[0];
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

  await runStore.recordResult(retainedTask.manifest.runId, retainedTask.task.id, result);
  await deps.persistSubagentTaskResult(child.parentSessionId, result);
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
        parentSessionId: child.parentSessionId,
        invocation: updatedInvocation,
      });
    }
    deps.push({
      type: 'subagent/task-updated',
      runId: refreshedManifest.runId,
      parentSessionId: child.parentSessionId,
      result,
    });
    deps.push({
      type: 'subagent/batch-updated',
      runId: refreshedManifest.runId,
      parentSessionId: child.parentSessionId,
      result: {
        runId: refreshedManifest.runId,
        status: nextStatus,
        results,
      },
    });
  }

  const updated = await getSessionRecord(indexPath, childSessionId);
  if (updated) {
    const worktreeStillExists = await access(lease.worktreePath)
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
      parentSessionId: child.parentSessionId,
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
