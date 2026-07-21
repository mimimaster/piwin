/**
 * Public façade for git read + write models.
 * Desktop/CLI/host should depend on this, not individual readers/mutators.
 */
import type {
  GitBranchCreateInput,
  GitCheckoutInput,
  GitCommitGraph,
  GitCommitInput,
  GitDiffSummary,
  GitMutationResult,
  GitStageInput,
  GitStatusSnapshot,
  GitUnstageInput,
} from '@piwin/contracts';
import { probeGitRepository } from './repository-probe.js';
import { readGitStatus } from './status-reader.js';
import { readGitDiffSummary } from './diff-summary.js';
import { readGitCommitGraph } from './commit-graph.js';
import {
  checkoutRef,
  commitChanges,
  createBranch,
  stagePaths,
  unstagePaths,
} from './mutations.js';

export type GitService = {
  getStatus(projectPath: string): Promise<GitStatusSnapshot>;
  getDiffSummary(projectPath: string): Promise<GitDiffSummary>;
  getCommitGraph(projectPath: string, limit?: number): Promise<GitCommitGraph>;
  stage(input: GitStageInput): Promise<GitMutationResult>;
  unstage(input: GitUnstageInput): Promise<GitMutationResult>;
  commit(input: GitCommitInput): Promise<GitMutationResult>;
  createBranch(input: GitBranchCreateInput): Promise<GitMutationResult>;
  checkout(input: GitCheckoutInput): Promise<GitMutationResult>;
};

export function createGitService(): GitService {
  return {
    async getStatus(projectPath) {
      const repository = await probeGitRepository(projectPath);
      return readGitStatus({ repository });
    },
    async getDiffSummary(projectPath) {
      const repository = await probeGitRepository(projectPath);
      return readGitDiffSummary({ repository });
    },
    async getCommitGraph(projectPath, limit) {
      const repository = await probeGitRepository(projectPath);
      const options: Parameters<typeof readGitCommitGraph>[0] = { repository };
      if (limit !== undefined) {
        options.limit = limit;
      }
      return readGitCommitGraph(options);
    },
    stage: stagePaths,
    unstage: unstagePaths,
    commit: commitChanges,
    createBranch,
    checkout: checkoutRef,
  };
}
