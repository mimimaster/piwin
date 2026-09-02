/**
 * Extracted from HostRuntime. Behavior is unchanged; HostRuntime remains
 * the composition root and calls these functions with a kernel view of `this`.
 */

import { join } from 'node:path';
import { WorkerTaskRunner } from '@piwin/agent-host';
import { ABSOLUTE_MAX_RESIDENT_RUNTIMES, formatError } from '@piwin/contracts';
import { createSubagentWorkerAdmission } from './subagent-worker-admission.js';
import { removeWorktree, integrateWorktreeChanges, isWorktreeBaseClean } from '@piwin/git';

import {
  createSessionRecord,
  getSessionRecord,
  upsertSessionRecord,
  listChildSessions,
  createSubagentRunStore,
} from '@piwin/session';
import { loadPiwinConfig } from './config-store.js';
import { createSecretResolver } from './secret-resolver.js';
import { findEnabledProvider, resolveDefaultModelRef } from './provider-helpers.js';
import { resolveChatModel } from './resolve-chat-model.js';
import { getPiwinGeneralWorkspacePath, getPiwinRoot, getPiwinSessionIndexPath } from './paths.js';
import { indexRecordToSummary } from './session-summary-map.js';
import { SubagentOrchestrator } from './subagent-orchestrator.js';
import { freezeSubagentChildResult } from './subagent-result-freeze.js';
import type { SubagentTaskPreflightContext } from './subagent-orchestrator.js';
import { resolveSubagentChildPrompt } from './subagent-lifecycle-service.js';
import { createSubagentWorkspaceService } from './subagent-workspace-service.js';
import { resolveSubagentParentLocation } from './subagent-parent-scope.js';
import {
  buildPersistedSubagentRepair,
  selectPersistedSubagentChild,
  terminalizePersistedInvocation,
} from './subagent-reconciliation.js';
import {
  createSubagentIntegrationCoordinator,
  createGitWorktreeIntegrationAdapter,
} from './subagent-integration-coordinator.js';
import { createRuntimeResourceCoordinator } from './runtime-resource-coordinator.js';
import type {
  SubagentRuntimeSnapshot,
  SubagentTaskSpec,
  SubagentTaskResult,
  SubagentWorkspaceLease,
} from '@piwin/contracts';

import type { HostRuntimeKernel } from './host-runtime-kernel.js';

/**
 * ADR 0030 Phase D-3: compose the production SubagentOrchestrator with
 * real worker processes, workspace services, and integration coordinators.
 *
 * Called only in non-mock mode from the constructor. All components are
 * nullable so mock mode and dispose() can safely skip them.
 */
