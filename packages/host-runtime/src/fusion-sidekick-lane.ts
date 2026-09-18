/**
 * Fusion sidekick spawn policy: brief envelope, no nested delegate, retained
 * candidate worktree, optional continuation of one persistent child lane.
 */
import {
  FUSION_SCHEME_ID,
  FUSION_SIDEKICK_ROLE,
  SUBAGENT_CAPABILITIES,
  formatFusionBriefEnvelope,
  type ResolvedOrchestrationScheme,
  type SessionIndexRecord,
  type SubagentApplyPolicy,
  type SubagentCapability,
  type SubagentDeliveryIntent,
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

export function isFusionSidekickRole(
  scheme: Pick<ResolvedOrchestrationScheme, 'schemeId'> | undefined,
  role: string | undefined,
): boolean {
  return scheme?.schemeId === FUSION_SCHEME_ID && role === FUSION_SIDEKICK_ROLE;
}

export type FusionStartTaskPatch = {
  task: string;
  retainWorktree: true;
  deliveryIntent: Extract<SubagentDeliveryIntent, 'candidate'>;
  applyPolicy: Extract<SubagentApplyPolicy, 'explicit'>;
  capabilities: SubagentCapability[];
  continuationSessionId?: string;
  continuationWorkspaceLease?: SubagentWorkspaceLease;
};

export function buildFusionSidekickSpawnFields(task: string): FusionStartTaskPatch {
  return {
    task: formatFusionBriefEnvelope(task),
    retainWorktree: true,
    deliveryIntent: 'candidate',
    applyPolicy: 'explicit',
    capabilities: [...FUSION_SIDEKICK_CAPABILITIES],
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

export function isFusionLaneWorktreeRetained(
  child: Pick<
    SessionIndexRecord,
    'subagentRetainWorktree' | 'subagentLifecycle' | 'subagentMode' | 'worktreePath'
  >,
): boolean {
  const integration = child.subagentLifecycle?.integrationStatus;
  const userRetained = child.subagentRetainWorktree === true;
  const statusRetained =
    integration === 'retained' || integration === 'conflict' || integration === 'failed';
  if (!userRetained && !statusRetained) return false;
  if ((child.subagentMode ?? 'worktree') === 'worktree' && !child.worktreePath) return false;
  return true;
}

export async function resolveFusionSidekickLane(
  deps: SubagentContinuationPrepDeps,
  parentSessionId: string,
): Promise<PreparedSubagentContinuation | undefined> {
  const indexPath = getPiwinSessionIndexPath(getPiwinRoot(deps.options.piwinRoot));
  const children = await listChildSessions(indexPath, parentSessionId);
  const lane = selectFusionSidekickLane(children);
  if (!lane) return undefined;
  try {
    return await prepareRetainedSubagentContinuation(deps, lane.id);
  } catch {
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
  if (!isFusionSidekickRole(input.scheme, input.role)) return undefined;
  const fields = buildFusionSidekickSpawnFields(input.task);
  if (!input.resolveLane) return fields;
  const lane = await input.resolveLane(input.parentSessionId);
  if (!lane) return fields;
  return {
    ...fields,
    continuationSessionId: lane.child.id,
    continuationWorkspaceLease: lane.continuationWorkspaceLease,
  };
}
