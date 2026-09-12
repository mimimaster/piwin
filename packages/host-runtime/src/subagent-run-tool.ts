/**
 * Host custom tool: piwin_subagent_run — model-facing subagent delegation
 * (SDK only). RPC mode cannot register custom tools (ADR 0008).
 *
 * The model calls this when it identifies a self-contained subtask that
 * benefits from isolated context — codebase exploration, parallel
 * implementation, or focused verification. The tool spawns a child session,
 * waits for it to complete, merges the summary back, and returns it to the
 * parent model. The parent never sees the child's intermediate reasoning,
 * only the final summary — preserving parent context window budget.
 *
 * Depth max is 1: a readonly/worktree subagent does not receive this tool,
 * preventing nested subagent spawning through the retired direct lifecycle
 * path.
 */
import { randomUUID } from 'node:crypto';
import { passThroughPrepareArgs } from './tools/pass-through-prepare-args.js';
import type {
  HostToolExecutionContext,
  HostToolRegistration,
  ModelRef,
  SubagentBatchResult,
  SubagentExecutionStatus,
  SubagentIntegrationStatus,
  SubagentSummaryStatus,
  SubagentApplyPolicy,
  ChangeVersionRef,
  SubagentDeliveryIntent,
  SubagentIsolationMode,
  SubagentResultRef,
  SubagentReviewDecision,
  SubagentReviewRef,
  ThinkingLevel,
} from '@piwin/contracts';
import { formatError } from '@piwin/contracts';
import { isSubagentDeliveryPolicyError } from './subagent-delivery-policy.js';
import {
  parseSubagentStartInput,
  subagentStartInputParameters,
} from './subagent-tool-input.js';

export type SubagentSpawnInput = {
    parentSessionId: string;
    invocationId: string;
    parentRunId: string;
    parentToolCallId?: string;
    task: string;
    mode?: SubagentIsolationMode;
    applyPolicy?: SubagentApplyPolicy;
    deliveryIntent?: SubagentDeliveryIntent;
    sessionName?: string;
    /** ORCH-V2: scheme roster role (preferred when a scheme is active). */
    role?: string;
    /** CE-SUB-PROF: profile id resolved by the Host. */
    profileId?: string;
    /** CE-SUB-PROF: per-call model override (must reference a configured model). */
    model?: ModelRef;
    /** CE-SUB-PROF: per-call thinking level override. */
    thinkingLevel?: ThinkingLevel;
    /** Exact result to bind as a reviewer target. Host fills reviewTarget. */
    reviewOf?: SubagentResultRef;
    signal?: AbortSignal;
};

export type SubagentSpawnResult = {
  childSessionId: string;
  batchStatus: SubagentBatchResult['status'];
  executionStatus: SubagentExecutionStatus;
  integrationStatus: SubagentIntegrationStatus;
  error?: string;
  worktreePath?: string;
};

export type SubagentWaitRunObservation = {
  runId: string;
  invocationId?: string;
  childSessionId?: string;
  title?: string;
  summaryPreview?: string;
  alreadyMerged?: boolean;
  batchStatus: SubagentBatchResult['status'];
  executionStatus: SubagentExecutionStatus;
  integrationStatus: SubagentIntegrationStatus;
  summaryStatus?: SubagentSummaryStatus;
  error?: string;
  resultRef?: SubagentResultRef;
  childChanges?: ChangeVersionRef;
  reviewRef?: SubagentReviewRef;
  reviewDecision?: SubagentReviewDecision;
};

export type SubagentWaitResult = {
  runs: SubagentWaitRunObservation[];
};

export type SubagentCancelRunObservation = {
  runId: string;
  status: 'cancelling' | 'cancelled' | 'already-terminal';
  invocationId?: string;
  executionStatus?: SubagentExecutionStatus;
};

export type SubagentCancelResult = {
  runs: SubagentCancelRunObservation[];
};

export type SubagentRunSeam = {
  /** Spawn a child subagent session and wait for it to finish. */
  spawn: (input: SubagentSpawnInput) => Promise<SubagentSpawnResult>;
  /** Merge a completed child session's summary into its parent. */
  merge: (childSessionId: string) => Promise<{
    summaryPreview?: string;
    alreadyMerged?: boolean;
  }>;
  /** Start one child and return after durable acceptance. */
  start?: (input: SubagentSpawnInput) => Promise<{
    runId: string;
    invocationId: string;
  }>;
  wait?: (input: {
    runIds: string[];
    parentSessionId: string;
    parentRunId: string;
    signal?: AbortSignal;
  }) => Promise<SubagentWaitResult>;
  cancel?: (input: {
    runIds: string[];
    parentSessionId: string;
    parentRunId: string;
  }) => Promise<SubagentCancelResult>;
  /** Continue one reviewed terminal child after durable changes-requested. */
  continueReviewed?: (input: {
    parentSessionId: string;
    invocationId: string;
    parentRunId: string;
    parentToolCallId?: string;
    childSessionId: string;
    expectedResult: SubagentResultRef;
    review: SubagentReviewRef;
    task: string;
    signal?: AbortSignal;
  }) => Promise<{
    runId: string;
    invocationId: string;
  }>;
};

export type SubagentRunToolOptions = {
  sessionId: string;
  seam: SubagentRunSeam;
};

