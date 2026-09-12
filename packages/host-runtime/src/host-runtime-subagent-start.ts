/**
 * Shared start/wait/cancel path for model-facing subagent tools.
 *
 * Scheme resolution, admission, batch preparation, and durable acceptance live
 * here. `piwin_subagent_run` still waits for completion; start returns after
 * acceptance and releases admission when the child is observed to finish.
 */
import { randomUUID } from 'node:crypto';
import {
  applySchemeToSubagentSpawnInput,
  boundSubagentControlDisplay,
  boundSubagentControlRunDisplay,
  formatError,
  type ResolvedOrchestrationScheme,
  type SubagentBatchRequest,
  type SubagentBatchResult,
  type SubagentIsolationMode,
  type SubagentResultRef,
  type SubagentTaskResult,
  type ToolResultErrorCode,
} from '@piwin/contracts';
import type { BindSubagentReviewTargetResult } from './subagent-review-context.js';
import type { RunRegistry } from './run-registry.js';
import type { TurnScopedSchemeAdmissionGate } from './orchestration-scheme-admission.js';
import type { SubagentDeliveryPolicySource } from './subagent-delivery-policy.js';
import type { SubagentOrchestrator } from './subagent-orchestrator.js';
import type {
  SubagentCancelResult,
  SubagentRunSeam,
  SubagentSpawnInput,
  SubagentSpawnResult,
  SubagentWaitResult,
  SubagentWaitRunObservation,
} from './subagent-run-tool.js';

export class SubagentControlError extends Error {
  readonly code: ToolResultErrorCode;
  readonly cancelled?: boolean;

  constructor(code: ToolResultErrorCode, message: string, cancelled?: boolean) {
    super(message);
    this.name = 'SubagentControlError';
    this.code = code;
    if (cancelled) this.cancelled = true;
  }
}

export type SubagentControlDeps = {
  orchestrator: SubagentOrchestrator;
  schemeAdmissionGate: TurnScopedSchemeAdmissionGate;
  runRegistry: RunRegistry;
  getParentRunId: () => string | undefined;
  getDelegationMode: (runId: string) => 'auto' | 'disabled' | undefined;
  getActiveScheme: (runId: string) => ResolvedOrchestrationScheme | undefined;
  prepareBatch: (
    request: SubagentBatchRequest,
    source: SubagentDeliveryPolicySource,
  ) => Promise<SubagentBatchRequest>;
  whenReady: () => Promise<void>;
  taskResults: Map<string, SubagentTaskResult>;
  merge: SubagentRunSeam['merge'];
  bindReviewTarget?: (input: {
    parentSessionId: string;
    reviewOf: SubagentResultRef;
    resolvedIsolation: SubagentIsolationMode;
    role?: string;
  }) => BindSubagentReviewTargetResult;
};

type PreparedStart = {
  handle: ReturnType<SubagentOrchestrator['startBatch']>;
  releaseAdmission: () => void;
};

