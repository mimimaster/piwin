import { describe, expect, it } from 'vitest';
import type { ProjectWorktreeListing, RemoteProjectSummary, RemoteSessionSummary } from '@piwin/contracts';
import { mapSessionGroups, type InkstoneProjectGroup, type InkstoneSessionRow } from '../host/host-bridge.js';
import { buildSessionSections } from './session-sections.js';

function row(sessionId: string, patch: Partial<InkstoneSessionRow> = {}): InkstoneSessionRow {
  return { sessionId, title: sessionId, subtitle: '', status: 'done', time: '', pinned: false, ...patch };
}

const groups: InkstoneProjectGroup[] = [
  { projectId: 'p1', project: 'workspace', rows: [row('a', { pinned: true }), row('b', { status: 'running' })] },
  { projectId: undefined, project: '一般会话', rows: [row('c')] },
  { projectId: 'p2', project: 'piwin', rows: [row('d', { pinned: true })] },
];

const repositoryProjects: RemoteProjectSummary[] = [
  { projectId: 'linked', displayName: 'Feature checkout', gitRepositoryId: 'repo-a', path: '/host/linked',
    currentBranch: 'feature', isPrimaryWorktree: false, workspaceAvailability: 'missing' },
  { projectId: 'primary', displayName: 'Same repo name', gitRepositoryId: 'repo-a', path: '/host/primary',
    currentBranch: 'main', isPrimaryWorktree: true },
  { projectId: 'other', displayName: 'Same repo name', gitRepositoryId: 'repo-b', path: '/host/other',
    currentBranch: 'detached abc123', isPrimaryWorktree: true },
  { projectId: 'unknown', displayName: 'Unknown checkout', gitRepositoryId: 'repo-a' },
];

const repositorySessions: RemoteSessionSummary[] = [
  { sessionId: 'linked-session', projectId: 'linked', scope: 'project', pinned: true, name: 'Pinned missing' },
  { sessionId: 'primary-session', projectId: 'primary', scope: 'project', name: 'Primary session' },
  { sessionId: 'other-session', projectId: 'other', scope: 'project', name: 'Other session' },
  { sessionId: 'unknown-session', projectId: 'unknown', scope: 'project', name: 'Unknown session' },
  { sessionId: 'lost-session', projectId: 'lost-project-id', scope: 'project', name: 'Lost project session' },
  { sessionId: 'general-session', scope: 'general', name: 'General chat' },
  { sessionId: 'archived-session', projectId: 'primary', scope: 'project', archived: true },
];

const repositoryWorktrees: ProjectWorktreeListing[] = [
  { gitRepositoryId: 'repo-a', path: '/host/primary', branch: 'main', isPrimary: true },
  { gitRepositoryId: 'repo-a', path: '/host/discovered', branch: null, isPrimary: false },
  { gitRepositoryId: 'repo-a', path: '/host/discovered', branch: null, isPrimary: false },
];

function repositoryGroups() {
  return mapSessionGroups({ sessions: repositorySessions, projects: repositoryProjects, worktrees: repositoryWorktrees,
    runningSessionIds: new Set(['primary-session']), pendingPermissionSessionIds: new Set(['unknown-session']), now: 0 });
}