export function composeSubagentOrchestrator(deps: HostRuntimeKernel): void {
  // Reuse the foreground supervisor. It is the sole worker process
  // authority for both foreground RPC sessions and subagent tasks.
  if (!deps.agentWorkerSupervisor) {
    deps.agentWorkerSupervisor = deps.createAgentWorkerSupervisor();
  }

  // Create the worker task runner — adapter from SubagentTaskRunner to
  // the worker supervisor.
  const taskRunner = new WorkerTaskRunner({
    supervisor: deps.agentWorkerSupervisor,
    admission: createSubagentWorkerAdmission(deps),
  });

  // Create the workspace service. Use a general-scope path as the default
  // project path; project-scoped sessions will override via the task spec's
  // parentSessionId → sessionProjects lookup in prepareTask.
  const rootDir = getPiwinRoot(deps.options.piwinRoot);
  const runStore = createSubagentRunStore({ runsDir: join(rootDir, 'subagent-runs') });
  const defaultProjectPath = getPiwinGeneralWorkspacePath(rootDir);
  deps.subagentWorkspaceService = createSubagentWorkspaceService({
    projectPath: defaultProjectPath,
    worktreeStorageRoot: join(rootDir, 'worktrees'),
    resolveProjectPath: async (task) => {
      const parentRecord = await getSessionRecord(
        getPiwinSessionIndexPath(rootDir),
        task.parentSessionId,
      );
      if (!parentRecord) {
        throw new Error(`subagent parent session not found: ${task.parentSessionId}`);
      }
      return resolveSubagentParentLocation(
        parentRecord,
        task.isolationOverride ?? 'readonly',
        defaultProjectPath,
      ).workspacePath;
    },
    dirtyBasePolicy: async () => {
      const config = await loadPiwinConfig(deps.options.piwinRoot);
      return config.subagents?.dirtyBasePolicy ?? 'ask';
    },
    parallelWritePolicy: 'worktree-only',
    requestDirtyBasePermission: async (task, projectPath) => {
      const activeRunId = deps.runRegistry.getForegroundRun(task.parentSessionId)?.runId;
      const signal = activeRunId ? deps.runRegistry.getSignal(activeRunId) : undefined;
      const decision = await deps.requestPermission({
        sessionId: task.parentSessionId,
        projectPath,
        action: 'subagent:dirty-base',
        detail: `Parallel write task ${task.id} wants to start from a dirty repository. Continue for this run?`,
        defaultDecision: 'deny',
        ...(signal ? { signal } : {}),
      });
      return decision === 'allow' ? 'allow' : 'deny';
    },
  });

  // Create the integration coordinator with git functions from @piwin/git.
  const integrationAdapter = createGitWorktreeIntegrationAdapter(integrateWorktreeChanges);
  deps.subagentIntegrationCoordinator = createSubagentIntegrationCoordinator({
    integrateWorktree: integrationAdapter,
    isBaseClean: isWorktreeBaseClean,
    ...(deps.turnChangeRuntime ? { workspaceWriteGate: deps.turnChangeRuntime.gate } : {}),
    removeWorktree: async (
      worktreePath: string,
      parentRepoPath: string,
      worktreeBranch?: string,
    ) => {
      await removeWorktree({
        projectPath: parentRepoPath,
        worktreePath,
        force: true,
        ...(worktreeBranch ? { worktreeBranch } : {}),
      });
    },
  });

  // Create the runtime resource coordinator. The worker supervisor reports
  // processIsolation=true, so effective concurrency equals the configured quota.
  const supervisorStatus = deps.agentWorkerSupervisor.getStatus();
  deps.runtimeResourceCoordinator = createRuntimeResourceCoordinator({
    configuredMaxConcurrency: deps.subagentQuota,
    hardCapPerBatch: ABSOLUTE_MAX_RESIDENT_RUNTIMES,
    processIsolation: supervisorStatus.processIsolation,
  });

  // Create the orchestrator with a dynamic generation ID getter.
  deps.subagentOrchestrator = new SubagentOrchestrator({
    taskRunner,
    workspaceService: deps.subagentWorkspaceService,
    prepareTask: (input) => deps.prepareSubagentTask(input),
    preflightTask: (input) => deps.preflightSubagentTask(input.task),
    integrationCoordinator: deps.subagentIntegrationCoordinator,
    ...(deps.turnChangeRuntime
      ? {
          freezeChildResult: ({ result, lease }) => {
            const runtime = deps.turnChangeRuntime;
            if (!runtime) {
              return Promise.resolve(result);
            }
            return freezeSubagentChildResult({
              store: runtime.store,
              result,
              lease,
            });
          },
        }
      : {}),
    resourceCoordinator: deps.runtimeResourceCoordinator,
    runRegistry: deps.runRegistry,
    runStore,
    push: (message) => {
      deps.push(message);
    },
    onTaskResult: async ({ parentSessionId, result }) => {
      await deps.persistSubagentTaskResult(parentSessionId, result);
    },
    getRuntimeGenerationId: (parentSessionId) => {
      const genId = deps.runtimeController.getStatus(parentSessionId).generationId;
      if (!genId) {
        throw new Error(
          `subagent runtime generation unavailable for parent session ${parentSessionId}`,
        );
      }
      return genId;
    },
    registerTaskSession: async (input) => {
      deps.subagentSessionContexts.set(input.childSessionId, {
        parentSessionId: input.parentSessionId,
        runtimeGenerationId: input.runtimeGenerationId,
        workingDirectory: input.workingDirectory,
        parentRepoPath: input.workspaceLease.parentRepoPath,
        ...(input.task.invocationId ? { invocationId: input.task.invocationId } : {}),
      });
      await deps.persistSubagentSessionStart(input).catch((error: unknown) => {
        deps.push({
          type: 'host/log',
          level: 'warn',
          message: `subagent session registration failed: ${formatError(error)}`,
        });
      });
      if (input.task.model) {
        deps.sessionModels.set(input.childSessionId, input.task.model);
      }
      await deps.ensureTranscriptRecorder(
        input.childSessionId,
        input.workspaceLease.parentRepoPath,
        input.runtimeGenerationId,
      );
    },
    recordTaskPrompt: async ({ childSessionId, task }) => {
      const recorder = deps.transcriptRecorders.get(childSessionId);
      if (!recorder) return;
      await recorder.recordUserPrompt({
        text: resolveSubagentChildPrompt(task),
        ...(task.model ? { model: task.model } : {}),
        ...(task.thinkingLevel ? { thinkingLevel: task.thinkingLevel } : {}),
      });
    },
    unregisterTaskSession: async (childSessionId) => {
      const recorder = deps.transcriptRecorders.get(childSessionId);
      if (recorder) {
        try {
          await recorder.flush();
        } catch (error) {
          deps.push({
            type: 'host/log',
            level: 'warn',
            message: `subagent transcript flush failed: ${formatError(error)}`,
          });
        } finally {
          recorder.dispose();
          deps.transcriptRecorders.delete(childSessionId);
        }
      }
      deps.sessionModels.delete(childSessionId);
      deps.subagentSessionContexts.delete(childSessionId);
      deps.sessionHostToolPort?.clearSession(childSessionId);
      await deps.releaseGenerationToolSurfaces(childSessionId);
    },
  });
  deps.subagentRunStore = runStore;
  // Startup reconciliation is ownership-fenced (the constructor holds the
  // root lease) and awaited by new subagent admission before any batch can
  // race ahead of recovered state.
  deps.subagentStartupRecovery = deps
    .reconcilePersistedSubagentSessions(runStore)
    .catch((error: unknown) => {
      deps.push({
        type: 'host/log',
        level: 'error',
        message: `subagent startup reconciliation failed: ${formatError(error)}`,
      });
    });
}