export function createSubagentControlSeam(
  deps: SubagentControlDeps,
  sessionId: string,
): SubagentRunSeam {
  return {
    spawn: async (input) => {
      const prepared = await prepareAndStartSubagent(deps, sessionId, input);
      const cancelBatch = (): void => {
        void deps.orchestrator.cancelBatch(prepared.handle.runId).catch(() => {});
      };
      if (input.signal?.aborted) {
        cancelBatch();
      } else if (input.signal) {
        input.signal.addEventListener('abort', cancelBatch, { once: true });
      }
      try {
        const result = await prepared.handle.completion;
        cacheBatchResults(deps, result);
        return spawnResultFromBatch(result);
      } finally {
        if (input.signal) {
          input.signal.removeEventListener('abort', cancelBatch);
        }
        prepared.releaseAdmission();
      }
    },
    start: async (input) => {
      const prepared = await prepareAndStartSubagent(deps, sessionId, input);
      observeAcceptedBatch(deps, prepared);
      let abortBeforeAccept = false;
      const cancelBatch = (): void => {
        if (prepared.handle.hasAccepted()) return;
        abortBeforeAccept = true;
        void deps.orchestrator.cancelBatch(prepared.handle.runId).catch(() => {});
      };
      if (input.signal?.aborted) {
        cancelBatch();
      } else if (input.signal) {
        input.signal.addEventListener('abort', cancelBatch, { once: true });
      }
      try {
        await prepared.handle.accepted;
      } catch (error) {
        throw new SubagentControlError('subagent-failed', formatError(error));
      } finally {
        if (input.signal) {
          input.signal.removeEventListener('abort', cancelBatch);
        }
      }
      if (abortBeforeAccept && !prepared.handle.hasAccepted()) {
        throw new SubagentControlError('aborted', 'aborted before subagent acceptance', true);
      }
      return {
        runId: prepared.handle.runId,
        invocationId: input.invocationId,
      };
    },
    merge: deps.merge,
    wait: async (input) => waitForSubagentRuns(deps, sessionId, input),
    cancel: async (input) => cancelSubagentRuns(deps, sessionId, input),
  };
}

async function prepareAndStartSubagent(
  deps: SubagentControlDeps,
  sessionId: string,
  input: SubagentSpawnInput,
): Promise<PreparedStart> {
  await deps.whenReady();
  const parentRunId = deps.getParentRunId();
  if (parentRunId && deps.getDelegationMode(parentRunId) === 'disabled') {
    throw new Error(
      'subagent-delegation-disabled: model-facing delegation is disabled for this turn',
    );
  }
  const activeScheme = parentRunId ? deps.getActiveScheme(parentRunId) : undefined;
  const admission = await deps.schemeAdmissionGate.acquire(parentRunId, input.signal);
  const releaseAdmission = (): void => {
    admission?.release();
  };
  try {
    if (input.signal?.aborted) {
      throw new Error('aborted before subagent spawn');
    }
    const schemeSpawn = applySchemeToSubagentSpawnInput(activeScheme, {
      ...(input.role ? { role: input.role } : {}),
      ...(input.profileId ? { profileId: input.profileId } : {}),
      ...(input.model ? { model: input.model } : {}),
      ...(input.thinkingLevel ? { thinkingLevel: input.thinkingLevel } : {}),
    });
    if (schemeSpawn.fallback) {
      const reason = schemeSpawn.fallback.reason;
      const roleLabel = schemeSpawn.fallback.role;
      if (schemeSpawn.fallback.kind === 'none') {
        throw new Error(`subagent role "${roleLabel}" unavailable (fallback=none): ${reason}`);
      }
      throw new Error(
        `subagent-unavailable-fallback-main: role "${roleLabel}" unavailable (${reason}). ` +
          'Complete this subtask in the main session yourself; keep context pollution minimal.',
      );
    }
    let mode = input.mode;
    if (schemeSpawn.isolation) {
      mode = schemeSpawn.isolation;
    } else if (activeScheme && !activeScheme.exposeSpawnMetadata) {
      mode = 'readonly';
    }
    const resolvedModel = schemeSpawn.model;
    const allowInputModel =
      Boolean(input.model) &&
      (!activeScheme || activeScheme.exposeSpawnMetadata) &&
      !schemeSpawn.clearedModel &&
      !resolvedModel;
    const preparedRequest = await deps.prepareBatch(
      {
        parentSessionId: sessionId,
        tasks: [
          {
            id: randomUUID(),
            parentSessionId: sessionId,
            invocationId: input.invocationId,
            parentRunId: input.parentRunId,
            ...(input.parentToolCallId ? { parentToolCallId: input.parentToolCallId } : {}),
            task: input.task,
            ...(mode ? { isolationOverride: mode } : {}),
            ...(input.applyPolicy ? { applyPolicy: input.applyPolicy } : {}),
            ...(input.deliveryIntent ? { deliveryIntent: input.deliveryIntent } : {}),
            ...(input.sessionName ? { sessionName: input.sessionName } : {}),
            ...(schemeSpawn.role ? { role: schemeSpawn.role } : {}),
            ...(schemeSpawn.profileId ? { profileId: schemeSpawn.profileId } : {}),
            ...(schemeSpawn.reportContract ? { reportContract: schemeSpawn.reportContract } : {}),
            ...(resolvedModel
              ? { model: resolvedModel }
              : allowInputModel && input.model
                ? { model: input.model }
                : {}),
            ...(schemeSpawn.thinkingLevel ? { thinkingLevel: schemeSpawn.thinkingLevel } : {}),
          },
        ],
        maxConcurrency: 1,
      },
      'model-tool',
    );
    const admittedRequest = input.reviewOf
      ? attachReviewTarget(deps, sessionId, input.reviewOf, preparedRequest)
      : preparedRequest;
    const handle = deps.orchestrator.startBatch(admittedRequest, parentRunId);
    return { handle, releaseAdmission };
  } catch (error) {
    releaseAdmission();
    throw error;
  }
}

