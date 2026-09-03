import { describe, expect, it } from 'vitest';
import { clusterProjectsByRepository } from './sidebar-repo-groups';

describe('clusterProjectsByRepository', () => {
  it('leaves a single-worktree repo as a flat folder', () => {
    expect(
      clusterProjectsByRepository([
        { path: '/piwin', displayName: 'piwin', gitRepositoryId: 'aaaa', isPrimaryWorktree: true },
        { path: '/notes', displayName: 'notes' },
      ]),
    ).toEqual([
      {
        kind: 'solo',
        project: {
          path: '/piwin',
          displayName: 'piwin',
          gitRepositoryId: 'aaaa',
          isPrimaryWorktree: true,
        },
      },
      { kind: 'solo', project: { path: '/notes', displayName: 'notes' } },
    ]);
  });

  it('groups linked worktrees under the primary display name', () => {
    const clusters = clusterProjectsByRepository([
      {
        path: '/Volumes/BigDisk/piwin-cc',
        displayName: 'piwin-cc',
        gitRepositoryId: 'repo1',
        currentBranch: 'plan/concurrency-convergence',
      },
      {
        path: '/Users/me/piwin',
        displayName: 'piwin',
        gitRepositoryId: 'repo1',
        isPrimaryWorktree: true,
        currentBranch: 'main',
      },
      { path: '/other', displayName: 'other', gitRepositoryId: 'repo2', isPrimaryWorktree: true },
    ]);
    expect(clusters).toEqual([
      {
        kind: 'group',
        gitRepositoryId: 'repo1',
        title: 'piwin',
        members: [
          {
            path: '/Users/me/piwin',
            displayName: 'piwin',
            gitRepositoryId: 'repo1',
            isPrimaryWorktree: true,
            currentBranch: 'main',
          },
          {
            path: '/Volumes/BigDisk/piwin-cc',
            displayName: 'piwin-cc',
            gitRepositoryId: 'repo1',
            currentBranch: 'plan/concurrency-convergence',
          },
        ],
      },
      {
        kind: 'solo',
        project: {
          path: '/other',
          displayName: 'other',
          gitRepositoryId: 'repo2',
          isPrimaryWorktree: true,
        },
      },
    ]);
  });
});