describe('public repository grouping', () => {
  it('joins primary/linked by shared ID, never same-named repositories or paths', () => {
    const mapped = repositoryGroups();
    expect(mapped.map((group) => [group.key, group.project])).toEqual([
      ['repository:repo-a', 'Same repo name'], ['repository:repo-b', 'Same repo name'],
      ['project:lost-project-id', 'lost-project-id'], ['project:__general__', '一般会话'],
    ]);
    expect(mapped[0]?.rows.map((item) => item.sessionId)).toEqual(['linked-session', 'primary-session', 'unknown-session']);
    expect(mapped[0]?.rows[0]).toMatchObject({ checkoutKind: 'worktree', branch: 'feature', checkoutMissing: true });
    expect(mapped[0]?.rows[1]).toMatchObject({ checkoutKind: 'primary', branch: 'main', status: 'running' });
    expect(mapped[0]?.rows[2]).not.toHaveProperty('checkoutKind');
    expect(mapped[0]?.rows[2]).not.toHaveProperty('branch');
    expect(mapped[1]?.rows[0]?.branch).toBe('detached abc123');
    expect(mapped[2]?.rows[0]).toMatchObject({ projectMetadataMissing: true });
    expect(mapped[0]?.checkoutHints).toEqual([repositoryWorktrees[1]]);
  });

  it('retains single pinned/running/permission semantics and readonly hints only in the unfiltered view', () => {
    const mapped = repositoryGroups();
    const all = buildSessionSections(mapped, '全部');
    const ids = all.sections.flatMap((section) => section.rows.map((item) => item.sessionId));
    expect(new Set(ids).size).toBe(6);
    expect(ids).toHaveLength(6);
    expect(all.sections[0]?.rows[0]).toMatchObject({ sessionId: 'linked-session', scope: 'Same repo name', checkoutMissing: true });
    expect(all.sections.find((section) => section.key === 'repository:repo-a')?.checkoutHints).toHaveLength(1);
    expect(buildSessionSections(mapped, '置顶').sections[0]?.rows.map((item) => item.sessionId)).toEqual(['linked-session']);
    expect(buildSessionSections(mapped, '进行中').sections[0]?.rows.map((item) => item.sessionId)).toEqual(['primary-session']);
    expect(buildSessionSections(mapped, '进行中').sections[0]).not.toHaveProperty('checkoutHints');
  });

  it('never joins projects by a coincident path/name when repository identity is unknown', () => {
    const mapped = mapSessionGroups({
      sessions: [{ sessionId: 'a', projectId: 'p1', scope: 'project' }, { sessionId: 'b', projectId: 'p2', scope: 'project' }],
      projects: [{ projectId: 'p1', displayName: 'Same', path: '/same' }, { projectId: 'p2', displayName: 'Same', path: '/same' }],
      runningSessionIds: new Set(), pendingPermissionSessionIds: new Set(), now: 0,
    });
    expect(mapped.map((group) => group.key)).toEqual(['project:p1', 'project:p2']);
    expect(mapped.flatMap((group) => group.rows).some((item) => item.checkoutKind !== undefined)).toBe(false);
  });

  it('can display a public discovered checkout without making a project or session identity', () => {
    const mapped = mapSessionGroups({ sessions: [], projects: repositoryProjects, worktrees: repositoryWorktrees,
      runningSessionIds: new Set(), pendingPermissionSessionIds: new Set(), now: 0 });
    const view = buildSessionSections(mapped, '全部');
    expect(view.sections).toHaveLength(1);
    expect(view.sections[0]?.rows).toEqual([]);
    expect(mapped[0]?.projectId).toBeUndefined();
    expect(view.sections[0]?.checkoutHints).toEqual([repositoryWorktrees[1]]);
    expect(buildSessionSections(mapped, '置顶').emptyMessage).toContain('置顶');
  });
});

describe('buildSessionSections', () => {
  it('floats pinned rows into one section and drops projects left empty', () => {
    const view = buildSessionSections(groups, '全部');
    expect(view.sections.map((section) => section.key)).toEqual([
      'pinned',
      'project:p1',
      'project:__general__',
    ]);
    const pinned = view.sections[0];
    expect(pinned?.rows.map((item) => [item.sessionId, item.scope])).toEqual([
      ['a', 'workspace'],
      ['d', 'piwin'],
    ]);
    expect(view.sections[1]?.rows.map((item) => item.sessionId)).toEqual(['b']);
  });

  it('draws the pinned filter as one flat list, not one empty group per project', () => {
    const view = buildSessionSections(groups, '置顶');
    expect(view.sections).toHaveLength(1);
    expect(view.sections[0]?.kind).toBe('flat');
    expect(view.sections[0]?.rows.map((item) => item.sessionId)).toEqual(['a', 'd']);
  });

  it('returns a single empty message when a filter matches nothing', () => {
    const view = buildSessionSections([{ projectId: 'p1', project: 'x', rows: [row('a')] }], '置顶');
    expect(view.sections).toEqual([]);
    expect(view.emptyMessage).toContain('置顶');
  });

  it('keeps only running rows under 进行中 with their project as scope', () => {
    const view = buildSessionSections(groups, '进行中');
    expect(view.sections[0]?.rows.map((item) => [item.sessionId, item.scope])).toEqual([['b', 'workspace']]);
  });
});