function attachReviewTarget(
  deps: SubagentControlDeps,
  parentSessionId: string,
  reviewOf: SubagentResultRef,
  request: SubagentBatchRequest,
): SubagentBatchRequest {
  const task = request.tasks[0];
  if (!task) {
    throw new SubagentControlError('invalid-input', 'reviewOf requires a reviewer task');
  }
  if (!deps.bindReviewTarget) {
    throw new SubagentControlError(
      'review-target-not-found',
      'review target was not found; refresh result state',
    );
  }
  const bound = deps.bindReviewTarget({
    parentSessionId,
    reviewOf,
    resolvedIsolation: task.isolationOverride ?? 'readonly',
    ...(task.role ? { role: task.role } : {}),
  });
  if (!bound.ok) {
    throw new SubagentControlError(bound.code, bound.message);
  }
  return {
    ...request,
    tasks: [{ ...task, reviewTarget: bound.target }],
  };
}

function observeAcceptedBatch(deps: SubagentControlDeps, prepared: PreparedStart): void {
  void prepared.handle.completion
    .then((result) => {
      cacheBatchResults(deps, result);
    })
    .catch(() => {})
    .finally(() => {
      prepared.releaseAdmission();
    });
}

function cacheBatchResults(deps: SubagentControlDeps, result: SubagentBatchResult): void {
  for (const taskResult of result.results) {
    if (taskResult.childSessionId) {
      deps.taskResults.set(taskResult.childSessionId, taskResult);
    }
  }
}

function spawnResultFromBatch(result: SubagentBatchResult): SubagentSpawnResult {
  const taskResult = result.results[0];
  const childSessionId = taskResult?.childSessionId ?? '';
  if (taskResult && childSessionId) {
    return {
      childSessionId,
      batchStatus: result.status,
      executionStatus: taskResult.executionStatus,
      integrationStatus: taskResult.integrationStatus,
      ...(taskResult.error ? { error: taskResult.error } : {}),
      ...(taskResult.worktreePath ? { worktreePath: taskResult.worktreePath } : {}),
    };
  }
  if (taskResult?.error) {
    throw new Error(taskResult.error);
  }
  throw new Error(`subagent batch ${result.status} without a child session result`);
}

type OwnerRecord = NonNullable<Awaited<ReturnType<SubagentOrchestrator['lookupBatchOwner']>>>;

