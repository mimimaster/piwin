import { describe, expect, it } from 'vitest';
import type { GitWorktreeEntry } from '@piwin/contracts';
import {
  annotateBranchesWithWorktreeOccupancy,
  parseGitWorktreeListPorcelain,
} from './worktree-list.js';

describe('parseGitWorktreeListPorcelain', () => {
  it('parses primary, linked, detached, and locked records', () => {
    const stdout = [
      'worktree /repo',
      'HEAD abc123',
      'branch refs/heads/main',
      '',
      'worktree /repo-cc',
      'HEAD def456',
      'branch refs/heads/plan/concurrency-convergence',
      'locked',
      '',
      'worktree /repo-detached',
      'HEAD 789aaa',
      'detached',
      '',
    ].join('\n');

    expect(parseGitWorktreeListPorcelain(stdout)).toEqual([
      {
        worktreePath: '/repo',
        branch: 'main',
        headCommit: 'abc123',
        isPrimary: true,
        locked: false,
      },
      {
        worktreePath: '/repo-cc',
        branch: 'plan/concurrency-convergence',
        headCommit: 'def456',
        isPrimary: false,
        locked: true,
      },
      {
        worktreePath: '/repo-detached',
        branch: null,
        headCommit: '789aaa',
        isPrimary: false,
        locked: false,
      },
    ]);
  });
});

describe('annotateBranchesWithWorktreeOccupancy', () => {
  const worktrees: GitWorktreeEntry[] = [
    {
      worktreePath: '/repo',
      branch: 'main',
      headCommit: 'abc',
      isPrimary: true,
      locked: false,
      reachable: true,
    },
    {
      worktreePath: '/repo-cc',
      branch: 'plan/concurrency-convergence',
      headCommit: 'def',
      isPrimary: false,
      locked: false,
      reachable: true,
    },
    {
      worktreePath: '/missing-wt',
      branch: 'feat/gone',
      headCommit: 'eee',
      isPrimary: false,
      locked: false,
      reachable: false,
    },
  ];

  it('marks other worktrees without tagging the current checkout', () => {
    const annotated = annotateBranchesWithWorktreeOccupancy(
      [
        { name: 'main', current: true, shortHash: 'abc' },
        { name: 'plan/concurrency-convergence', current: false, shortHash: 'def' },
        { name: 'feat/free', current: false, shortHash: 'fff' },
      ],
      worktrees,
      '/repo',
    );
    expect(annotated).toEqual([
      { name: 'main', current: true, shortHash: 'abc' },
      {
        name: 'plan/concurrency-convergence',
        current: false,
        shortHash: 'def',
        checkedOutWorktreePath: '/repo-cc',
      },
      { name: 'feat/free', current: false, shortHash: 'fff' },
    ]);
  });

  it('flags occupied branches whose worktree path is missing', () => {
    const annotated = annotateBranchesWithWorktreeOccupancy(
      [{ name: 'feat/gone', current: false, shortHash: 'eee' }],
      worktrees,
      '/repo',
    );
    expect(annotated).toEqual([
      {
        name: 'feat/gone',
        current: false,
        shortHash: 'eee',
        checkedOutWorktreePath: '/missing-wt',
        checkedOutWorktreeMissing: true,
      },
    ]);
  });
});