export function whenSubagentStartupRecoveryReady(deps: HostRuntimeKernel): Promise<void> {
  return deps.subagentStartupRecovery ?? Promise.resolve();
}

export async function persistSubagentSessionStart(
  deps: HostRuntimeKernel,
  input: {
    childSessionId: string;
    parentSessionId: string;
    runtimeGenerationId: string;
    workingDirectory: string;
    task: SubagentTaskSpec;
    workspaceLease: SubagentWorkspaceLease;
  },
): Promise<void> {
  const rootDir = getPiwinRoot(deps.options.piwinRoot);
  const indexPath = getPiwinSessionIndexPath(rootDir);
  const parentRecord = await getSessionRecord(indexPath, input.parentSessionId);
  const projectPath = parentRecord?.projectPath ?? input.workspaceLease.parentRepoPath;
  const scope = parentRecord?.scope ?? {
    kind: 'project' as const,
    projectPath: input.workspaceLease.parentRepoPath,
  };
  const runtimeSnapshot: SubagentRuntimeSnapshot = {
    ...(input.task.profileId ? { profileId: input.task.profileId } : {}),
    ...(input.task.model ? { model: input.task.model } : {}),
    ...(input.task.thinkingLevel ? { thinkingLevel: input.task.thinkingLevel } : {}),
    ...(input.task.capabilities ? { capabilities: [...input.task.capabilities] } : {}),
    ...(input.task.skillIds ? { skillIds: [...input.task.skillIds] } : {}),
    isolation: input.workspaceLease.mode,
    workingDirectory: input.workingDirectory,
  };
  const lifecycle = {
    executionStatus: 'running' as const,
    summaryStatus: 'not-requested' as const,
    integrationStatus:
      input.workspaceLease.mode === 'worktree' ? ('pending' as const) : ('not-requested' as const),
  };
  const current = await getSessionRecord(indexPath, input.childSessionId);
  const record =
    current ??
    createSessionRecord({
      id: input.childSessionId,
      projectPath,
      scope,
      workingDirectory: input.workingDirectory,
      name: input.task.sessionName ?? `subagent-${input.task.id}`,
      parentSessionId: input.parentSessionId,
      depth: (parentRecord?.depth ?? 0) + 1,
      kind: 'subagent',
      subagentStatus: 'running',
      task: input.task.task,
      ...(input.task.invocationId ? { subagentInvocationId: input.task.invocationId } : {}),
      subagentTaskId: input.task.id,
      ...(input.task.parentRunId ? { subagentParentRunId: input.task.parentRunId } : {}),
      ...(input.task.parentToolCallId
        ? { subagentParentToolCallId: input.task.parentToolCallId }
        : {}),
      subagentMode: input.workspaceLease.mode,
      subagentApplyPolicy: input.task.applyPolicy ?? 'none',
      ...(input.task.allowedOutputPaths
        ? { subagentAllowedOutputPaths: [...input.task.allowedOutputPaths] }
        : {}),
      subagentRetainWorktree: input.task.retainWorktree === true,
      ...(input.task.role ? { subagentRole: input.task.role } : {}),
      ...(input.workspaceLease.mode === 'worktree'
        ? {
            worktreePath: input.workspaceLease.worktreePath,
            worktreeBranch: input.workspaceLease.worktreeBranch,
          }
        : {}),
      subagentRuntime: runtimeSnapshot,
      subagentLifecycle: lifecycle,
    });

  if (current) {
    current.parentSessionId = input.parentSessionId;
    current.depth = (parentRecord?.depth ?? 0) + 1;
    current.kind = 'subagent';
    current.scope = current.scope ?? scope;
    current.workingDirectory = input.workingDirectory;
    if (!current.name) current.name = input.task.sessionName ?? `subagent-${input.task.id}`;
    current.subagentStatus = 'running';
    current.task = input.task.task;
    if (input.task.invocationId) current.subagentInvocationId = input.task.invocationId;
    current.subagentTaskId = input.task.id;
    if (input.task.parentRunId) current.subagentParentRunId = input.task.parentRunId;
    if (input.task.parentToolCallId) {
      current.subagentParentToolCallId = input.task.parentToolCallId;
    }
    current.subagentMode = input.workspaceLease.mode;
    current.subagentApplyPolicy = input.task.applyPolicy ?? 'none';
    if (input.task.allowedOutputPaths) {
      current.subagentAllowedOutputPaths = [...input.task.allowedOutputPaths];
    }
    current.subagentRetainWorktree = input.task.retainWorktree === true;
    if (input.task.role) current.subagentRole = input.task.role;
    if (input.workspaceLease.mode === 'worktree') {
      current.worktreePath = input.workspaceLease.worktreePath;
      current.worktreeBranch = input.workspaceLease.worktreeBranch;
    }
    current.subagentRuntime = runtimeSnapshot;
    current.subagentLifecycle = lifecycle;
  }
  record.updatedAt = new Date().toISOString();
  await upsertSessionRecord(indexPath, record);
  deps.push({
    type: 'subagent/updated',
    parentSessionId: input.parentSessionId,
    child: indexRecordToSummary(record),
  });
}