async function resolveValidatedOwners(
  deps: SubagentControlDeps,
  sessionId: string,
  runIds: string[],
  mode: 'wait' | 'cancel',
  parentRunId: string,
): Promise<OwnerRecord[]> {
  for (const runId of runIds) {
    if (!runId) {
      throw new SubagentControlError(
        'invalid-input',
        'runIds must not contain empty or whitespace-only ids',
      );
    }
  }
  const owners: OwnerRecord[] = [];
  for (const runId of runIds) {
    const owner = await deps.orchestrator.lookupBatchOwner(runId);
    const run = deps.runRegistry.get(runId);
    if (!owner) {
      if (run && run.kind !== 'subagent-batch') {
        throw new SubagentControlError(
          'invalid-input',
          `run is not a subagent-batch: ${runId}`,
        );
      }
      throw new SubagentControlError('invalid-input', `subagent batch not found: ${runId}`);
    }
    if (owner.parentSessionId !== sessionId) {
      throw new SubagentControlError(
        'invalid-input',
        `subagent batch belongs to another session: ${runId}`,
      );
    }
    if (mode === 'wait' && owner.active && owner.parentRunId !== parentRunId) {
      throw new SubagentControlError(
        'invalid-input',
        `subagent batch belongs to another run: ${runId}`,
      );
    }
    if (mode === 'cancel' && owner.parentRunId !== parentRunId) {
      throw new SubagentControlError(
        'invalid-input',
        `subagent batch belongs to another run: ${runId}`,
      );
    }
    owners.push(owner);
  }
  return owners;
}

async function waitForSubagentRuns(
  deps: SubagentControlDeps,
  sessionId: string,
  input: {
    runIds: string[];
    parentSessionId: string;
    parentRunId: string;
    signal?: AbortSignal;
  },
): Promise<SubagentWaitResult> {
  if (input.signal?.aborted) {
    throw new SubagentControlError('aborted', 'aborted while waiting for subagent', true);
  }
  const owners = await resolveValidatedOwners(
    deps,
    sessionId,
    input.runIds,
    'wait',
    input.parentRunId,
  );
  if (input.signal?.aborted) {
    throw new SubagentControlError('aborted', 'aborted while waiting for subagent', true);
  }
  const runs: SubagentWaitRunObservation[] = [];
  for (const owner of owners) {
    const result = await joinWithSignal(deps.orchestrator.joinBatch(owner.runId), input.signal);
    cacheBatchResults(deps, result);
    const taskResult = result.results[0];
    let alreadyMerged: boolean | undefined;
    let summaryPreview = taskResult?.summaryPreview;
    if (taskResult?.childSessionId) {
      try {
        const merged = await deps.merge(taskResult.childSessionId);
        alreadyMerged = merged.alreadyMerged ?? false;
        summaryPreview = merged.summaryPreview ?? summaryPreview;
      } catch {
        // Observation still succeeds; merge is best-effort for available summaries.
      }
    }
    const observation: SubagentWaitRunObservation = {
      runId: owner.runId,
      ...(owner.invocationIds[0] ? { invocationId: owner.invocationIds[0] } : {}),
      ...(taskResult?.childSessionId ? { childSessionId: taskResult.childSessionId } : {}),
      ...(summaryPreview ? { summaryPreview } : {}),
      ...(alreadyMerged !== undefined ? { alreadyMerged } : {}),
      batchStatus: result.status,
      executionStatus: taskResult?.executionStatus ?? 'failed',
      integrationStatus: taskResult?.integrationStatus ?? 'not-requested',
      ...(taskResult?.summaryStatus ? { summaryStatus: taskResult.summaryStatus } : {}),
      ...(taskResult?.error ? { error: taskResult.error } : {}),
    };
    runs.push(observation);
  }
  return { runs };
}

async function cancelSubagentRuns(
  deps: SubagentControlDeps,
  sessionId: string,
  input: { runIds: string[]; parentSessionId: string; parentRunId: string },
): Promise<SubagentCancelResult> {
  const owners = await resolveValidatedOwners(
    deps,
    sessionId,
    input.runIds,
    'cancel',
    input.parentRunId,
  );
  const runs: SubagentCancelResult['runs'] = [];
  for (const owner of owners) {
    if (!owner.active) {
      if (owner.status === 'running') {
        await deps.orchestrator.cancelBatch(owner.runId);
        runs.push({
          runId: owner.runId,
          status: 'cancelling',
          ...(owner.invocationIds[0] ? { invocationId: owner.invocationIds[0] } : {}),
        });
        continue;
      }
      runs.push({
        runId: owner.runId,
        status: 'already-terminal',
        ...(owner.invocationIds[0] ? { invocationId: owner.invocationIds[0] } : {}),
      });
      continue;
    }
    await deps.orchestrator.cancelBatch(owner.runId);
    runs.push({
      runId: owner.runId,
      status: deps.orchestrator.isRunning(owner.runId) ? 'cancelling' : 'cancelled',
      ...(owner.invocationIds[0] ? { invocationId: owner.invocationIds[0] } : {}),
    });
  }
  return { runs };
}

