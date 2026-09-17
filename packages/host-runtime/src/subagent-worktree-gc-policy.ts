/**
 * Pure leftover-worktree GC policy. Host inventory supplies facts; this
 * module never touches git or the filesystem.
 */
import {
  SUBAGENT_WORKTREE_GC_AUTO_MIN_AGE_MS,
  SUBAGENT_WORKTREE_GC_GRACE_MS,
  type SubagentWorktreeGcKeepReason,
  type SubagentWorktreeGcMode,
} from '@piwin/contracts';

export type SubagentWorktreeGcFacts = {
  orphan: boolean;
  unsafePath: boolean;
  isPrimary: boolean;
  locked: boolean;
  branchAllowed: boolean;
  running: boolean;
  pendingIntegration: boolean;
  conflict: boolean;
  userRetained: boolean;
  unfrozenSnapshot: boolean;
  pauseCheckpoint: boolean;
  ageMs: number;
};

export function minAgeForWorktreeGc(mode: SubagentWorktreeGcMode): number {
  return mode === 'auto' ? SUBAGENT_WORKTREE_GC_AUTO_MIN_AGE_MS : SUBAGENT_WORKTREE_GC_GRACE_MS;
}

export function decideWorktreeGc(
  facts: SubagentWorktreeGcFacts,
  input: { mode: SubagentWorktreeGcMode },
): { reclaimable: boolean; keepReasons: SubagentWorktreeGcKeepReason[] } {
  const keepReasons: SubagentWorktreeGcKeepReason[] = [];
  if (facts.unsafePath || facts.isPrimary || !facts.branchAllowed) {
    keepReasons.push('unsafe-path');
  }
  if (facts.locked) {
    keepReasons.push('locked');
  }
  if (facts.ageMs < minAgeForWorktreeGc(input.mode)) {
    keepReasons.push('too-recent');
  }
  if (!facts.orphan) {
    if (facts.running) keepReasons.push('running');
    if (facts.pendingIntegration) keepReasons.push('pending-integration');
    if (facts.conflict) keepReasons.push('conflict');
    if (facts.userRetained) keepReasons.push('user-retained');
    if (facts.unfrozenSnapshot) keepReasons.push('unfrozen-snapshot');
    if (facts.pauseCheckpoint) keepReasons.push('pause-checkpoint');
  }
  return { reclaimable: keepReasons.length === 0, keepReasons };
}

export function isSubagentWorktreeBranch(branch: string | null | undefined): boolean {
  return typeof branch === 'string' && branch.startsWith('piwin/subagent/');
}

export function isUnfrozenWorktreeSnapshot(input: {
  executionStatus: string;
  integrationStatus: string;
  deliveryIntent?: string;
  hasResultRef: boolean;
}): boolean {
  if (input.hasResultRef) return false;
  if (input.executionStatus !== 'completed') return false;
  if (input.integrationStatus === 'discarded' || input.integrationStatus === 'failed') {
    return false;
  }
  return input.deliveryIntent === 'candidate' || input.deliveryIntent === 'integrate';
}