export async function persistSubagentTaskResult(
  deps: HostRuntimeKernel,
  parentSessionId: string,
  result: SubagentTaskResult,
): Promise<void> {
  const childSessionId = result.childSessionId;
  if (!childSessionId) return;
  const rootDir = getPiwinRoot(deps.options.piwinRoot);
  const indexPath = getPiwinSessionIndexPath(rootDir);
  const record = await getSessionRecord(indexPath, childSessionId);
  if (!record) return;
  record.updatedAt = new Date().toISOString();
  record.subagentStatus =
    result.executionStatus === 'completed'
      ? 'done'
      : result.executionStatus === 'cancelled'
        ? 'cancelled'
        : result.executionStatus === 'queued' || result.executionStatus === 'running'
          ? 'running'
          : 'failed';
  if (result.summaryPreview) record.summaryPreview = result.summaryPreview;
  if (result.worktreePath) record.worktreePath = result.worktreePath;
  record.subagentLifecycle = {
    executionStatus: result.executionStatus,
    summaryStatus: result.summaryStatus,
    integrationStatus: result.integrationStatus,
  };
  await upsertSessionRecord(indexPath, record);
  const resultRef = result.resultRef;
  if (resultRef && deps.subagentResultService) {
    deps.subagentResultService.register(
      {
        resultId: resultRef.resultId,
        revision: resultRef.revision,
        parentSessionId,
        childSessionId,
        taskId: result.taskId,
        batchRunId: result.runId,
        sourceAttemptId: null,
        targetWorkspaceId: '',
        deliveryIntent: 'integrate',
        legacyManual: false,
        candidateGroupId: null,
        executionStatus: result.executionStatus,
        summaryStatus: result.summaryStatus,
        integrationStatus: result.integrationStatus,
        childChanges: result.childChanges ?? null,
        appliedChanges: null,
        copyState: 'present',
        latestOperationId: null,
        availability: {
          view: { allowed: true },
          apply: { allowed: result.integrationStatus !== 'applied' },
          resolve: { allowed: true },
          cleanup: { allowed: true },
        },
      },
      result.worktreePath ? { worktreePath: result.worktreePath } : undefined,
    );
  }
  deps.push({
    type: 'subagent/updated',
    parentSessionId,
    child: indexRecordToSummary(record),
  });
}

/**
 * Repair active-looking child shells from durable batch manifests after a
 * Host restart. Exact child ids win; legacy records without linkage are
 * matched only when parent + task text identifies one unique child.
 */