async function joinWithSignal<T>(join: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return join;
  if (signal.aborted) {
    throw new SubagentControlError('aborted', 'aborted while waiting for subagent', true);
  }
  return await new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      cleanup();
      reject(new SubagentControlError('aborted', 'aborted while waiting for subagent', true));
    };
    const cleanup = (): void => {
      signal.removeEventListener('abort', onAbort);
    };
    signal.addEventListener('abort', onAbort);
    join.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}

export function formatWaitToolResult(result: SubagentWaitResult): {
  output: string;
  details: Record<string, unknown>;
} {
  const rows = result.runs.map((run) =>
    boundSubagentControlRunDisplay({
      runId: run.runId,
      executionStatus: run.executionStatus,
      ...(run.invocationId ? { invocationId: run.invocationId } : {}),
      ...(run.childSessionId ? { childSessionId: run.childSessionId } : {}),
      ...(run.summaryPreview ? { summaryPreview: run.summaryPreview } : {}),
      ...(run.summaryStatus ? { summaryStatus: run.summaryStatus } : {}),
      ...(run.integrationStatus ? { integrationStatus: run.integrationStatus } : {}),
    }),
  );
  const failed = result.runs.filter((run) => run.executionStatus === 'failed').length;
  const cancelled = result.runs.filter((run) => run.executionStatus === 'cancelled').length;
  const completed = result.runs.filter((run) => run.executionStatus === 'completed').length;
  const needsIntegration = result.runs.filter(
    (run) => run.batchStatus === 'needs-integration',
  ).length;
  const display = boundSubagentControlDisplay({
    phase: 'waited',
    total: result.runs.length,
    completed,
    failed,
    cancelled,
    needsIntegration,
    runs: rows,
  });
  const output = result.runs
    .map(
      (run) =>
        `${run.runId}:${run.executionStatus}` +
        (run.integrationStatus ? `/${run.integrationStatus}` : '') +
        (run.summaryPreview ? ` ${run.summaryPreview}` : ''),
    )
    .join('\n');
  return {
    output: `subagent wait (${result.runs.length} runs)\n${output}`,
    details: {
      runs: result.runs,
      controlDisplay: display,
    },
  };
}

export function formatCancelToolResult(result: SubagentCancelResult): {
  output: string;
  details: Record<string, unknown>;
} {
  const cancelled = result.runs.filter((run) => run.status === 'cancelled').length;
  const alreadyTerminal = result.runs.filter((run) => run.status === 'already-terminal').length;
  const display = boundSubagentControlDisplay({
    phase: cancelled > 0 || result.runs.some((run) => run.status === 'cancelling')
      ? 'cancelling'
      : 'cancelled',
    total: result.runs.length,
    cancelled,
    alreadyTerminal,
    runs: result.runs.map((run) =>
      boundSubagentControlRunDisplay({
        runId: run.runId,
        executionStatus:
          run.status === 'already-terminal' ? 'completed' : run.executionStatus ?? 'cancelled',
        ...(run.invocationId ? { invocationId: run.invocationId } : {}),
      }),
    ),
  });
  const output = result.runs.map((run) => `${run.runId}:${run.status}`).join('\n');
  return {
    output: `subagent cancel (${result.runs.length} runs)\n${output}`,
    details: {
      runs: result.runs,
      controlDisplay: display,
    },
  };
}
