import { describe, expect, it } from 'vitest';
import { chatUiReducer, createInitialChatUiState } from './chat-reducer';
import { mapListedSessionItem } from './remote-session-hydrate';
import { mergeSessionListItem } from './session-list-item-merge';

describe('session chain phase 2', () => {
  it('keeps unnamed entity scope so a later name lands in the owning project', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, {
      type: 'session/update',
      session: {
        id: 'created-empty',
        name: '',
        scope: { kind: 'project', projectPath: '/Users/me/project-p' },
      },
    });
    expect(state.sessionEntitiesById['created-empty']?.scope).toEqual({
      kind: 'project',
      projectPath: '/Users/me/project-p',
    });
    expect(state.generalSessions.some((session) => session.id === 'created-empty')).toBe(false);

    state = chatUiReducer(state, { type: 'project/clear' });
    state = chatUiReducer(state, {
      type: 'session/update',
      session: { id: 'created-empty', name: 'Named after create' },
    });
    expect(state.generalSessions.some((session) => session.id === 'created-empty')).toBe(false);
    expect(
      state.projectSessionsByPath['/Users/me/project-p']?.some(
        (session) => session.id === 'created-empty',
      ),
    ).toBe(true);
  });

  it('does not let a late project hydrate fill a different active project', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, {
      type: 'project/set',
      path: '/q',
      trusted: true,
    });
    state = chatUiReducer(state, {
      type: 'session/hydrate-scope',
      scope: { kind: 'project', projectPath: '/p' },
      sessions: [{ id: 'p-row', name: 'From P' }],
      totalCount: 1,
      truncated: false,
      fillActiveList: true,
    });
    expect(state.sessions).toEqual([]);
    expect(state.projectSessionsByPath['/p']?.map((session) => session.id)).toEqual(['p-row']);
  });

  it('does not drop a project hydrate when a general row is admitted', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, {
      type: 'session/hydrate-scope',
      scope: { kind: 'project', projectPath: '/p' },
      sessions: [],
      totalCount: 0,
      truncated: false,
      mutationEpoch: 0,
    });
    const projectEpoch =
      state.sessionListScopes.projects['/p']?.mutationEpoch ?? 0;
    state = chatUiReducer(state, {
      type: 'session/update',
      session: { id: 'g-new', name: 'General new', scope: { kind: 'general' } },
    });
    state = chatUiReducer(state, {
      type: 'session/hydrate-scope',
      scope: { kind: 'project', projectPath: '/p' },
      sessions: [{ id: 'p-row', name: 'Still valid' }],
      totalCount: 1,
      truncated: false,
      mutationEpoch: projectEpoch,
    });
    expect(state.projectSessionsByPath['/p']?.map((session) => session.id)).toEqual(['p-row']);
  });

  it('does not resurrect a deleted row from a stale hydrate', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, {
      type: 'session/hydrate-scope',
      scope: { kind: 'general' },
      sessions: [
        { id: 'keep', name: 'Keep' },
        { id: 'gone', name: 'Gone' },
      ],
      totalCount: 2,
      truncated: false,
      mutationEpoch: 0,
    });
    const epochBeforeDelete = state.sessionListScopes.general?.mutationEpoch ?? 0;
    state = chatUiReducer(state, { type: 'session/remove', sessionId: 'gone' });
    state = chatUiReducer(state, {
      type: 'session/hydrate-scope',
      scope: { kind: 'general' },
      sessions: [
        { id: 'keep', name: 'Keep' },
        { id: 'gone', name: 'Gone' },
      ],
      totalCount: 2,
      truncated: false,
      mutationEpoch: epochBeforeDelete,
    });
    expect(state.generalSessions.map((session) => session.id)).toEqual(['keep']);
    expect(state.sessionTombstonesById.gone).toBe(true);
  });

  it('clears pin when a patch explicitly sets false', () => {
    const merged = mergeSessionListItem(
      { id: 's1', name: 'Pinned', isPinned: true },
      { id: 's1', name: 'Pinned', isPinned: false },
    );
    expect(merged.isPinned).toBeUndefined();
  });

  it('rejects [host-path] as a project id when mapping listed sessions', () => {
    expect(
      mapListedSessionItem({
        id: 's1',
        name: 'Remote row',
        scope: { kind: 'project', projectPath: '[host-path]' },
      })?.scope,
    ).toBeUndefined();
    expect(
      mapListedSessionItem({
        id: 's1',
        name: 'Remote row',
        scope: { kind: 'project', projectPath: '[host-path]' },
        projectId: 'proj_opaque',
      })?.scope,
    ).toEqual({ kind: 'project', projectPath: 'proj_opaque' });
  });

  it('keeps existing rows when a later list request fails', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, {
      type: 'session/hydrate-scope',
      scope: { kind: 'general' },
      sessions: [{ id: 'keep', name: 'Keep' }],
      totalCount: 1,
      truncated: false,
    });
    state = chatUiReducer(state, {
      type: 'session/hydrate-error',
      scope: { kind: 'general' },
      error: 'host down',
    });
    expect(state.generalSessions.map((session) => session.id)).toEqual(['keep']);
    expect(state.sessionListScopes.general?.queryStatus).toBe('error');
    expect(state.sessionListScopes.general?.queryError).toBe('host down');
  });

  it('inserts a fallback-named first send into the owning list', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, {
      type: 'session/add',
      sessionId: 'created-on-send',
      name: 'Conversation',
      scope: { kind: 'project', projectPath: '/p' },
    });
    expect(
      state.projectSessionsByPath['/p']?.some((session) => session.id === 'created-on-send'),
    ).toBe(true);
  });
});
