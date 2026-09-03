import { describe, expect, it } from 'vitest';
import type { SessionListItemUi } from './chat-reducer';
import type { DraftSessionItemUi } from './draft-session';
import { createSessionListScopeState, setSessionListScopeMeta } from './session-list-scope';
import {
  buildSidebarTreeRows,
  resolveSidebarProjectCollapsed,
  sidebarTreeRowKey,
  type SidebarTreeRow,
} from './sidebar-tree-rows';

function session(
  id: string,
  name: string,
  extras: Partial<SessionListItemUi> = {},
): SessionListItemUi {
  return { id, name, ...extras };
}

function draft(id: string, name: string, scope: DraftSessionItemUi['scope']): DraftSessionItemUi {
  return {
    id,
    name,
    text: name,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    scope,
    isDraft: true,
  };
}

function kinds(rows: SidebarTreeRow[]): string[] {
  return rows.map((row) => {
    if (row.kind === 'section-header') return `header:${row.sectionId}`;
    if (row.kind === 'repo-group') return `repo:${row.title}`;
    if (row.kind === 'project-folder') return `folder:${row.projectPath}:${row.collapsed}`;
    if (row.kind === 'session') return `session:${row.session.id}`;
    if (row.kind === 'project-show-more') return `show-more:${row.projectPath}:${row.batchSize}`;
    if (row.kind === 'empty-hint') return `empty:${row.scope.kind}`;
    if (row.kind === 'query-error') return `query-error:${row.scope.kind}`;
    return `truncation:${row.hiddenCount}`;
  });
}

describe('resolveSidebarProjectCollapsed', () => {
  it('defaults to collapsed except the active/last-session project', () => {
    expect(
      resolveSidebarProjectCollapsed({
        projectPath: '/active',
        collapsedProjects: {},
        activeProjectPath: '/active',
      }),
    ).toBe(false);
    expect(
      resolveSidebarProjectCollapsed({
        projectPath: '/other',
        collapsedProjects: {},
        activeProjectPath: '/active',
      }),
    ).toBe(true);
    expect(
      resolveSidebarProjectCollapsed({
        projectPath: '/any',
        collapsedProjects: {},
        activeProjectPath: null,
      }),
    ).toBe(true);
  });

  it('lets explicit overrides and search mode win', () => {
    expect(
      resolveSidebarProjectCollapsed({
        projectPath: '/active',
        collapsedProjects: { '/active': true },
        activeProjectPath: '/active',
      }),
    ).toBe(true);
    expect(
      resolveSidebarProjectCollapsed({
        projectPath: '/other',
        collapsedProjects: { '/other': false },
        activeProjectPath: '/active',
      }),
    ).toBe(false);
    expect(
      resolveSidebarProjectCollapsed({
        projectPath: '/other',
        collapsedProjects: {},
        activeProjectPath: '/active',
        searching: true,
      }),
    ).toBe(false);
  });

  it('auto-expands for the reveal session only when the user never touched it', () => {
    // Reveal fallback: untouched non-active project expands when the active
    // session lives inside it.
    expect(
      resolveSidebarProjectCollapsed({
        projectPath: '/other',
        collapsedProjects: {},
        activeProjectPath: '/active',
        revealInside: true,
      }),
    ).toBe(false);
    // Explicit fold still wins over reveal — this is the fold-click regression.
    expect(
      resolveSidebarProjectCollapsed({
        projectPath: '/active',
        collapsedProjects: { '/active': true },
        activeProjectPath: '/active',
        revealInside: true,
      }),
    ).toBe(true);
    // Search reveals everything, even explicitly folded folders.
    expect(
      resolveSidebarProjectCollapsed({
        projectPath: '/active',
        collapsedProjects: { '/active': true },
        activeProjectPath: '/active',
        revealInside: true,
        searching: true,
      }),
    ).toBe(false);
  });
});

