import { describe, expect, it } from 'vitest';
import { BRANCH_CHECKED_OUT_IN_WORKTREE_PREFIX } from '@piwin/contracts';
import { formatGitCheckoutFailure } from './checkout-failure.js';

describe('formatGitCheckoutFailure', () => {
  it('normalizes a worktree occupancy fatal into a stable prefix', () => {
    expect(
      formatGitCheckoutFailure(
        "fatal: 'plan/concurrency-convergence' is already used by worktree at '/Volumes/BigDisk/piwin-cc'",
        'Command failed: git checkout plan/concurrency-convergence',
      ),
    ).toBe(`${BRANCH_CHECKED_OUT_IN_WORKTREE_PREFIX} /Volumes/BigDisk/piwin-cc`);
  });

  it('strips the fatal prefix from other checkout stderr', () => {
    expect(
      formatGitCheckoutFailure(
        'fatal: Your local changes to the following files would be overwritten by checkout:\n    README.md',
        'Command failed',
      ),
    ).toBe(
      'Your local changes to the following files would be overwritten by checkout:\n    README.md',
    );
  });

  it('falls back to the node message when stderr is empty', () => {
    expect(formatGitCheckoutFailure('', 'Command failed: git checkout feat')).toBe(
      'Command failed: git checkout feat',
    );
  });
});