export async function reconcilePersistedSubagentSessions(
  deps: HostRuntimeKernel,
  runStore: ReturnType<typeof createSubagentRunStore>,
): Promise<void> {
  const manifests = await runStore.listManifests();
  const rootDir = getPiwinRoot(deps.options.piwinRoot);
  const indexPath = getPiwinSessionIndexPath(rootDir);

  for (const manifest of manifests) {
    const children = await listChildSessions(indexPath, manifest.parentSessionId);
    const claimedChildIds = new Set<string>();

    for (const task of manifest.tasks) {
      const storedResult = manifest.results[task.id];
      const child = selectPersistedSubagentChild(task, storedResult, children, claimedChildIds);
      if (!child) continue;
      claimedChildIds.add(child.id);

      const repair = buildPersistedSubagentRepair(manifest, task, storedResult, child);
      if (!repair) continue;
      if (repair.recordResult) {
        await runStore.recordResult(manifest.runId, task.id, repair.result);
      }
      const invocation = Object.values(manifest.invocations).find(
        (candidate) => candidate.taskId === task.id,
      );
      if (invocation) {
        await runStore.recordInvocation(
          manifest.runId,
          terminalizePersistedInvocation(invocation, repair.result, new Date().toISOString()),
        );
      }
      await deps.persistSubagentTaskResult(manifest.parentSessionId, repair.result);
    }

    if (manifest.status === 'running') {
      await runStore.setStatus(manifest.runId, 'failed');
    }
  }
}

export async function persistSubagentMerge(
  deps: HostRuntimeKernel,
  parentSessionId: string,
  childSessionId: string,
  result: SubagentTaskResult,
  messageId: string,
): Promise<boolean> {
  const rootDir = getPiwinRoot(deps.options.piwinRoot);
  const indexPath = getPiwinSessionIndexPath(rootDir);
  const record = await getSessionRecord(indexPath, childSessionId);
  if (!record) return false;
  if (record.mergeMessageId) return true;
  record.updatedAt = new Date().toISOString();
  record.mergedAt = new Date().toISOString();
  record.mergeMessageId = messageId;
  record.subagentLifecycle = {
    executionStatus: record.subagentLifecycle?.executionStatus ?? result.executionStatus,
    summaryStatus: 'merged',
    integrationStatus: record.subagentLifecycle?.integrationStatus ?? result.integrationStatus,
  };
  await upsertSessionRecord(indexPath, record);
  deps.push({
    type: 'subagent/updated',
    parentSessionId,
    child: indexRecordToSummary(record),
  });
  return false;
}

/**
 * Freeze the effective provider and its credential before the orchestrator
 * allocates a child identity. Task compilation consumes this same in-memory
 * snapshot and never performs a second keychain read.
 */
export async function preflightSubagentTask(
  deps: HostRuntimeKernel,
  task: SubagentTaskSpec,
): Promise<SubagentTaskPreflightContext> {
  let config: import('@piwin/contracts').PiwinConfig;
  try {
    config = await loadPiwinConfig(deps.options.piwinRoot);
  } catch (error) {
    throw new Error(
      `subagent-unavailable-fallback-main: provider configuration could not be loaded (${formatError(error)}). ` +
        'Complete this subtask in the main session.',
    );
  }

  const accounts = (await deps.subscriptionAuth?.chatResolveInput()) ?? { accounts: [] };
  const resolved = task.model
    ? resolveChatModel({ providers: config.providers }, task.model, accounts)
    : undefined;
  const model = resolved?.ref ?? resolveDefaultModelRef(config, accounts);
  if (!model) {
    return { config, resolvedProviderSecrets: [] };
  }
  if (resolved?.source === 'subscription' || model.source === 'subscription') {
    return { config, effectiveModel: model, resolvedProviderSecrets: [] };
  }
  const provider = findEnabledProvider(config, model.providerId);
  if (!provider) {
    throw new Error(
      `subagent-unavailable-fallback-main: provider "${model.providerId}" is unavailable. ` +
        'Complete this subtask in the main session.',
    );
  }

  const resolvedProviderSecrets: Array<{
    providerId: string;
    apiKeyRef: string;
    value: string;
  }> = [];
  try {
    if (provider.apiKeyEnv?.trim()) {
      const value = process.env[provider.apiKeyEnv.trim()];
      if (!value) {
        throw new Error(`environment variable ${provider.apiKeyEnv.trim()} is unset`);
      }
    } else if (provider.apiKeyRef?.trim()) {
      const value = await createSecretResolver().resolveProviderSecret(provider);
      if (!value.trim()) {
        throw new Error('resolved provider credential is empty');
      }
      resolvedProviderSecrets.push({
        providerId: provider.id,
        apiKeyRef: provider.apiKeyRef.trim(),
        value,
      });
    }
  } catch {
    throw new Error(
      `subagent-unavailable-fallback-main: credentials for provider "${provider.id}" are unavailable. ` +
        'Complete this subtask in the main session.',
    );
  }
  return { config, effectiveModel: model, resolvedProviderSecrets };
}
