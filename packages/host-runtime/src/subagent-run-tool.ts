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
import type {
  SubagentApplyPolicy,
  SubagentIsolationMode,
  ModelRef,
  ThinkingLevel,
} from '@piwin/contracts';
import type { HostToolDefinition } from '@piwin/tools-web';

export type SubagentRunSeam = {
  /** Spawn a child subagent session and wait for it to finish. */
  spawn: (input: {
    parentSessionId: string;
    task: string;
    mode?: SubagentIsolationMode;
    applyPolicy?: SubagentApplyPolicy;
    sessionName?: string;
    /** CE-SUB-PROF: profile id resolved by the Host. */
    profileId?: string;
    /** CE-SUB-PROF: per-call model override (must reference a configured model). */
    model?: ModelRef;
    /** CE-SUB-PROF: per-call thinking level override. */
    thinkingLevel?: ThinkingLevel;
    signal?: AbortSignal;
  }) => Promise<{ childSessionId: string }>;
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

export function createSubagentRunTool(options: SubagentRunToolOptions): HostToolDefinition {
  return {
    name: 'piwin_subagent_run',
    description:
      'Delegate a self-contained subtask to an independent subagent with its own context window. ' +
      'Use for: codebase exploration that would flood this conversation with search results, ' +
      'parallel implementation of independent pieces, or focused verification passes. ' +
      'The subagent runs in its own context and returns only a summary — intermediate output ' +
      "does not consume this conversation's context. The subagent cannot spawn further subagents. " +
      'By default the subagent is readonly (cannot modify files); set mode to "worktree" for ' +
      'isolated write access in a temporary git worktree.',
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
        applyPolicy: {
          type: 'string',
          enum: ['none', 'auto', 'explicit'],
          description:
            'Worktree change application policy: "none" (default, changes stay in the worktree) ' +
            'or "auto"/"explicit" (apply changed files back to the parent branch on merge). ' +
            'Only relevant when mode is "worktree".',
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
          enum: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
          description: 'Optional per-call thinking level override.',
        },
      },
      required: ['task'],
    },
    async execute(args, signal) {
      const task = String(args.task ?? '').trim();
      if (!task) return 'error: task is required';

      const sessionNameRaw = String(args.sessionName ?? '').trim();
      const sessionName = sessionNameRaw || undefined;

      const applyPolicyRaw = String(args.applyPolicy ?? 'none').trim();
      const applyPolicy =
        applyPolicyRaw === 'auto' || applyPolicyRaw === 'explicit' ? applyPolicyRaw : 'none';

      const profileIdRaw = String(args.profileId ?? '').trim();
      const profileId = profileIdRaw || undefined;

      const modeRaw =
        args.mode === undefined && profileId
          ? undefined
          : String(args.mode ?? 'readonly').trim();
      let mode: SubagentIsolationMode | undefined;
      if (modeRaw !== undefined) {
        if (!ISOLATION_MODES.has(modeRaw)) {
          return `error: invalid mode "${modeRaw}" (expected "readonly" or "worktree")`;
        }
        mode = modeRaw as SubagentIsolationMode;
      }

      const modelRaw = args.model as
        { protocol?: string; providerId?: string; modelId?: string } | undefined;
      const model: ModelRef | undefined =
        modelRaw &&
        typeof modelRaw === 'object' &&
        modelRaw.protocol &&
        modelRaw.providerId &&
        modelRaw.modelId
          ? {
              protocol: modelRaw.protocol as ModelRef['protocol'],
              providerId: modelRaw.providerId,
              modelId: modelRaw.modelId,
            }
          : undefined;

      const thinkingLevelRaw = String(args.thinkingLevel ?? '').trim();
      const thinkingLevel: ThinkingLevel | undefined =
        thinkingLevelRaw &&
        ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(
          thinkingLevelRaw,
        )
          ? (thinkingLevelRaw as ThinkingLevel)
          : undefined;

      if (signal?.aborted) return 'error: aborted before spawn';

      let spawnResult: { childSessionId: string };
      try {
        spawnResult = await options.seam.spawn({
          parentSessionId: options.sessionId,
          task,
          ...(mode ? { mode } : {}),
          ...(sessionName ? { sessionName } : {}),
          ...(applyPolicy !== 'none' ? { applyPolicy } : {}),
          ...(profileId ? { profileId } : {}),
          ...(model ? { model } : {}),
          ...(thinkingLevel ? { thinkingLevel } : {}),
          ...(signal ? { signal } : {}),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return `error: subagent spawn failed: ${message}`;
      }

      if (signal?.aborted) {
        return `error: aborted during subagent run (childSessionId=${spawnResult.childSessionId})`;
      }

      try {
        const mergeResult = await options.seam.merge(spawnResult.childSessionId);
        const preview = mergeResult.summaryPreview ?? '(no summary)';
        const prefix = mergeResult.alreadyMerged
          ? 'subagent completed (summary from prior merge)'
          : 'subagent completed';
        return `${prefix} (childSessionId=${spawnResult.childSessionId}):\n${preview}`;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return `error: subagent merge failed (childSessionId=${spawnResult.childSessionId}): ${message}`;
      }
    },
  };
}
