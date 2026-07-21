/** @piwin/git — modular git read/write models. */

export { runGitCommand, GitCommandError } from './git-command-runner.js';
export type { GitCommandResult, RunGitCommandOptions } from './git-command-runner.js';

export { probeGitRepository } from './repository-probe.js';

export { parsePorcelainStatus, parsePorcelainFileLine } from './status-parser.js';
export type { ParsedGitStatus } from './status-parser.js';

export { readGitStatus } from './status-reader.js';
export type { ReadGitStatusOptions } from './status-reader.js';

export { readGitDiffSummary, parseNumstat } from './diff-summary.js';
export type { ReadGitDiffSummaryOptions } from './diff-summary.js';

export { readGitCommitGraph, parseGitLogRecords } from './commit-graph.js';
export type { ReadGitCommitGraphOptions } from './commit-graph.js';

export {
  assertSafeRepoRelativePaths,
  assertSafeBranchName,
  assertSafeRef,
  assertSafeCommitMessage,
} from './path-safety.js';

export {
  evaluateGitStagePolicy,
  evaluateGitCommitPolicy,
  evaluateGitBranchPolicy,
  evaluateGitCheckoutPolicy,
} from './mutation-policy.js';
export type { GitMutationPolicyEvaluation } from './mutation-policy.js';

export {
  stagePaths,
  unstagePaths,
  commitChanges,
  createBranch,
  checkoutRef,
} from './mutations.js';

export { createGitService } from './git-service.js';
export type { GitService } from './git-service.js';
