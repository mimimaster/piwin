/** CE-SUB: product-layer sub-agent isolation modes (not Pi fork). */

export type SubagentIsolationMode = 'readonly' | 'worktree';

export type SubagentApplyPolicy = 'none' | 'auto' | 'explicit';

export type SubagentSpawnOptions = {
  mode?: SubagentIsolationMode;
  applyPolicy?: SubagentApplyPolicy;
  /** Only used when applyPolicy is explicit; paths relative to project root. */
  allowedOutputPaths?: string[];
  retainWorktree?: boolean;
  role?: string;
};

export type SubagentWorktreeInfo = {
  path: string;
  branch: string;
  retained?: boolean;
};
