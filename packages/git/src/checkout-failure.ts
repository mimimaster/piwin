/**
 * Turn git checkout stderr into a Host-facing error string.
 * Occupancy failures get a stable prefix so Desktop can localize without
 * parsing git's English fatal line.
 */
import { BRANCH_CHECKED_OUT_IN_WORKTREE_PREFIX } from '@piwin/contracts';

const OCCUPIED_WORKTREE_PATTERN = /already used by worktree at '([^']+)'/;

export function formatGitCheckoutFailure(stderr: string, fallbackMessage: string): string {
  const trimmedStderr = stderr.trim();
  const occupiedMatch = trimmedStderr.match(OCCUPIED_WORKTREE_PATTERN);
  const occupiedPath = occupiedMatch?.[1]?.trim();
  if (occupiedPath) {
    return `${BRANCH_CHECKED_OUT_IN_WORKTREE_PREFIX} ${occupiedPath}`;
  }
  if (trimmedStderr.length > 0) {
    return trimmedStderr.replace(/^fatal:\s*/i, '');
  }
  const trimmedFallback = fallbackMessage.trim();
  return trimmedFallback.length > 0 ? trimmedFallback : 'checkout failed';
}
