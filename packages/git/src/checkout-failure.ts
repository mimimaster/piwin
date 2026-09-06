/**
 * Turn git checkout stderr into a Host-facing error string.
 * Known failures get a stable prefix so Desktop can localize without
 * parsing git's English fatal line or dumping a file list into a toast.
 */
import {
  BRANCH_CHECKED_OUT_IN_WORKTREE_PREFIX,
  CHECKOUT_BLOCKED_BY_LOCAL_CHANGES_PREFIX,
} from '@piwin/contracts';

const OCCUPIED_WORKTREE_PATTERN = /already used by worktree at '([^']+)'/;
const LOCAL_CHANGES_OVERWRITE_PATTERN = /would be overwritten by checkout/i;

export function formatGitCheckoutFailure(stderr: string, fallbackMessage: string): string {
  const trimmedStderr = stderr.trim();
  const occupiedMatch = trimmedStderr.match(OCCUPIED_WORKTREE_PATTERN);
  const occupiedPath = occupiedMatch?.[1]?.trim();
  if (occupiedPath) {
    return `${BRANCH_CHECKED_OUT_IN_WORKTREE_PREFIX} ${occupiedPath}`;
  }
  if (
    LOCAL_CHANGES_OVERWRITE_PATTERN.test(trimmedStderr) ||
    LOCAL_CHANGES_OVERWRITE_PATTERN.test(fallbackMessage)
  ) {
    return CHECKOUT_BLOCKED_BY_LOCAL_CHANGES_PREFIX;
  }
  if (trimmedStderr.length > 0) {
    return trimmedStderr.replace(/^(?:fatal|error):\s*/i, '');
  }
  const trimmedFallback = fallbackMessage.trim();
  return trimmedFallback.length > 0 ? trimmedFallback : 'checkout failed';
}
