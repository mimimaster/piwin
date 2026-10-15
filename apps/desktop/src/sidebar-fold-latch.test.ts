import { describe, expect, it } from 'vitest';
import type { SessionListItemUi } from './chat-reducer';
import { createSessionListScopeState } from './session-list-scope';
import { autoOpenedFolderKeys } from './sidebar-fold-latch';
import { buildSidebarTreeRows, type SidebarTreeRowsInput } from './sidebar-tree-rows';

function session(id: string): SessionListItemUi {
  return { id, name: id };
}

function project(path: string): SidebarTreeRowsInput['recentProjects'][number] {
  return { path, displayName: path };
}

function baseInput(overrides: Partial<SidebarTreeRowsInput>): SidebarTreeRowsInput {
  return {
    recentProjects: [project('/a'), project('/b')],
    projectSessionsByPath: { '/a': [session('a1')], '/b': [session('b1')] },
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

function latch(input: SidebarTreeRowsInput): string[] {
  return autoOpenedFolderKeys(buildSidebarTreeRows(input), input);
}

describe('autoOpenedFolderKeys', () => {
  it('reports the folder opened because it holds the active project', () => {
    expect(latch(baseInput({ activeProjectPath: '/a' }))).toEqual(['/a']);
  });

  it('reports the folder opened because it holds the open session', () => {
    expect(latch(baseInput({ activeProjectPath: '/a', revealSessionId: 'b1' }))).toEqual([
      '/a',
      '/b',
    ]);
  });

  it('skips folders the user already folded or unfolded', () => {
    expect(
      latch(baseInput({ activeProjectPath: '/a', collapsedProjects: { '/a': false } })),
    ).toEqual([]);
    expect(
      latch(baseInput({ activeProjectPath: '/a', collapsedProjects: { '/a': true } })),
    ).toEqual([]);
  });

  it('latches nothing while search opens every folder', () => {
    expect(latch(baseInput({ activeProjectPath: '/a', sessionSearch: 'a' }))).toEqual([]);
  });
});
