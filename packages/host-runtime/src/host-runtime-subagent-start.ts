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
  type ResolvedOrchestrationScheme,
  type SubagentBatchRequest,
  type SubagentBatchResult,
  type SubagentIsolationMode,
  type SubagentResultRef,
  type SubagentReviewDecision,
  type SubagentReviewRef,
  type SubagentTaskResult,
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
import {
  SubagentControlError,
  awaitAcceptedBatch,
  cacheBatchResults,
  observeAcceptedBatch,
} from './subagent-accepted-batch.js';
import { resolveFusionStartTaskPatch } from './fusion-sidekick-lane.js';
import { resolveSchemeDeliveryLock } from './scheme-delivery-lock.js';
import type { PreparedSubagentContinuation } from './subagent-continuation-prep.js';
import type { DetachedSubagentRegistry } from './detached-subagent-reports.js';

export { SubagentControlError };

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
  /**
   * Detached members (Auto tester): per-session registry. Absent = detached
   * behavior is ignored and the child is an ordinary run-scoped task.
   */
  detachedRegistry?: DetachedSubagentRegistry;
  /** A detached batch finished; the Host delivers its report later. */
  onDetachedBatchSettled?: (input: {
    sessionId: string;
    runId: string;
    schemeId?: string;
    result: SubagentBatchResult;
  }) => void;
  bindReviewTarget?: (input: {
    parentSessionId: string;
    reviewOf: SubagentResultRef;
    resolvedIsolation: SubagentIsolationMode;
    role?: string;
  }) => BindSubagentReviewTargetResult;
  observePersistedReview?: (runId: string) => Promise<
    | {
        reviewRef: SubagentReviewRef;
        reviewDecision: SubagentReviewDecision;
      }
    | undefined
  >;
  resolveFusionLane?: (
    parentSessionId: string,
  ) => Promise<PreparedSubagentContinuation | undefined>;
};

type PreparedStart = {
  handle: ReturnType<SubagentOrchestrator['startBatch']>;
  releaseAdmission: () => void;
  /** Started without a parent run: survives it, reports later. */
  detached?: { schemeId?: string };
};

