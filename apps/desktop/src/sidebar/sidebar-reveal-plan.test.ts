import { describe, expect, it } from 'vitest';
import type { SessionListItemUi } from '../conversation/chat-reducer';
import { createSessionListScopeState } from '../session/session-list-scope';
import { activeProjectEnclosingFoldKeys, planSidebarReveal } from './sidebar-reveal-plan';
import { buildSidebarTreeRows, type SidebarTreeRowsInput } from './sidebar-tree-rows';

function session(id: string, extras: Partial<SessionListItemUi> = {}): SessionListItemUi {
  return { id, name: id, ...extras };
}

function baseInput(overrides: Partial<SidebarTreeRowsInput>): SidebarTreeRowsInput {
  return {
    recentProjects: [],
    projectSessionsByPath: {},
    generalSessions: [],
    sessionSearch: '',
    sessionListOrder: 'updated',
    projectsSectionExpanded: true,
    conversationsSectionExpanded: true,
    collapsedProjects: {},
    sessionListScopes: createSessionListScopeState(),
    ...overrides,
  };
}

function rowVisible(input: SidebarTreeRowsInput, id: string): boolean {
  return buildSidebarTreeRows(input).some(
    (row) => row.kind === 'session' && row.session.id === id,
  );
}

describe('planSidebarReveal', () => {
  it('unfolds the folder the user explicitly folded over the open session', () => {
    const input = baseInput({
      recentProjects: [{ path: '/app' }, { path: '/other' }],
      projectSessionsByPath: { '/app': [session('s1')], '/other': [session('s2')] },
      collapsedProjects: { '/app': true, '/other': true },
      projectsSectionExpanded: false,
      activeProjectPath: '/app',
      revealSessionId: 's1',
    });
    expect(rowVisible(input, 's1')).toBe(false);

    const plan = planSidebarReveal(input);
    expect(plan).toEqual({
      targetId: 's1',
      mode: 'code',
      section: 'projects',
      unfoldKeys: ['/app'],
      unfoldUnavailable: false,
    });
    // Applying the plan paints the row; the unrelated fold stays folded.
    const applied = baseInput({
      ...input,
      projectsSectionExpanded: true,
      collapsedProjects: { '/app': false, '/other': true },
    });
    expect(rowVisible(applied, 's1')).toBe(true);
    expect(rowVisible(applied, 's2')).toBe(false);
  });

  it('uses the repository collapse key for grouped worktrees', () => {
    const input = baseInput({
      recentProjects: [
        { path: '/piwin', gitRepositoryId: 'repo1', isPrimaryWorktree: true },
        { path: '/piwin-wt', gitRepositoryId: 'repo1' },
      ],
      projectSessionsByPath: { '/piwin-wt': [session('wt1')] },
      collapsedProjects: { 'repo:repo1': true },
      revealSessionId: 'wt1',
    });
    expect(planSidebarReveal(input)?.unfoldKeys).toEqual(['repo:repo1']);
  });

  it('opens the unavailable group and the missing workspace inside it', () => {
    const input = baseInput({
      recentProjects: [{ path: '/gone', workspaceAvailability: 'missing' }],
      projectSessionsByPath: { '/gone': [session('g1')] },
      unavailableGroupCollapsed: true,
      collapsedProjects: { '/gone': true },
      revealSessionId: 'g1',
    });
    const plan = planSidebarReveal(input);
    expect(plan?.unfoldKeys).toEqual(['/gone']);
    expect(plan?.unfoldUnavailable).toBe(true);
  });

  it('targets the chat pane for a general conversation', () => {
    const plan = planSidebarReveal(
      baseInput({
        generalSessions: [session('c1')],
        conversationsSectionExpanded: false,
        revealSessionId: 'c1',
      }),
    );
    expect(plan).toMatchObject({ mode: 'chat', section: 'conversations', unfoldKeys: [] });
  });

  it('finds a pinned project session in the code pane pinned section', () => {
    const plan = planSidebarReveal(
      baseInput({
        recentProjects: [{ path: '/app' }],
        projectSessionsByPath: { '/app': [session('p1', { isPinned: true })] },
        pinnedSectionExpanded: false,
        revealSessionId: 'p1',
      }),
    );
    expect(plan).toMatchObject({ mode: 'code', section: 'pinned', unfoldKeys: [] });
  });

  it('returns null when the session is not listed', () => {
    expect(planSidebarReveal(baseInput({ revealSessionId: 'missing' }))).toBeNull();
    expect(planSidebarReveal(baseInput({}))).toBeNull();
  });
});

describe('activeProjectEnclosingFoldKeys', () => {
  function folderVisible(input: SidebarTreeRowsInput, path: string): boolean {
    return buildSidebarTreeRows(input).some(
      (row) => row.kind === 'project-folder' && row.projectPath === path,
    );
  }

  it('names the folded parent that hides a nested active project', () => {
    const input = baseInput({
      recentProjects: [
        { path: '/ios/ctf', createdAt: '2026-10-14T12:43:00Z' },
        { path: '/ios', createdAt: '2026-10-14T10:46:00Z' },
      ],
      collapsedProjects: { '/ios': true },
      activeProjectPath: '/ios/ctf',
    });
    expect(folderVisible(input, '/ios/ctf')).toBe(false);
    expect(activeProjectEnclosingFoldKeys(input)).toEqual(['/ios']);
    expect(folderVisible({ ...input, collapsedProjects: {} }, '/ios/ctf')).toBe(true);
  });

  it('never names the active folder itself', () => {
    const input = baseInput({
      recentProjects: [{ path: '/app' }],
      collapsedProjects: { '/app': true },
      activeProjectPath: '/app',
    });
    expect(activeProjectEnclosingFoldKeys(input)).toEqual([]);
  });

  it('returns null until the active project is listed', () => {
    const input = baseInput({ recentProjects: [{ path: '/ios' }], activeProjectPath: '/ios/ctf' });
    expect(activeProjectEnclosingFoldKeys(input)).toBeNull();
    expect(activeProjectEnclosingFoldKeys(baseInput({}))).toBeNull();
  });
});
