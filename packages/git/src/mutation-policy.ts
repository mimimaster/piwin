/**
 * Pure policy for git write operations.
 * Host may still require interactive confirmation; this rejects impossible/dangerous inputs early.
 */
import type { PermissionDecision } from '@piwin/contracts';

export type GitMutationPolicyEvaluation = {
  decision: PermissionDecision;
  reason: string;
};

export function evaluateGitStagePolicy(paths: string[]): GitMutationPolicyEvaluation {
  if (paths.some((path) => path.includes('.git/'))) {
    return { decision: 'deny', reason: 'cannot-stage-git-dir' };
  }
  return { decision: 'allow', reason: 'stage-ok' };
}

export function evaluateGitCommitPolicy(message: string): GitMutationPolicyEvaluation {
  if (!message.trim()) {
    return { decision: 'deny', reason: 'empty-message' };
  }
  // always ask for commits in interactive hosts; pure layer marks ask
  return { decision: 'ask', reason: 'commit-requires-confirm' };
}

export function evaluateGitBranchPolicy(name: string): GitMutationPolicyEvaluation {
  if (name === 'main' || name === 'master') {
    return { decision: 'ask', reason: 'protected-branch-name' };
  }
  return { decision: 'ask', reason: 'branch-create-requires-confirm' };
}

export function evaluateGitCheckoutPolicy(ref: string): GitMutationPolicyEvaluation {
  if (ref.includes('..')) {
    return { decision: 'deny', reason: 'invalid-ref' };
  }
  return { decision: 'ask', reason: 'checkout-requires-confirm' };
}
