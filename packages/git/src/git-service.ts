/**
 * Public façade for git read + write models.
 * Desktop/CLI/host should depend on this, not individual readers/mutators.
 */
import type {
  GitBranchCreateInput,
  GitBranchList,
  GitCheckoutInput,
  GitCommitGraph,
  GitCommitInput,
  GitDiffSummary,
  GitFileDiff,
  GitMutationResult,
  GitStageInput,
  GitStatusSnapshot,
  GitUnstageInput,
} from '@piwin/contracts';
import { probeGitRepository } from './repository-probe.js';
import { readGitBranchList } from './branch-list.js';
import { readGitStatus } from './status-reader.js';
import { readGitDiffSummary } from './diff-summary.js';
import { readGitFileDiff } from './file-diff.js';
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
  listBranches(projectPath: string, limit?: number): Promise<GitBranchList>;
  getDiffSummary(projectPath: string): Promise<GitDiffSummary>;
  getFileDiff(
    projectPath: string,
    path: string,
    scope?: 'worktree' | 'staged' | 'combined',
  ): Promise<GitFileDiff>;
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
    async listBranches(projectPath, limit) {
      const repository = await probeGitRepository(projectPath);
      const options: Parameters<typeof readGitBranchList>[0] = { repository };
      if (limit !== undefined) {
        options.limit = limit;
      }
      return readGitBranchList(options);
    },
    async getDiffSummary(projectPath) {
      const repository = await probeGitRepository(projectPath);
      return readGitDiffSummary({ repository });
    },
    async getFileDiff(projectPath, path, scope) {
      const repository = await probeGitRepository(projectPath);
      const options: Parameters<typeof readGitFileDiff>[0] = {
        repository,
        path,
      };
      if (scope !== undefined) {
        options.scope = scope;
      }
      return readGitFileDiff(options);
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
