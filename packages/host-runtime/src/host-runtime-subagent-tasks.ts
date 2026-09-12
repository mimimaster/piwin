/**
 * Extracted from HostRuntime. Behavior is unchanged; HostRuntime remains
 * the composition root and calls these functions with a kernel view of `this`.
 */

import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { formatError } from '@piwin/contracts';
import { resolveBundledSkillsRoot, scanSkills } from '@piwin/skills';
import { removeWorktree, runGitCommand } from '@piwin/git';

import { getSessionRecord, upsertSessionRecord, createSubagentRunStore } from '@piwin/session';
import type { SessionIndexRecord } from '@piwin/contracts';
import { loadPiwinConfig } from './config-store.js';
import { getPiwinGeneralWorkspacePath, getPiwinRoot, getPiwinSessionIndexPath } from './paths.js';
import { indexRecordToSummary } from './session-summary-map.js';
import { SubagentOrchestrator } from './subagent-orchestrator.js';
import { planSubagentSpawn } from './subagent-lifecycle-service.js';
import type { SubagentDeliveryPolicySource } from './subagent-delivery-policy.js';
import { reconcileSubagentBatchStatusAfterWorktreeAction } from './subagent-batch-status.js';
import {
  invocationActivityForResult,
  invocationStatusForResult,
} from './subagent-invocation-state.js';
import type { SubagentRunSeam } from './subagent-run-tool.js';
import { createSubagentControlSeam } from './host-runtime-subagent-start.js';
import { bindSubagentReviewTarget } from './subagent-review-context.js';
import {
  applyStatusFromIntegration,
  type SubagentApplyWriterStatus,
} from './subagent-apply-reservation.js';
import type {
  SubagentBatchRequest,
  SubagentIntegrationStatus,
  SubagentTaskSpec,
  SubagentTaskResult,
  SubagentWorkspaceLease,
} from '@piwin/contracts';

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

  return createSubagentControlSeam(
    {
      orchestrator,
      schemeAdmissionGate: deps.schemeAdmissionGate,
      runRegistry: deps.runRegistry,
      getParentRunId: () => deps.runExecutionContext.getStore(),
      getDelegationMode: (runId) => deps.runDelegationModes.get(runId),
      getActiveScheme: (runId) => deps.runOrchestrationSchemes.get(runId),
      prepareBatch: (request, source) => deps.prepareSubagentBatch(request, source),
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
    },
    sessionId,
  );
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

  const tasks = request.tasks.map((task) => {
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
    const model = planned.snapshot.model ?? parentModel;
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
  });
  return { ...request, tasks };
}

export async function continueSubagentChild(
  deps: HostRuntimeKernel,
  orchestrator: SubagentOrchestrator,
  childSessionId: string,
  text: string,
): Promise<{ runId: string }> {
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
    throw new Error('subagent is still running; wait for it to finish before continuing');
  }
  const runtime = child.subagentRuntime;
  if (!runtime) {
    throw new Error('subagent runtime snapshot is unavailable; open a new delegated task');
  }
  const parent = await getSessionRecord(indexPath, child.parentSessionId);
  if (!parent) {
    throw new Error(`subagent parent session not found: ${child.parentSessionId}`);
  }

  const mode = child.subagentMode ?? runtime.isolation;
  const parentScope =
    parent.scope ??
    (parent.projectPath
      ? ({ kind: 'project', projectPath: parent.projectPath } as const)
      : ({ kind: 'general' } as const));
  const continuationWorkspaceLease =
    mode === 'worktree'
      ? await deps.resolveRetainedSubagentWorktreeLease(child)
      : {
          mode: 'readonly' as const,
          cwd: child.workingDirectory ?? runtime.workingDirectory,
          parentRepoPath:
            parentScope.kind === 'project'
              ? parentScope.projectPath
              : getPiwinGeneralWorkspacePath(rootDir),
        };
  const task: SubagentTaskSpec = {
    id: randomUUID(),
    parentSessionId: child.parentSessionId,
    task: text,
    continuationSessionId: child.id,
    continuationWorkspaceLease,
    sessionName: child.name ?? `subagent-${child.id.slice(0, 8)}`,
    ...(runtime.profileId ? { profileId: runtime.profileId } : {}),
    ...(runtime.model ? { model: runtime.model } : {}),
    ...(runtime.thinkingLevel ? { thinkingLevel: runtime.thinkingLevel } : {}),
    ...(runtime.capabilities ? { capabilities: [...runtime.capabilities] } : {}),
    ...(runtime.skillIds ? { skillIds: [...runtime.skillIds] } : {}),
    isolationOverride: mode,
    applyPolicy: 'none',
    retainWorktree: mode === 'worktree',
    ...(child.subagentAllowedOutputPaths
      ? { allowedOutputPaths: [...child.subagentAllowedOutputPaths] }
      : {}),
  };
  const handle = orchestrator.startBatch({
    parentSessionId: child.parentSessionId,
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
  await access(child.worktreePath).catch(() => {
    throw new Error('subagent worktree no longer exists; start a new isolated task to continue');
  });
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
  const insideWorktree = await runGitCommand({
    cwd: matchingLease.worktreePath,
    args: ['rev-parse', '--is-inside-work-tree'],
  });
  if (insideWorktree.stdout.trim() !== 'true') {
    throw new Error('subagent worktree is invalid; start a new isolated task to continue');
  }
  return matchingLease;
}

export type SubagentWorktreeActionResult = {
  integrationStatus: SubagentIntegrationStatus;
  applyStatus: SubagentApplyWriterStatus;
};

export async function actOnSubagentWorktree(
  deps: HostRuntimeKernel,
  childSessionId: string,
  action: 'apply' | 'retain' | 'discard',
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
    result = await coordinator.integrate(retainedTask.result, lease);
  } else if (action === 'discard') {
    await removeWorktree({
      projectPath: lease.parentRepoPath,
      worktreePath: lease.worktreePath,
      force: true,
      worktreeBranch: lease.worktreeBranch,
    });
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
