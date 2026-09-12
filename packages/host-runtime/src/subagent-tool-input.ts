import type {
  ModelRef,
  SubagentApplyPolicy,
  SubagentDeliveryIntent,
  SubagentIsolationMode,
  ThinkingLevel,
  ToolResult,
} from '@piwin/contracts';
import { parseSubagentDeliveryFields } from '@piwin/contracts';

const ISOLATION_MODES: ReadonlySet<string> = new Set(['readonly', 'worktree']);

const THINKING_LEVELS: ReadonlySet<string> = new Set([
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]);

export const subagentStartInputParameters = {
  type: 'object' as const,
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
  required: ['task'] as const,
};

export type SubagentStartInput = {
  task: string;
  role?: string;
  mode?: SubagentIsolationMode;
  sessionName?: string;
  deliveryIntent?: SubagentDeliveryIntent;
  applyPolicy?: SubagentApplyPolicy;
  profileId?: string;
  model?: ModelRef;
  thinkingLevel?: ThinkingLevel;
};

type InvalidSubagentInput = Extract<ToolResult, { ok: false }>;

function invalidSubagentInput(message: string): InvalidSubagentInput {
  return { ok: false, code: 'invalid-input', message };
}

export function parseSubagentStartInput(
  args: Record<string, unknown>,
): { ok: true; value: SubagentStartInput } | InvalidSubagentInput {
  const task = String(args.task ?? '').trim();
  if (!task) return invalidSubagentInput('task is required');

  const sessionNameRaw = String(args.sessionName ?? '').trim();
  const sessionName = sessionNameRaw || undefined;

  const roleRaw = String(args.role ?? '').trim();
  const role = roleRaw || undefined;

  const profileIdRaw = String(args.profileId ?? '').trim();
  const profileId = profileIdRaw || undefined;

  // Leave omitted mode unresolved. The Host must apply the active scheme
  // and profile before choosing an isolation or delivery default.
  const modeRaw = args.mode === undefined ? undefined : String(args.mode ?? '').trim();
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
  const deliveryIntent = parsedDelivery.deliveryIntent;
  const applyPolicy = parsedDelivery.applyPolicy;

  const modelRaw = args.model as
    | { protocol?: string; providerId?: string; modelId?: string }
    | undefined;
  const model: ModelRef | undefined =
    modelRaw && typeof modelRaw === 'object' && modelRaw.providerId && modelRaw.modelId
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
    thinkingLevelRaw && THINKING_LEVELS.has(thinkingLevelRaw)
      ? (thinkingLevelRaw as ThinkingLevel)
      : undefined;

  return {
    ok: true,
    value: {
      task,
      ...(role ? { role } : {}),
      ...(mode ? { mode } : {}),
      ...(sessionName ? { sessionName } : {}),
      ...(deliveryIntent ? { deliveryIntent } : {}),
      ...(applyPolicy ? { applyPolicy } : {}),
      ...(profileId ? { profileId } : {}),
      ...(model ? { model } : {}),
      ...(thinkingLevel ? { thinkingLevel } : {}),
    },
  };
}

export function parseSubagentRunIds(
  args: Record<string, unknown>,
): { ok: true; value: string[] } | InvalidSubagentInput {
  const runIdsRaw = args.runIds;
  if (!Array.isArray(runIdsRaw)) {
    return invalidSubagentInput('runIds must be an array of strings');
  }

  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const entry of runIdsRaw) {
    if (typeof entry !== 'string') {
      return invalidSubagentInput('runIds must be an array of strings');
    }
    const trimmed = entry.trim();
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    deduped.push(trimmed);
  }

  if (deduped.length === 0) {
    return invalidSubagentInput('runIds must contain at least one id');
  }
  if (deduped.length > 8) {
    return invalidSubagentInput('runIds must contain at most 8 ids');
  }

  return { ok: true, value: deduped };
}
