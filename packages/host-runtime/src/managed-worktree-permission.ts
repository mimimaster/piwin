import { join, relative } from 'node:path';
import type { PermissionRule } from '@piwin/contracts';
import { escapesRoot } from '@piwin/project';

/** Host-only provenance: user-authored rules can never acquire this exception. */
const writableRootByBundledRule = new WeakMap<PermissionRule, string>();

export type BundledWorkspacePermissionScope = {
  /** Canonical product root; callers performing IO resolve symlinks first. */
  piwinRoot?: string;
  /** Current writable lease only, never a client/model-provided cwd. */
  writableWorktreeRoot?: string;
};

export function createProductRootDenyRule(
  protectedRoot: string,
  scope: BundledWorkspacePermissionScope,
): PermissionRule {
  const rule: PermissionRule = {
    target: { kind: 'file-write', pathGlob: join(protectedRoot, '**') },
    decision: 'deny',
    reason: 'piwin-config',
  };
  const storageRoot = scope.piwinRoot ? join(scope.piwinRoot, 'worktrees') : undefined;
  const writableRoot = scope.writableWorktreeRoot;
  // A lease must be a proper descendant, never the product root/storage pool.
  if (storageRoot && writableRoot && relative(storageRoot, writableRoot).length > 0 &&
    !escapesRoot(storageRoot, writableRoot)) {
    writableRootByBundledRule.set(rule, writableRoot);
  }
  return rule;
}

/** Applied only after the rule's protected path glob matched the canonical target. */
export function isManagedWorktreeRuleException(rule: PermissionRule, path: string): boolean {
  const writableRoot = writableRootByBundledRule.get(rule);
  return writableRoot !== undefined && !escapesRoot(writableRoot, path);
}
