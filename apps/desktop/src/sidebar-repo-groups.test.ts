import { describe, expect, it } from 'vitest';
import { clusterProjectsByRepository } from './sidebar-repo-groups';

describe('clusterProjectsByRepository', () => {
  it('nests a repo subdirectory under the containing project instead of a worktree group', () => {
    const clusters = clusterProjectsByRepository([
      {
        path: '/Users/me/piwin/apps',
        displayName: 'apps',
        gitRepositoryId: 'repo1',
        isPrimaryWorktree: true,
        currentBranch: 'main',
      },
      {
        path: '/Users/me/piwin',
        displayName: 'piwin',
        gitRepositoryId: 'repo1',
        isPrimaryWorktree: true,
        currentBranch: 'main',
      },
    ]);
    expect(clusters).toEqual([
      {
        kind: 'solo',
        project: {
          path: '/Users/me/piwin',
          displayName: 'piwin',
          gitRepositoryId: 'repo1',
          isPrimaryWorktree: true,
          currentBranch: 'main',
          nested: [
            {
              path: '/Users/me/piwin/apps',
              displayName: 'apps',
              gitRepositoryId: 'repo1',
              isPrimaryWorktree: true,
              currentBranch: 'main',
            },
          ],
        },
      },
    ]);
  });

  it('keeps a true linked worktree grouped while nesting a subdirectory under the primary', () => {
    const clusters = clusterProjectsByRepository([
      {
        path: '/Users/me/piwin',
        displayName: 'piwin',
        gitRepositoryId: 'repo1',
        isPrimaryWorktree: true,
        currentBranch: 'main',
      },
      {
        path: '/Users/me/piwin/apps',
        displayName: 'apps',
        gitRepositoryId: 'repo1',
        isPrimaryWorktree: true,
        currentBranch: 'main',
      },
      {
        path: '/Volumes/disk/piwin-cc',
        displayName: 'piwin-cc',
        gitRepositoryId: 'repo1',
        currentBranch: 'plan/x',
      },
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
            nested: [
              {
                path: '/Users/me/piwin/apps',
                displayName: 'apps',
                gitRepositoryId: 'repo1',
                isPrimaryWorktree: true,
                currentBranch: 'main',
              },
            ],
          },
          {
            path: '/Volumes/disk/piwin-cc',
            displayName: 'piwin-cc',
            gitRepositoryId: 'repo1',
            currentBranch: 'plan/x',
          },
        ],
      },
    ]);
  });

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