export function createSubagentControlSeam(
  deps: SubagentControlDeps,
  sessionId: string,
): SubagentRunSeam {
  return {
    spawn: async (input) => {
      const prepared = await prepareAndStartSubagent(deps, sessionId, input, { allowDetach: false });
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
      const prepared = await prepareAndStartSubagent(deps, sessionId, input, { allowDetach: true });
      if (prepared.detached) {
        await startDetached(deps, sessionId, prepared, prepared.detached, input.signal);
        return {
          runId: prepared.handle.runId,
          invocationId: input.invocationId,
        };
      }
      observeAcceptedBatch(deps, prepared);
      await awaitAcceptedBatch(deps, prepared.handle, input.signal);
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

/**
 * Detached start: admission is released as soon as the child is accepted (it
 * does not count against the parent turn), a previous detached child of this
 * session is cancelled, and completion is handed to the Host for late
 * delivery instead of the parent's settlement.
 */
async function startDetached(
  deps: SubagentControlDeps,
  sessionId: string,
  prepared: PreparedStart,
  detached: { schemeId?: string },
  signal: AbortSignal | undefined,
): Promise<void> {
  try {
    await awaitAcceptedBatch(deps, prepared.handle, signal);
  } finally {
    prepared.releaseAdmission();
  }
  const runId = prepared.handle.runId;
  const replaced = deps.detachedRegistry?.replace(sessionId, {
    runId,
    ...(detached.schemeId ? { schemeId: detached.schemeId } : {}),
  });
  if (replaced) {
    void deps.orchestrator.cancelBatch(replaced).catch(() => {});
  }
  void prepared.handle.completion
    .then((result) => {
      cacheBatchResults(deps, result);
      const entry = deps.detachedRegistry?.settle(sessionId, runId);
      // A replaced run is cancelled on purpose; its report is noise.
      if (!entry) return;
      deps.onDetachedBatchSettled?.({
        sessionId,
        runId,
        ...(entry.schemeId ? { schemeId: entry.schemeId } : {}),
        result,
      });
    })
    .catch(() => {
      deps.detachedRegistry?.settle(sessionId, runId);
    });
}

async function prepareAndStartSubagent(
  deps: SubagentControlDeps,
  sessionId: string,
  input: SubagentSpawnInput,
  startMode: { allowDetach: boolean },
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
    const fusionPatch = await resolveFusionStartTaskPatch({
      scheme: activeScheme,
      role: schemeSpawn.role,
      task: input.task,
      parentSessionId: sessionId,
      ...(deps.resolveFusionLane ? { resolveLane: deps.resolveFusionLane } : {}),
    });
    const deliveryLock = resolveSchemeDeliveryLock(activeScheme, schemeSpawn.role);
    const detached =
      startMode.allowDetach && schemeSpawn.behavior?.detached === true && deps.detachedRegistry
        ? true
        : false;
    // A detached child never applies: freeze its edits as an explicit
    // candidate nobody approves, based on a workspace snapshot.
    const detachedFields = detached
      ? {
          deliveryIntent: 'candidate' as const,
          applyPolicy: 'explicit' as const,
          workspaceSnapshot: true,
        }
      : undefined;
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
            task: fusionPatch?.task ?? input.task,
            ...(mode ? { isolationOverride: mode } : {}),
            ...(fusionPatch
              ? {
                  applyPolicy: fusionPatch.applyPolicy,
                  deliveryIntent: fusionPatch.deliveryIntent,
                  reviewAuthority: fusionPatch.reviewAuthority,
                  capabilities: fusionPatch.capabilities,
                  ...(fusionPatch.leadReviewLimit
                    ? { leadReviewLimit: fusionPatch.leadReviewLimit }
                    : {}),
                }
              : {
                  ...(input.applyPolicy ? { applyPolicy: input.applyPolicy } : {}),
                  ...(input.deliveryIntent ? { deliveryIntent: input.deliveryIntent } : {}),
                  ...deliveryLock,
                  ...detachedFields,
                }),
            ...(fusionPatch?.continuationSessionId
              ? { continuationSessionId: fusionPatch.continuationSessionId }
              : {}),
            ...(fusionPatch?.continuationWorkspaceLease
              ? { continuationWorkspaceLease: fusionPatch.continuationWorkspaceLease }
              : {}),
            ...(fusionPatch?.continuationRestore
              ? { continuationRestore: fusionPatch.continuationRestore }
              : {}),
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
      activeScheme ? 'model-tool' : 'model-tool-freehand',
    );
    const preparedTask = preparedRequest.tasks[0];
    const forcedRequest =
      fusionPatch && preparedTask
        ? {
            ...preparedRequest,
            tasks: [
              {
                ...preparedTask,
                capabilities: fusionPatch.capabilities,
                deliveryIntent: fusionPatch.deliveryIntent,
                applyPolicy: fusionPatch.applyPolicy,
                reviewAuthority: fusionPatch.reviewAuthority,
                ...(fusionPatch.leadReviewLimit
                  ? { leadReviewLimit: fusionPatch.leadReviewLimit }
                  : {}),
              },
            ],
          }
        : (deliveryLock || detachedFields) && preparedTask
          ? {
              ...preparedRequest,
              tasks: [{ ...preparedTask, ...deliveryLock, ...detachedFields }],
            }
          : preparedRequest;
    const admittedRequest = input.reviewOf
      ? attachReviewTarget(deps, sessionId, input.reviewOf, forcedRequest)
      : forcedRequest;
    // Detached: no parent run, so the parent's settlement, cancel, and
    // replace never reach it.
    const handle = deps.orchestrator.startBatch(
      admittedRequest,
      detached ? undefined : parentRunId,
    );
    return {
      handle,
      releaseAdmission,
      ...(detached
        ? { detached: activeScheme ? { schemeId: activeScheme.schemeId } : {} }
        : {}),
    };
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
    // The task manifest still records the run that started it, so identity
    // comes from the registry, not from a missing parentRunId.
    const detachedOwner = deps.detachedRegistry?.isDetached(sessionId, runId) === true;
    if (mode === 'wait' && detachedOwner) {
      throw new SubagentControlError(
        'invalid-input',
        `subagent run ${runId} is a detached tester: do not wait for it; its report arrives later on its own`,
      );
    }
    if (mode === 'cancel' && detachedOwner) {
      owners.push(owner);
      continue;
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
    const persistedReview = await deps.observePersistedReview?.(owner.runId);
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
      ...(taskResult?.resultRef ? { resultRef: taskResult.resultRef } : {}),
      ...(taskResult?.childChanges ? { childChanges: taskResult.childChanges } : {}),
      ...(persistedReview
        ? {
            reviewRef: persistedReview.reviewRef,
            reviewDecision: persistedReview.reviewDecision,
          }
        : taskResult?.reviewRef
          ? {
              reviewRef: taskResult.reviewRef,
              ...(taskResult.review ? { reviewDecision: taskResult.review.decision } : {}),
            }
          : {}),
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

/**
 * Exact refs in the model-visible text. Pi hands the model only the text
 * content — `details` reach the UI, never the model — yet review, continue and
 * apply all demand the exact `{resultId, revision}` / `{reviewId, revision}`
 * from this wait. JSON so the model can copy them into tool args verbatim.
 */
function formatWaitRunRefs(run: SubagentWaitRunObservation): string {
  let refs = '';
  if (run.resultRef) {
    refs += ` result=${JSON.stringify({
      resultId: run.resultRef.resultId,
      revision: run.resultRef.revision,
    })}`;
  }
  if (run.reviewDecision) refs += ` review=${run.reviewDecision}`;
  if (run.reviewRef) {
    refs += ` reviewRef=${JSON.stringify({
      reviewId: run.reviewRef.reviewId,
      revision: run.reviewRef.revision,
    })}`;
  }
  return refs;
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
        formatWaitRunRefs(run) +
        (run.executionStatus !== 'completed' && run.error
          ? ` reason=${run.error.slice(0, 240)}`
          : '') +
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