describe('buildSidebarTreeRows', () => {
  it('respects Projects and Conversations section collapse', () => {
    const rows = buildSidebarTreeRows({
      recentProjects: [{ path: '/p' }],
      projectSessionsByPath: { '/p': [session('p1', 'P')] },
      generalSessions: [session('g1', 'G')],
      sessionSearch: '',
      sessionListOrder: 'updated',
      projectsSectionExpanded: false,
      conversationsSectionExpanded: false,
      collapsedProjects: {},
      sessionListScopes: createSessionListScopeState(),
    });
    expect(kinds(rows)).toEqual(['header:projects', 'header:conversations']);
  });

  it('lets an explicit section fold win even when the active session is inside it', () => {
    const rows = buildSidebarTreeRows({
      recentProjects: [{ path: '/p' }],
      projectSessionsByPath: { '/p': [session('p1', 'P')] },
      generalSessions: [session('g1', 'G')],
      sessionSearch: '',
      sessionListOrder: 'updated',
      projectsSectionExpanded: false,
      conversationsSectionExpanded: false,
      collapsedProjects: {},
      sessionListScopes: createSessionListScopeState(),
      revealSessionId: 'g1',
      activeProjectPath: '/p',
      activeProjectSessions: [session('p1', 'P')],
    });
    expect(kinds(rows)).toEqual(['header:projects', 'header:conversations']);
  });

  it('still reveals collapsed section matches while searching', () => {
    const rows = buildSidebarTreeRows({
      recentProjects: [],
      projectSessionsByPath: {},
      generalSessions: [session('g1', 'Docker notes')],
      sessionSearch: 'Docker',
      sessionListOrder: 'updated',
      projectsSectionExpanded: false,
      conversationsSectionExpanded: false,
      collapsedProjects: {},
      sessionListScopes: createSessionListScopeState(),
    });
    expect(kinds(rows)).toEqual(['header:projects', 'header:conversations', 'session:g1']);
  });

  it('expands only the active project folder by default', () => {
    const rows = buildSidebarTreeRows({
      recentProjects: [{ path: '/a' }, { path: '/b' }, { path: '/c' }],
      projectSessionsByPath: {
        '/a': [session('a1', 'A')],
        '/b': [session('b1', 'B')],
        '/c': [session('c1', 'C')],
      },
      generalSessions: [],
      sessionSearch: '',
      sessionListOrder: 'updated',
      projectsSectionExpanded: true,
      conversationsSectionExpanded: true,
      collapsedProjects: {},
      sessionListScopes: createSessionListScopeState(),
      activeProjectPath: '/b',
    });
    expect(kinds(rows)).toEqual([
      'header:projects',
      'folder:/a:true',
      'folder:/b:false',
      'session:b1',
      'folder:/c:true',
      'header:conversations',
      'empty:general',
    ]);
  });

  it('hides sessions under a collapsed project folder', () => {
    const rows = buildSidebarTreeRows({
      recentProjects: [{ path: '/a' }, { path: '/b' }],
      projectSessionsByPath: {
        '/a': [session('a1', 'A')],
        '/b': [session('b1', 'B')],
      },
      generalSessions: [],
      sessionSearch: '',
      sessionListOrder: 'updated',
      projectsSectionExpanded: true,
      conversationsSectionExpanded: true,
      collapsedProjects: { '/a': true },
      sessionListScopes: createSessionListScopeState(),
      activeProjectPath: '/b',
    });
    expect(kinds(rows)).toEqual([
      'header:projects',
      'folder:/a:true',
      'folder:/b:false',
      'session:b1',
      'header:conversations',
      'empty:general',
    ]);
  });

  it('keeps multiple projects independently owned', () => {
    const rows = buildSidebarTreeRows({
      recentProjects: [{ path: '/a' }, { path: '/b' }],
      projectSessionsByPath: {
        '/a': [session('shared-looking', 'A')],
        '/b': [session('shared-looking', 'B')],
      },
      generalSessions: [],
      sessionSearch: '',
      sessionListOrder: 'updated',
      projectsSectionExpanded: true,
      conversationsSectionExpanded: false,
      collapsedProjects: { '/a': false, '/b': false },
      sessionListScopes: createSessionListScopeState(),
    });
    const sessionRows = rows.filter((row) => row.kind === 'session');
    expect(sessionRows.map((row) => sidebarTreeRowKey(row))).toEqual([
      'session:project:/a:shared-looking',
      'session:project:/b:shared-looking',
    ]);
  });

  it('shows project sessions five at a time with an independent disclosure row', () => {
    const projectSessions = Array.from({ length: 13 }, (_, index) =>
      session(`p-${index + 1}`, `Project ${index + 1}`, {
        updatedAt: new Date(Date.UTC(2026, 7, 13 - index)).toISOString(),
      }),
    );
    const baseInput = {
      recentProjects: [{ path: '/a' }, { path: '/b' }],
      projectSessionsByPath: {
        '/a': projectSessions,
        '/b': projectSessions.slice(0, 7).map((item) => ({ ...item, id: `b-${item.id}` })),
      },
      generalSessions: [],
      sessionSearch: '',
      sessionListOrder: 'updated' as const,
      projectsSectionExpanded: true,
      conversationsSectionExpanded: false,
      collapsedProjects: { '/a': false, '/b': false },
      sessionListScopes: createSessionListScopeState(),
    };

    const initial = buildSidebarTreeRows(baseInput);
    expect(initial.filter((row) => row.kind === 'session')).toHaveLength(10);
    expect(kinds(initial)).toContain('show-more:/a:5');
    expect(kinds(initial)).toContain('show-more:/b:2');

    const expanded = buildSidebarTreeRows({
      ...baseInput,
      projectSessionVisibleCounts: { '/a': 10 },
    });
    const projectAIds = expanded.flatMap((row) =>
      row.kind === 'session' && row.scope.kind === 'project' && row.scope.projectPath === '/a'
        ? [row.session.id]
        : [],
    );
    expect(projectAIds).toHaveLength(10);
    expect(kinds(expanded)).toContain('show-more:/a:3');
    expect(kinds(expanded)).toContain('show-more:/b:2');
  });

  it('keeps the revealed session visible beyond the five-row preview', () => {
    const projectSessions = Array.from({ length: 8 }, (_, index) =>
      session(`p-${index + 1}`, `Project ${index + 1}`, {
        updatedAt: new Date(Date.UTC(2026, 7, 13 - index)).toISOString(),
      }),
    );
    const rows = buildSidebarTreeRows({
      recentProjects: [{ path: '/a' }],
      projectSessionsByPath: { '/a': projectSessions },
      generalSessions: [],
      sessionSearch: '',
      sessionListOrder: 'updated',
      projectsSectionExpanded: true,
      conversationsSectionExpanded: false,
      collapsedProjects: {},
      sessionListScopes: createSessionListScopeState(),
      revealSessionId: 'p-8',
    });
    const ids = rows.flatMap((row) => (row.kind === 'session' ? [row.session.id] : []));
    expect(ids).toContain('p-8');
    expect(rows.find((row) => row.kind === 'project-folder')?.collapsed).toBe(false);
  });

  it('lets an explicit fold win even when the active session is inside the project', () => {
    const rows = buildSidebarTreeRows({
      recentProjects: [{ path: '/a' }],
      projectSessionsByPath: { '/a': [session('a1', 'Active')] },
      generalSessions: [],
      sessionSearch: '',
      sessionListOrder: 'updated',
      projectsSectionExpanded: true,
      conversationsSectionExpanded: false,
      collapsedProjects: { '/a': true },
      sessionListScopes: createSessionListScopeState(),
      activeProjectPath: '/a',
      activeProjectSessions: [session('a1', 'Active')],
      revealSessionId: 'a1',
    });
    expect(rows.find((row) => row.kind === 'project-folder')?.collapsed).toBe(true);
    expect(rows.filter((row) => row.kind === 'session')).toHaveLength(0);
  });

  it('does not hide project search results behind progressive disclosure', () => {
    const projectSessions = Array.from({ length: 8 }, (_, index) =>
      session(`match-${index}`, `Match ${index}`),
    );
    const rows = buildSidebarTreeRows({
      recentProjects: [{ path: '/search' }],
      projectSessionsByPath: { '/search': projectSessions },
      generalSessions: [],
      sessionSearch: 'match',
      sessionListOrder: 'updated',
      projectsSectionExpanded: true,
      conversationsSectionExpanded: false,
      collapsedProjects: {},
      sessionListScopes: createSessionListScopeState(),
    });

    expect(rows.filter((row) => row.kind === 'session')).toHaveLength(8);
    expect(rows.some((row) => row.kind === 'project-show-more')).toBe(false);
  });

  it('merges drafts first without duplicating durable ids', () => {
    const rows = buildSidebarTreeRows({
      recentProjects: [],
      projectSessionsByPath: {},
      generalSessions: [session('g1', 'Durable')],
      draftSessions: [
        draft('draft-1', 'Draft', { kind: 'general' }),
        draft('g1', 'Same id as durable', { kind: 'general' }),
      ],
      sessionSearch: '',
      sessionListOrder: 'updated',
      projectsSectionExpanded: true,
      conversationsSectionExpanded: true,
      collapsedProjects: {},
      sessionListScopes: createSessionListScopeState(),
    });
    expect(kinds(rows)).toEqual([
      'header:projects',
      'header:conversations',
      'session:draft-1',
      'session:g1',
    ]);
  });

  it('sorts updated and alphabetical orders including pin and rename', () => {
    const sessions = [
      session('z', 'Zulu', { updatedAt: '2026-08-01T00:00:00.000Z' }),
      session('a', 'Alpha', { updatedAt: '2026-08-03T00:00:00.000Z' }),
      session('p', 'Pinned', {
        updatedAt: '2026-08-02T00:00:00.000Z',
        isPinned: true,
        pinnedAt: '2026-08-04T00:00:00.000Z',
      }),
    ];
    const updated = buildSidebarTreeRows({
      recentProjects: [],
      projectSessionsByPath: {},
      generalSessions: sessions,
      sessionSearch: '',
      sessionListOrder: 'updated',
      projectsSectionExpanded: false,
      conversationsSectionExpanded: true,
      collapsedProjects: {},
      sessionListScopes: createSessionListScopeState(),
    });
    expect(updated.filter((row) => row.kind === 'session').map((row) => row.session.id)).toEqual([
      'p',
      'a',
      'z',
    ]);

    const renamed = sessions.map((item) =>
      item.id === 'z' ? { ...item, name: 'AAA Zulu' } : item,
    );
    const alphabetical = buildSidebarTreeRows({
      recentProjects: [],
      projectSessionsByPath: {},
      generalSessions: renamed,
      sessionSearch: '',
      sessionListOrder: 'alphabetical',
      projectsSectionExpanded: false,
      conversationsSectionExpanded: true,
      collapsedProjects: {},
      sessionListScopes: createSessionListScopeState(),
    });
    expect(
      alphabetical.filter((row) => row.kind === 'session').map((row) => row.session.name),
    ).toEqual(['AAA Zulu', 'Alpha', 'Pinned']);
  });

  it('filters drafts locally during search and suppresses truncation hints', () => {
    const scopes = setSessionListScopeMeta(
      createSessionListScopeState(),
      { kind: 'general' },
      {
        totalCount: 80,
        truncated: true,
      },
    );
    const rows = buildSidebarTreeRows({
      recentProjects: [],
      projectSessionsByPath: {},
      generalSessions: [session('keep', 'Needle')],
      draftSessions: [
        draft('d-keep', 'Needle draft', { kind: 'general' }),
        draft('d-drop', 'Other draft', { kind: 'general' }),
      ],
      sessionSearch: 'needle',
      sessionListOrder: 'updated',
      projectsSectionExpanded: false,
      conversationsSectionExpanded: true,
      collapsedProjects: {},
      sessionListScopes: scopes,
    });
    expect(kinds(rows)).toEqual([
      'header:projects',
      'header:conversations',
      'session:d-keep',
      'session:keep',
    ]);
  });

  it('shows an empty hint only for an expanded empty conversations scope', () => {
    const collapsedConversations = buildSidebarTreeRows({
      recentProjects: [],
      projectSessionsByPath: {},
      generalSessions: [],
      sessionSearch: '',
      sessionListOrder: 'updated',
      projectsSectionExpanded: true,
      conversationsSectionExpanded: false,
      collapsedProjects: {},
      sessionListScopes: createSessionListScopeState(),
    });
    expect(collapsedConversations.some((row) => row.kind === 'empty-hint')).toBe(false);

    const expanded = buildSidebarTreeRows({
      recentProjects: [],
      projectSessionsByPath: {},
      generalSessions: [],
      sessionSearch: '',
      sessionListOrder: 'updated',
      projectsSectionExpanded: true,
      conversationsSectionExpanded: true,
      collapsedProjects: {},
      sessionListScopes: createSessionListScopeState(),
    });
    expect(kinds(expanded)).toContain('empty:general');
  });

  it('reduces the truncation hint after an out-of-bound active upsert', () => {
    const scopes = setSessionListScopeMeta(
      createSessionListScopeState(),
      { kind: 'general' },
      {
        totalCount: 2005,
        truncated: true,
      },
    );
    const resident = Array.from({ length: 2000 }, (_, index) =>
      session(`row-${index}`, `Row ${index}`),
    );
    const before = buildSidebarTreeRows({
      recentProjects: [],
      projectSessionsByPath: {},
      generalSessions: resident,
      sessionSearch: '',
      sessionListOrder: 'updated',
      projectsSectionExpanded: false,
      conversationsSectionExpanded: true,
      collapsedProjects: {},
      sessionListScopes: scopes,
    });
    const beforeHint = before.find((row) => row.kind === 'truncation-hint');
    expect(beforeHint?.kind === 'truncation-hint' ? beforeHint.hiddenCount : 0).toBe(5);

    const after = buildSidebarTreeRows({
      recentProjects: [],
      projectSessionsByPath: {},
      generalSessions: [...resident, session('outside', 'Outside')],
      sessionSearch: '',
      sessionListOrder: 'updated',
      projectsSectionExpanded: false,
      conversationsSectionExpanded: true,
      collapsedProjects: {},
      sessionListScopes: scopes,
    });
    const afterHint = after.find((row) => row.kind === 'truncation-hint');
    expect(afterHint?.kind === 'truncation-hint' ? afterHint.hiddenCount : 0).toBe(4);
  });

  it('groups linked worktrees and leaves a single-worktree repo flat', () => {
    const rows = buildSidebarTreeRows({
      recentProjects: [
        {
          path: '/piwin-cc',
          displayName: 'piwin-cc',
          gitRepositoryId: 'repo1',
          currentBranch: 'plan/x',
        },
        {
          path: '/piwin',
          displayName: 'piwin',
          gitRepositoryId: 'repo1',
          isPrimaryWorktree: true,
          currentBranch: 'main',
        },
        {
          path: '/notes',
          displayName: 'notes',
          gitRepositoryId: 'repo2',
          isPrimaryWorktree: true,
        },
      ],
      projectSessionsByPath: {},
      generalSessions: [],
      sessionSearch: '',
      sessionListOrder: 'updated',
      projectsSectionExpanded: true,
      conversationsSectionExpanded: true,
      collapsedProjects: { '/piwin': true, '/piwin-cc': true, '/notes': true },
      sessionListScopes: createSessionListScopeState(),
    });
    expect(kinds(rows)).toEqual([
      'header:projects',
      'repo:piwin',
      'folder:/piwin:true',
      'folder:/piwin-cc:true',
      'folder:/notes:true',
      'header:conversations',
      'empty:general',
    ]);
    const grouped = rows.filter(
      (row): row is Extract<SidebarTreeRow, { kind: 'project-folder' }> =>
        row.kind === 'project-folder' && row.grouped,
    );
    expect(grouped.map((row) => row.projectPath)).toEqual(['/piwin', '/piwin-cc']);
    const notes = rows.find(
      (row): row is Extract<SidebarTreeRow, { kind: 'project-folder' }> =>
        row.kind === 'project-folder' && row.projectPath === '/notes',
    );
    expect(notes?.grouped).toBe(false);
  });
});
