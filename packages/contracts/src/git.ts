/** Git domain models for @piwin/git and host IPC. */

export type GitFileStatusCode =
  | 'untracked'
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'typechange'
  | 'conflicted'
  | 'unknown';

export type GitChangedFile = {
  path: string;
  /** Path before rename/copy when available. */
  previousPath?: string;
  status: GitFileStatusCode;
  staged: boolean;
  unstaged: boolean;
};

export type GitRepositoryIdentity = {
  /** Absolute path to git work tree root. */
  rootPath: string;
  /** True when projectPath is inside a git work tree. */
  isRepository: boolean;
};

export type GitBranchStatus = {
  currentBranch: string | null;
  /** Detached HEAD when currentBranch is null but commit is present. */
  isDetached: boolean;
  headCommit: string | null;
  upstreamBranch: string | null;
  ahead: number;
  behind: number;
  dirty: boolean;
};

export type GitStatusSnapshot = {
  repository: GitRepositoryIdentity;
  branch: GitBranchStatus | null;
  changedFiles: GitChangedFile[];
  /** Truncated when repository has very large change sets. */
  truncated: boolean;
  totalChangedFiles: number;
};

export type GitDiffFileStat = {
  path: string;
  status: GitFileStatusCode;
  additions: number;
  deletions: number;
};

export type GitDiffSummary = {
  repository: GitRepositoryIdentity;
  files: GitDiffFileStat[];
  totalAdditions: number;
  totalDeletions: number;
  truncated: boolean;
  totalFiles: number;
};

export type GitCommitGraphNode = {
  hash: string;
  shortHash: string;
  subject: string;
  authorName: string;
  authorDateIso: string;
  parentHashes: string[];
};

export type GitCommitGraph = {
  repository: GitRepositoryIdentity;
  nodes: GitCommitGraphNode[];
  /** True when more history exists beyond the requested limit. */
  truncated: boolean;
};

/** Write operations (policy-gated at host). Never includes force-push / hard reset. */
export type GitMutationKind =
  | 'stage'
  | 'unstage'
  | 'commit'
  | 'branch-create'
  | 'checkout';

export type GitMutationResult = {
  kind: GitMutationKind;
  ok: true;
  message: string;
};

export type GitStageInput = {
  projectPath: string;
  /** Empty = stage all (-A). Paths relative to repo root. */
  paths: string[];
};

export type GitUnstageInput = {
  projectPath: string;
  paths: string[];
};

export type GitCommitInput = {
  projectPath: string;
  message: string;
  /** When true, stage all tracked modifications before commit (git commit -a). Default false. */
  allTracked?: boolean;
};

export type GitBranchCreateInput = {
  projectPath: string;
  name: string;
  /** Checkout after create. Default true. */
  checkout?: boolean;
};

export type GitCheckoutInput = {
  projectPath: string;
  ref: string;
};
