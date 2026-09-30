/**
 * Persistent-lane spawn policy (Fusion sidekick semantics): brief envelope,
 * no nested delegate, candidate worktree awaiting the Lead's apply, optional
 * continuation of one child lane. Any scheme member whose builtin behavior is
 * `lane: 'persistent'` gets it (Fusion, Auto).
 */
import {
  FUSION_SIDEKICK_ROLE,
  SUBAGENT_CAPABILITIES,
  formatFusionBriefEnvelope,
  type OrchestrationLeadReviewLimit,
  type ResolvedOrchestrationMember,
  type ResolvedOrchestrationScheme,
  type SessionIndexRecord,
  type SubagentApplyPolicy,
  type SubagentCapability,
  type SubagentDeliveryIntent,
  type SubagentReviewAuthority,
  type SubagentWorkspaceLease,
} from '@piwin/contracts';
import { listChildSessions } from '@piwin/session';
import { getPiwinRoot, getPiwinSessionIndexPath } from './paths.js';
import {
  prepareRetainedSubagentContinuation,
  type PreparedSubagentContinuation,
  type SubagentContinuationPrepDeps,
} from './subagent-continuation-prep.js';

export const FUSION_SIDEKICK_CAPABILITIES: readonly SubagentCapability[] =
  SUBAGENT_CAPABILITIES.filter((capability) => capability !== 'delegate');

function findSchemeMember(
  scheme: Pick<ResolvedOrchestrationScheme, 'members'> | undefined,
  role: string | undefined,
): ResolvedOrchestrationMember | undefined {
  if (!scheme || !role) return undefined;
  return scheme.members.find((member) => member.role === role);
}

/** True when the active scheme's member for `role` is a persistent writer lane. */
export function isFusionSidekickRole(
  scheme: Pick<ResolvedOrchestrationScheme, 'members'> | undefined,
  role: string | undefined,
): boolean {
  return findSchemeMember(scheme, role)?.behavior?.lane === 'persistent';
}

export type FusionStartTaskPatch = {
  task: string;
  deliveryIntent: Extract<SubagentDeliveryIntent, 'candidate'>;
  applyPolicy: Extract<SubagentApplyPolicy, 'explicit'>;
  /** Fusion has no reviewer member: the Lead records the approving review. */
  reviewAuthority: Extract<SubagentReviewAuthority, 'lead'>;
  /** Auto: candidates above this size need an independent reviewer instead. */
  leadReviewLimit?: OrchestrationLeadReviewLimit;
  capabilities: SubagentCapability[];
  continuationSessionId?: string;
  continuationWorkspaceLease?: SubagentWorkspaceLease;
  /** The lane's frozen state; a shared writer slot must restore it first. */
  continuationRestore?: { baseCommit: string; tree: string };
};

export function buildFusionSidekickSpawnFields(
  task: string,
  leadReviewLimit?: OrchestrationLeadReviewLimit,
): FusionStartTaskPatch {
  return {
    task: formatFusionBriefEnvelope(task),
    deliveryIntent: 'candidate',
    applyPolicy: 'explicit',
    reviewAuthority: 'lead',
    capabilities: [...FUSION_SIDEKICK_CAPABILITIES],
    ...(leadReviewLimit ? { leadReviewLimit: { ...leadReviewLimit } } : {}),
  };
}

export function selectFusionSidekickLane(
  children: readonly SessionIndexRecord[],
): SessionIndexRecord | undefined {
  return children.find((child) => {
    if (child.kind !== 'subagent') return false;
    if (child.subagentRole !== FUSION_SIDEKICK_ROLE) return false;
    if (child.subagentStatus === 'running' || child.subagentStatus === 'cancelled') return false;
    const execution = child.subagentLifecycle?.executionStatus;
    if (execution === 'queued' || execution === 'running') return false;
    if (!isFusionLaneWorktreeRetained(child)) return false;
    return true;
  });
}

/**
 * A lane continues only while its last candidate is still unapplied — the same
 * states `resolveRetainedSubagentWorktreeLease` accepts. After an apply the
 * worktree's base predates the parent, so the next brief needs a fresh lane.
 */
export function isFusionLaneWorktreeRetained(
  child: Pick<SessionIndexRecord, 'subagentLifecycle' | 'subagentMode' | 'worktreePath'>,
): boolean {
  const integration = child.subagentLifecycle?.integrationStatus;
  if (integration !== 'retained' && integration !== 'conflict' && integration !== 'failed') {
    return false;
  }
  if ((child.subagentMode ?? 'worktree') === 'worktree' && !child.worktreePath) return false;
  return true;
}

export async function resolveFusionSidekickLane(
  deps: SubagentContinuationPrepDeps,
  parentSessionId: string,
  onLaneUnavailable: (laneId: string, error: unknown) => void,
): Promise<PreparedSubagentContinuation | undefined> {
  const indexPath = getPiwinSessionIndexPath(getPiwinRoot(deps.options.piwinRoot));
  const children = await listChildSessions(indexPath, parentSessionId);
  const lane = selectFusionSidekickLane(children);
  if (!lane) return undefined;
  try {
    return await prepareRetainedSubagentContinuation(deps, lane.id);
  } catch (error) {
    // A lane that cannot continue (worktree gone, lease missing) falls back to
    // a fresh sidekick, but the fallback must be visible, not silent.
    onLaneUnavailable(lane.id, error);
    return undefined;
  }
}

export async function resolveFusionStartTaskPatch(input: {
  scheme: ResolvedOrchestrationScheme | undefined;
  role: string | undefined;
  task: string;
  parentSessionId: string;
  resolveLane?: (
    parentSessionId: string,
  ) => Promise<PreparedSubagentContinuation | undefined>;
}): Promise<FusionStartTaskPatch | undefined> {
  const member = findSchemeMember(input.scheme, input.role);
  if (member?.behavior?.lane !== 'persistent') return undefined;
  const fields = buildFusionSidekickSpawnFields(input.task, member.behavior.leadReviewLimit);
  if (!input.resolveLane) return fields;
  const lane = await input.resolveLane(input.parentSessionId);
  if (!lane) return fields;
  return {
    ...fields,
    continuationSessionId: lane.child.id,
    continuationWorkspaceLease: lane.continuationWorkspaceLease,
    ...(lane.continuationRestore ? { continuationRestore: lane.continuationRestore } : {}),
  };
}
