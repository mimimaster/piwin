import { describe, expect, it } from 'vitest';
import {
  SUBAGENT_WORKTREE_GC_AUTO_MIN_AGE_MS,
  SUBAGENT_WORKTREE_GC_GRACE_MS,
} from '@piwin/contracts';
import {
  decideWorktreeGc,
  isUnfrozenWorktreeSnapshot,
  minAgeForWorktreeGc,
  type SubagentWorktreeGcFacts,
} from './subagent-worktree-gc-policy.js';

const SAFE: SubagentWorktreeGcFacts = {
  orphan: false,
  unsafePath: false,
  isPrimary: false,
  locked: false,
  branchAllowed: true,
  running: false,
  pendingIntegration: false,
  conflict: false,
  userRetained: false,
  unfrozenSnapshot: false,
  pauseCheckpoint: false,
  ageMs: SUBAGENT_WORKTREE_GC_AUTO_MIN_AGE_MS + 1,
};

describe('worktree GC policy', () => {
  it('uses 7 days for auto and a short grace for manual', () => {
    expect(minAgeForWorktreeGc('auto')).toBe(SUBAGENT_WORKTREE_GC_AUTO_MIN_AGE_MS);
    expect(minAgeForWorktreeGc('manual')).toBe(SUBAGENT_WORKTREE_GC_GRACE_MS);
  });

  it('reclaims an ended, unreferenced worktree', () => {
    expect(decideWorktreeGc(SAFE, { mode: 'auto' })).toEqual({
      reclaimable: true,
      keepReasons: [],
    });
  });

  it('keeps running, pending, conflict, retained, unfrozen, and pause-referenced copies', () => {
    expect(decideWorktreeGc({ ...SAFE, running: true }, { mode: 'auto' }).keepReasons).toContain(
      'running',
    );
    expect(
      decideWorktreeGc({ ...SAFE, pendingIntegration: true }, { mode: 'auto' }).keepReasons,
    ).toContain('pending-integration');
    expect(decideWorktreeGc({ ...SAFE, conflict: true }, { mode: 'auto' }).keepReasons).toContain(
      'conflict',
    );
    expect(
      decideWorktreeGc({ ...SAFE, userRetained: true }, { mode: 'auto' }).keepReasons,
    ).toContain('user-retained');
    expect(
      decideWorktreeGc({ ...SAFE, unfrozenSnapshot: true }, { mode: 'auto' }).keepReasons,
    ).toContain('unfrozen-snapshot');
    expect(
      decideWorktreeGc({ ...SAFE, pauseCheckpoint: true }, { mode: 'auto' }).keepReasons,
    ).toContain('pause-checkpoint');
  });

  it('does not apply lease-only guards to orphans', () => {
    const orphan = decideWorktreeGc(
      { ...SAFE, orphan: true, running: true, userRetained: true, pauseCheckpoint: true },
      { mode: 'auto' },
    );
    expect(orphan).toEqual({ reclaimable: true, keepReasons: [] });
  });

  it('still refuses unsafe, primary, locked, or too-recent orphans', () => {
    expect(
      decideWorktreeGc({ ...SAFE, orphan: true, unsafePath: true }, { mode: 'auto' }).reclaimable,
    ).toBe(false);
    expect(
      decideWorktreeGc({ ...SAFE, orphan: true, isPrimary: true }, { mode: 'auto' }).keepReasons,
    ).toContain('unsafe-path');
    expect(
      decideWorktreeGc({ ...SAFE, orphan: true, locked: true }, { mode: 'auto' }).keepReasons,
    ).toContain('locked');
    expect(
      decideWorktreeGc(
        { ...SAFE, orphan: true, ageMs: SUBAGENT_WORKTREE_GC_AUTO_MIN_AGE_MS - 1 },
        { mode: 'auto' },
      ).keepReasons,
    ).toContain('too-recent');
  });

  it('lets a confirmed cleanup skip the 7-day wait but not the in-flight grace', () => {
    const dayOld = decideWorktreeGc(
      { ...SAFE, ageMs: 24 * 60 * 60 * 1000 },
      { mode: 'manual' },
    );
    expect(dayOld.reclaimable).toBe(true);
    const justCreated = decideWorktreeGc(
      { ...SAFE, ageMs: SUBAGENT_WORKTREE_GC_GRACE_MS - 1 },
      { mode: 'manual' },
    );
    expect(justCreated.keepReasons).toEqual(['too-recent']);
  });

  it('treats completed write copies without a freeze as unfrozen', () => {
    expect(
      isUnfrozenWorktreeSnapshot({
        executionStatus: 'completed',
        integrationStatus: 'not-requested',
        deliveryIntent: 'candidate',
        hasResultRef: false,
      }),
    ).toBe(true);
    expect(
      isUnfrozenWorktreeSnapshot({
        executionStatus: 'cancelled',
        integrationStatus: 'not-requested',
        deliveryIntent: 'integrate',
        hasResultRef: false,
      }),
    ).toBe(false);
    expect(
      isUnfrozenWorktreeSnapshot({
        executionStatus: 'completed',
        integrationStatus: 'not-requested',
        deliveryIntent: 'candidate',
        hasResultRef: true,
      }),
    ).toBe(false);
  });
});
