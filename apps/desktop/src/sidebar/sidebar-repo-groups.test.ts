import { describe, expect, it } from 'vitest';
import {
  checkoutAliasPaths,
  clusterProjectsByRepository,
  foldCheckoutAliasProjects,
} from './sidebar-repo-groups';

describe('clusterProjectsByRepository', () => {
  it('groups a registered checkout with a discovered worktree without registering it', () => {
    const clusters = clusterProjectsByRepository(
      [{ path: '/repo', gitRepositoryId: 'repo1', gitRootPath: '/repo', currentBranch: 'main' }],
      [
        { gitRepositoryId: 'repo1', path: '/repo', branch: 'main', isPrimary: true },
        { gitRepositoryId: 'repo1', path: '/worktrees/feature', branch: 'feat/x', isPrimary: false },
      ],
    );
    expect(clusters).toMatchObject([{
      kind: 'group',
      members: [{ path: '/repo' }],
      unregistered: [{ path: '/worktrees/feature', branch: 'feat/x' }],
    }]);
  });

  it('uses the discovered primary checkout name when only a linked worktree is registered', () => {
    const clusters = clusterProjectsByRepository(
      [{ path: '/worktrees/feature', gitRepositoryId: 'repo1',
        gitRootPath: '/worktrees/feature' }],
      [{ gitRepositoryId: 'repo1', path: '/repo', branch: 'main', isPrimary: true }],
    );
    expect(clusters[0]).toMatchObject({ kind: 'group', title: 'repo' });
  });

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

  it('nests a same-checkout subdirectory when the parent path is a symlink alias', () => {
    const clusters = clusterProjectsByRepository([
      {
        path: '/Users/me/piwin/apps',
        displayName: 'apps',
        gitRepositoryId: 'repo1',
        isPrimaryWorktree: true,
        currentBranch: 'main',
        gitRootPath: '/Users/me/piwin',
      },
      {
        path: '/Volumes/disk/piwin',
        displayName: 'piwin',
        gitRepositoryId: 'repo1',
        isPrimaryWorktree: true,
        currentBranch: 'main',
        gitRootPath: '/Users/me/piwin',
      },
    ]);
    expect(clusters).toEqual([
      {
        kind: 'solo',
        project: {
          path: '/Volumes/disk/piwin',
          displayName: 'piwin',
          gitRepositoryId: 'repo1',
          isPrimaryWorktree: true,
          currentBranch: 'main',
          gitRootPath: '/Users/me/piwin',
          nested: [
            {
              path: '/Users/me/piwin/apps',
              displayName: 'apps',
              gitRepositoryId: 'repo1',
              isPrimaryWorktree: true,
              currentBranch: 'main',
              gitRootPath: '/Users/me/piwin',
            },
          ],
        },
      },
    ]);
  });

  it('does not label same-checkout leftovers as linked worktrees', () => {
    const clusters = clusterProjectsByRepository([
      {
        path: '/Users/me/piwin/apps',
        displayName: 'apps',
        gitRepositoryId: 'repo1',
        isPrimaryWorktree: true,
        gitRootPath: '/Users/me/piwin',
      },
      {
        path: '/Users/me/piwin/packages',
        displayName: 'packages',
        gitRepositoryId: 'repo1',
        isPrimaryWorktree: true,
        gitRootPath: '/Users/me/piwin',
      },
    ]);
    expect(clusters.map((cluster) => cluster.kind)).toEqual(['solo', 'solo']);
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

  it('folds a symlink alias of the checkout into the record at the git root', () => {
    const clusters = clusterProjectsByRepository(
      [
        { path: '/Volumes/Disk/piwin', gitRepositoryId: 'repo1', gitRootPath: '/Users/me/piwin',
          isPrimaryWorktree: true, isCheckoutRoot: true, currentBranch: 'main' },
        { path: '/Users/me/piwin', gitRepositoryId: 'repo1', gitRootPath: '/Users/me/piwin',
          isPrimaryWorktree: true, isCheckoutRoot: true, currentBranch: 'main' },
      ],
      [
        { gitRepositoryId: 'repo1', path: '/Users/me/piwin', branch: 'main', isPrimary: true },
        { gitRepositoryId: 'repo1', path: '/tmp/piwin-head', branch: null, isPrimary: false },
      ],
    );
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toMatchObject({
      kind: 'group',
      members: [{ path: '/Users/me/piwin', aliasPaths: ['/Volumes/Disk/piwin'] }],
      unregistered: [{ path: '/tmp/piwin-head' }],
    });
    if (clusters[0]?.kind === 'group') {
      expect(clusters[0].members).toHaveLength(1);
    }
  });

  it('keeps an ordinary repo flat once its aliases fold to one checkout', () => {
    const clusters = clusterProjectsByRepository([
      { path: '/Volumes/Disk/piwin', gitRepositoryId: 'repo1', gitRootPath: '/Users/me/piwin',
        isCheckoutRoot: true },
      { path: '/Users/me/piwin', gitRepositoryId: 'repo1', gitRootPath: '/Users/me/piwin',
        isCheckoutRoot: true },
    ]);
    expect(clusters).toMatchObject([{
      kind: 'solo',
      project: { path: '/Users/me/piwin', aliasPaths: ['/Volumes/Disk/piwin'] },
    }]);
  });

  it('never folds a subdirectory project or a record without the checkout-root flag', () => {
    const projects = [
      { path: '/Users/me/piwin', gitRepositoryId: 'repo1', gitRootPath: '/Users/me/piwin',
        isCheckoutRoot: true },
      { path: '/Users/me/piwin/apps', gitRepositoryId: 'repo1', gitRootPath: '/Users/me/piwin',
        isCheckoutRoot: false },
      { path: '/Volumes/Disk/piwin', gitRepositoryId: 'repo1', gitRootPath: '/Users/me/piwin' },
    ];
    expect(foldCheckoutAliasProjects(projects)).toEqual(projects);
  });

  it('falls back to the first record when no alias sits at the git root', () => {
    const folded = foldCheckoutAliasProjects([
      { path: '/Volumes/A/piwin', gitRepositoryId: 'repo1', gitRootPath: '/Users/me/piwin',
        isCheckoutRoot: true },
      { path: '/Volumes/B/piwin', gitRepositoryId: 'repo1', gitRootPath: '/Users/me/piwin',
        isCheckoutRoot: true },
    ]);
    expect(folded).toEqual([
      { path: '/Volumes/A/piwin', gitRepositoryId: 'repo1', gitRootPath: '/Users/me/piwin',
        isCheckoutRoot: true, aliasPaths: ['/Volumes/B/piwin'] },
    ]);
  });

  it('nests a subdirectory reached through the alias path under the folded folder', () => {
    const clusters = clusterProjectsByRepository([
      { path: '/Volumes/Disk/piwin', gitRepositoryId: 'repo1', gitRootPath: '/Users/me/piwin',
        isCheckoutRoot: true },
      { path: '/Users/me/piwin', gitRepositoryId: 'repo1', gitRootPath: '/Users/me/piwin',
        isCheckoutRoot: true },
      { path: '/Volumes/Disk/piwin/apps/cli', gitRepositoryId: 'repo1',
        gitRootPath: '/Users/me/piwin', isCheckoutRoot: false },
    ]);
    expect(clusters).toMatchObject([{
      kind: 'solo',
      project: { path: '/Users/me/piwin', nested: [{ path: '/Volumes/Disk/piwin/apps/cli' }] },
    }]);
  });

  it('reports the alias paths a folder stands for so removal can clear them', () => {
    const projects = [
      { path: '/Volumes/Disk/piwin', gitRepositoryId: 'repo1', gitRootPath: '/Users/me/piwin',
        isCheckoutRoot: true },
      { path: '/Users/me/piwin', gitRepositoryId: 'repo1', gitRootPath: '/Users/me/piwin',
        isCheckoutRoot: true },
      { path: '/other', gitRepositoryId: 'repo2', gitRootPath: '/other', isCheckoutRoot: true },
    ];
    expect(checkoutAliasPaths(projects, '/Users/me/piwin')).toEqual(['/Volumes/Disk/piwin']);
    expect(checkoutAliasPaths(projects, '/other')).toEqual([]);
  });
});
