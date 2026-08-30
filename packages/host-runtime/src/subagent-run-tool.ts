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
  SubagentApplyPolicy,
  SubagentDeliveryIntent,
  SubagentIsolationMode,
  ThinkingLevel,
  ToolResult,
} from '@piwin/contracts';
import { formatError, parseSubagentDeliveryFields } from '@piwin/contracts';
import {
  isSubagentDeliveryPolicyError,
  resolveSubagentDeliveryPolicy,
} from './subagent-delivery-policy.js';

export type SubagentRunSeam = {
  /** Spawn a child subagent session and wait for it to finish. */
  spawn: (input: {
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
    signal?: AbortSignal;
  }) => Promise<{
    childSessionId: string;
    batchStatus: SubagentBatchResult['status'];
    executionStatus: SubagentExecutionStatus;
    integrationStatus: SubagentIntegrationStatus;
    error?: string;
    worktreePath?: string;
  }>;
  /** Merge a completed child session's summary into its parent. */
  merge: (childSessionId: string) => Promise<{
    summaryPreview?: string;
    alreadyMerged?: boolean;
  }>;
};

export type SubagentRunToolOptions = {
  sessionId: string;
  seam: SubagentRunSeam;
};

const ISOLATION_MODES: ReadonlySet<string> = new Set(['readonly', 'worktree']);

function invalidSubagentInput(message: string): ToolResult {
  return { ok: false, code: 'invalid-input', message };
}

export function createSubagentRunTool(options: SubagentRunToolOptions): HostToolRegistration {
  return {
    descriptor: {
      name: 'piwin_subagent_run',
      description:
        'Run a self-contained subtask in a child session; returns only a summary to this conversation. ' +
        'Use for heavy exploration, independent implementation slices, or focused verification. ' +
        'Task text must include acceptance criteria. Default mode readonly; worktree for isolated writes. ' +
        'Child cannot spawn further subagents.',
      parameters: {
        type: 'object',
        properties: {
          task: {
            type: 'string',
            description:
              'The task to delegate. Must be self-contained — the subagent starts with a fresh ' +
              "context and does not see this conversation's history. Include all necessary context " +
              'and acceptance criteria in the task text.',
          },
          role: {
            type: 'string',
            description:
              'Orchestration scheme roster role (e.g. "scout", "coder", "reviewer"). ' +
              'When an orchestration scheme is active, prefer role over free-form profileId/model. ' +
              'The Host resolves the role to a profile, model, and isolation from the scheme members.',
          },
          mode: {
            type: 'string',
            description:
              'Isolation override: "readonly" (safe default) or "worktree" (write access in a ' +
              'temporary git worktree branch). When profileId is set and mode is omitted, the ' +
              'profile isolation is used.',
          },
          sessionName: {
            type: 'string',
            description: 'Optional short name for the subagent session (shown in UI)',
          },
          deliveryIntent: {
            type: 'string',
            enum: ['report', 'integrate', 'candidate'],
            description:
              'How the child result should be delivered: "report" (read-only summary), ' +
              '"integrate" (apply worktree changes to the parent workspace), or "candidate" ' +
              '(keep an isolated proposal for later review). Default follows isolation.',
          },
          applyPolicy: {
            type: 'string',
            enum: ['none', 'auto', 'explicit'],
            description:
              'Worktree change application policy: "none" (default, changes stay in the worktree) ' +
              'or "auto"/"explicit" (apply changed files back to the parent branch on merge). ' +
              'Only relevant when mode is "worktree". Kept until runtime replacement.',
          },
          profileId: {
            type: 'string',
            description:
              'Optional subagent profile id (e.g. "explorer", "reviewer", "implementer", "tester"). ' +
              "When set, the Host resolves the profile's model, thinking level, capabilities, skills, " +
              'and isolation. The profile cannot be widened by this call.',
          },
          model: {
            type: 'object',
            description:
              'Optional per-call model override. Must reference a provider/model already configured ' +
              'in Settings. Overrides the profile model; cannot widen capabilities or isolation.',
            properties: {
              protocol: { type: 'string' },
              providerId: { type: 'string' },
              modelId: { type: 'string' },
            },
          },
          thinkingLevel: {
            type: 'string',
            enum: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
            description: 'Optional per-call thinking level override.',
          },
        },
        required: ['task'],
      },
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
      const task = String(args.task ?? '').trim();
      if (!task) return invalidSubagentInput('task is required');

      const sessionNameRaw = String(args.sessionName ?? '').trim();
      const sessionName = sessionNameRaw || undefined;

      const roleRaw = String(args.role ?? '').trim();
      const role = roleRaw || undefined;

      const profileIdRaw = String(args.profileId ?? '').trim();
      const profileId = profileIdRaw || undefined;

      const modeRaw =
        args.mode === undefined && profileId ? undefined : String(args.mode ?? 'readonly').trim();
      let mode: SubagentIsolationMode | undefined;
      if (modeRaw !== undefined) {
        if (!ISOLATION_MODES.has(modeRaw)) {
          return invalidSubagentInput(
            `invalid mode "${modeRaw}" (expected "readonly" or "worktree")`,
          );
        }
        mode = modeRaw as SubagentIsolationMode;
      }

      if (args.deliveryIntent !== undefined && typeof args.deliveryIntent !== 'string') {
        return invalidSubagentInput('unknown deliveryIntent');
      }
      if (args.applyPolicy !== undefined && typeof args.applyPolicy !== 'string') {
        return invalidSubagentInput('unknown applyPolicy');
      }
      const parsedDelivery = parseSubagentDeliveryFields({
        ...(typeof args.deliveryIntent === 'string' ? { deliveryIntent: args.deliveryIntent } : {}),
        ...(typeof args.applyPolicy === 'string' ? { applyPolicy: args.applyPolicy } : {}),
      });
      if (!parsedDelivery.ok) return invalidSubagentInput(parsedDelivery.message);
      if (mode !== undefined) {
        const policy = resolveSubagentDeliveryPolicy({
          ...(parsedDelivery.deliveryIntent !== undefined
            ? { deliveryIntent: parsedDelivery.deliveryIntent }
            : {}),
          ...(parsedDelivery.applyPolicy !== undefined
            ? { applyPolicy: parsedDelivery.applyPolicy }
            : {}),
          isolation: mode,
          source: 'model-tool',
          activateNewIntegrateDefault: false,
        });
        if (!policy.ok) return invalidSubagentInput(policy.message);
      }
      const deliveryIntent = parsedDelivery.deliveryIntent;
      const applyPolicy = parsedDelivery.applyPolicy;

      const modelRaw = args.model as
        { protocol?: string; providerId?: string; modelId?: string } | undefined;
      const model: ModelRef | undefined =
        modelRaw &&
        typeof modelRaw === 'object' &&
        modelRaw.providerId &&
        modelRaw.modelId
          ? {
              providerId: modelRaw.providerId,
              modelId: modelRaw.modelId,
              ...(modelRaw.protocol
                ? { protocol: modelRaw.protocol as NonNullable<ModelRef['protocol']> }
                : {}),
            }
          : undefined;

      const thinkingLevelRaw = String(args.thinkingLevel ?? '').trim();
      const thinkingLevel: ThinkingLevel | undefined =
        thinkingLevelRaw &&
        ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(
          thinkingLevelRaw,
        )
          ? (thinkingLevelRaw as ThinkingLevel)
          : undefined;

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
          return invalidSubagentInput(message);
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