export function createSubagentRunTool(options: SubagentRunToolOptions): HostToolRegistration {
  return {
    descriptor: {
      name: 'piwin_subagent_run',
      description:
        'Run a self-contained subtask in a child session; returns only a summary to this conversation. ' +
        'Use for heavy exploration, independent implementation slices, or focused verification. ' +
        'Task text must include acceptance criteria. Default mode readonly; worktree for isolated writes. ' +
        'Child cannot spawn further subagents.',
      parameters: subagentStartInputParameters,
    },
    family: 'delegate',
    permissionSpec: {
      action: 'subagent:run',
      risk: 'unknown',
      rememberable: false,
      subjectBuilder: () => ({ kind: 'tool', action: 'subagent:run' }),
    },
    prepareArgs: passThroughPrepareArgs,
    async execute(args, signal, context: HostToolExecutionContext) {
      const parsedInput = parseSubagentStartInput(args);
      if (!parsedInput.ok) return parsedInput;
      const {
        task,
        mode,
        sessionName,
        deliveryIntent,
        applyPolicy,
        role,
        profileId,
        model,
        thinkingLevel,
        reviewOf,
      } = parsedInput.value;

      if (signal?.aborted) {
        return {
          ok: false,
          code: 'aborted',
          message: 'aborted before spawn',
          details: { runId: context.runId },
          cancelled: true,
        };
      }

      let spawnResult: Awaited<ReturnType<SubagentRunSeam['spawn']>>;
      try {
        spawnResult = await options.seam.spawn({
          parentSessionId: options.sessionId,
          invocationId: randomUUID(),
          parentRunId: context.runId,
          ...(context.toolCallId ? { parentToolCallId: context.toolCallId } : {}),
          task,
          ...(mode ? { mode } : {}),
          ...(sessionName ? { sessionName } : {}),
          ...(deliveryIntent ? { deliveryIntent } : {}),
          ...(applyPolicy ? { applyPolicy } : {}),
          ...(role ? { role } : {}),
          ...(profileId ? { profileId } : {}),
          ...(model ? { model } : {}),
          ...(thinkingLevel ? { thinkingLevel } : {}),
          ...(reviewOf ? { reviewOf } : {}),
          ...(signal ? { signal } : {}),
        });
      } catch (error) {
        const message = formatError(error);
        if (message.includes('subagent-unavailable-fallback-main:')) {
          return {
            ok: false,
            code: 'subagent-unavailable-fallback-main',
            message,
            details: { runId: context.runId, ...(role ? { role } : {}) },
            retryable: false,
          };
        }
        if (message.includes('fallback=none')) {
          return {
            ok: false,
            code: 'subagent-unavailable',
            message,
            details: { runId: context.runId, ...(role ? { role } : {}) },
            retryable: false,
          };
        }
        if (message.includes('subagent-delegation-disabled:')) {
          return {
            ok: false,
            code: 'subagent-delegation-disabled',
            message,
            details: { runId: context.runId },
            retryable: false,
          };
        }
        if (isSubagentDeliveryPolicyError(message)) {
          return { ok: false, code: 'invalid-input', message };
        }
        return { ok: false, code: 'subagent-failed', message, retryable: true };
      }

      if (signal?.aborted) {
        return {
          ok: false,
          code: 'aborted',
          message: `aborted during subagent run (childSessionId=${spawnResult.childSessionId})`,
          details: { childSessionId: spawnResult.childSessionId, runId: context.runId },
          cancelled: true,
        };
      }

      try {
        const mergeResult = await options.seam.merge(spawnResult.childSessionId);
        const preview = mergeResult.summaryPreview ?? '(no summary)';
        if (spawnResult.batchStatus !== 'completed') {
          const statusDetail =
            `batch=${spawnResult.batchStatus}, execution=${spawnResult.executionStatus}, ` +
            `integration=${spawnResult.integrationStatus}`;
          const failureDetail = spawnResult.error ? `\nError: ${spawnResult.error}` : '';
          const code =
            spawnResult.batchStatus === 'needs-integration'
              ? 'subagent-needs-integration'
              : spawnResult.batchStatus === 'cancelled'
                ? 'subagent-cancelled'
                : 'subagent-failed';
          return {
            ok: false,
            code,
            message:
              `subagent did not complete successfully (${statusDetail}, ` +
              `childSessionId=${spawnResult.childSessionId}):\n${preview}${failureDetail}`,
            details: {
              childSessionId: spawnResult.childSessionId,
              runId: context.runId,
              batchStatus: spawnResult.batchStatus,
              executionStatus: spawnResult.executionStatus,
              integrationStatus: spawnResult.integrationStatus,
              ...(spawnResult.worktreePath ? { worktreePath: spawnResult.worktreePath } : {}),
            },
            retryable: false,
            ...(spawnResult.batchStatus === 'cancelled' ? { cancelled: true } : {}),
          };
        }
        const prefix = mergeResult.alreadyMerged
          ? 'subagent completed (summary from prior merge)'
          : 'subagent completed';
        const warning = spawnResult.error ? `\nWarning: ${spawnResult.error}` : '';
        return {
          ok: true,
          output: `${prefix} (childSessionId=${spawnResult.childSessionId}):\n${preview}${warning}`,
          details: {
            childSessionId: spawnResult.childSessionId,
            runId: context.runId,
            alreadyMerged: mergeResult.alreadyMerged ?? false,
            batchStatus: spawnResult.batchStatus,
            executionStatus: spawnResult.executionStatus,
            integrationStatus: spawnResult.integrationStatus,
            ...(spawnResult.error ? { warning: spawnResult.error } : {}),
          },
        };
      } catch (error) {
        const message = formatError(error);
        return {
          ok: false,
          code: 'subagent-failed',
          message: `subagent merge failed (childSessionId=${spawnResult.childSessionId}): ${message}`,
          details: { childSessionId: spawnResult.childSessionId, runId: context.runId },
          retryable: false,
        };
      }
    },
  };
}
