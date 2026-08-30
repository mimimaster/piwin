/** CE-SUB: product-layer sub-agent isolation modes (not Pi fork). */

import type { SubagentDeliveryIntent } from './subagent-delivery.js';
import type { SubagentCapability } from './subagent-profile.js';

export type SubagentIsolationMode = 'readonly' | 'worktree';

export type SubagentApplyPolicy = 'none' | 'auto' | 'explicit';

export type SubagentSpawnOptions = {
  mode?: SubagentIsolationMode;
  applyPolicy?: SubagentApplyPolicy;
  deliveryIntent?: SubagentDeliveryIntent;
  /** Only used when applyPolicy is explicit; paths relative to project root. */
  allowedOutputPaths?: string[];
  retainWorktree?: boolean;
  /**
   * Product call name from an orchestration scheme roster (e.g. scout).
   * Distinct from `profileId`, which is the capability recipe.
   */
  role?: string;
  /**
   * Profile id resolved by the Host before child creation. Model-facing
   * callers may pass this; the Host validates it against Settings/built-ins.
   */
  profileId?: string;
  /**
   * Resolved product capability allowlist. The Host fills this from the
   * profile + caller restrictions; callers cannot widen it beyond the profile.
   */
  capabilities?: SubagentCapability[];
  /**
   * Resolved skill allowlist. The Host fills this from the profile intersected
   * with globally enabled skills.
   */
  skillIds?: string[];
};

export type SubagentWorktreeInfo = {
  path: string;
  branch: string;
  retained?: boolean;
};
