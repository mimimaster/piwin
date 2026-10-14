import { describe, expect, it } from 'vitest';
import {
  applyRegisteredProjectsToHiddenSuppressions, filterPathsAgainstSuppression,
  markPendingSidebarRemoval, releasePendingSidebarRemoval,
  rememberHiddenSidebarPath, suppressedSidebarPaths,
} from './sidebar-project-removal-suppression';

describe('sidebar removal suppression', () => {
  it('never clears pending removals when registered projects are listed', () => {
    const pending = new Set<string>(); const hidden = new Set<string>();
    markPendingSidebarRemoval(pending, '/removed/');
    applyRegisteredProjectsToHiddenSuppressions(hidden, ['/removed']);
    expect(filterPathsAgainstSuppression([{ path: '/removed' }, { path: '/kept' }], suppressedSidebarPaths(pending, hidden))).toEqual([{ path: '/kept' }]);
  });
  it('clears only matching committed hides on explicit reopen', () => {
    const hidden = new Set<string>();
    rememberHiddenSidebarPath(hidden, '/removed/');
    rememberHiddenSidebarPath(hidden, '/sibling');
    applyRegisteredProjectsToHiddenSuppressions(hidden, ['/removed']);
    expect(hidden).toEqual(new Set(['/sibling']));
  });
  it('retains successful hides after releasing pending removals', () => {
    const pending = new Set<string>(); const hidden = new Set<string>();
    markPendingSidebarRemoval(pending, '/removed/');
    rememberHiddenSidebarPath(hidden, '/removed');
    releasePendingSidebarRemoval(pending, '/removed');
    expect(pending.size).toBe(0);
    expect(filterPathsAgainstSuppression([{ path: '/removed/' }], suppressedSidebarPaths(pending, hidden))).toEqual([]);
  });
});
