import { describe, expect, it } from 'vitest';
import {
  BRANCH_CHECKED_OUT_IN_WORKTREE_PREFIX,
  CHECKOUT_BLOCKED_BY_LOCAL_CHANGES_PREFIX,
} from '@piwin/contracts';
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

  it('collapses local-change overwrite stderr into a stable prefix', () => {
    expect(
      formatGitCheckoutFailure(
        'error: Your local changes to the following files would be overwritten by checkout:\n    README.md\n    apps/desktop/src/styles/transcript.css\nPlease commit your changes or stash them before you switch branches.\nAborting',
        'Command failed',
      ),
    ).toBe(CHECKOUT_BLOCKED_BY_LOCAL_CHANGES_PREFIX);
  });

  it('collapses untracked overwrite stderr into the same prefix', () => {
    expect(
      formatGitCheckoutFailure(
        'error: The following untracked working tree files would be overwritten by checkout:\n    fixture.png\nPlease move or remove them before you switch branches.\nAborting',
        'Command failed',
      ),
    ).toBe(CHECKOUT_BLOCKED_BY_LOCAL_CHANGES_PREFIX);
  });

  it('strips the fatal prefix from other checkout stderr', () => {
    expect(
      formatGitCheckoutFailure(
        "fatal: invalid reference: 'no-such-branch'",
        'Command failed',
      ),
    ).toBe("invalid reference: 'no-such-branch'");
  });

  it('collapses overwrite text even when it only appears in the fallback', () => {
    expect(
      formatGitCheckoutFailure(
        '',
        'Command failed: git checkout feat\nYour local changes to the following files would be overwritten by checkout:\n    README.md',
      ),
    ).toBe(CHECKOUT_BLOCKED_BY_LOCAL_CHANGES_PREFIX);
  });

  it('falls back to the node message when stderr is empty', () => {
    expect(formatGitCheckoutFailure('', 'Command failed: git checkout feat')).toBe(
      'Command failed: git checkout feat',
    );
  });
});
