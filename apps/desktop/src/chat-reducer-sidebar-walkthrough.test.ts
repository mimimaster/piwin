import { describe, expect, it } from 'vitest';
import {
  chatUiReducer,
  createInitialChatUiState,
} from './chat-reducer';

describe('chatUiReducer sidebar', () => {
  describe('generalSessions (Conversations sidebar section)', () => {
    it('hydrates general and project scopes independently without deselecting an out-of-bound active row', () => {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, { type: 'session/set', sessionId: 'older-active' });
      state = chatUiReducer(state, {
        type: 'session/hydrate-scope',
        scope: { kind: 'general' },
        sessions: Array.from({ length: 12 }, (_, index) => ({
          id: `page-${index}`,
          name: `Page ${index}`,
        })),
        totalCount: 12,
        truncated: false,
      });
      state = chatUiReducer(state, {
        type: 'session/hydrate-scope',
        scope: { kind: 'project', projectPath: '/proj' },
        sessions: [{ id: 'p1', name: 'Project one' }],
        totalCount: 1,
        truncated: false,
      });

      expect(state.sessionListScopes.general).toEqual({
        totalCount: 12,
        truncated: false,
        mutationEpoch: 0,
        queryStatus: 'ready',
      });
      expect(state.sessionListScopes.projects['/proj']).toEqual({
        totalCount: 1,
        truncated: false,
        mutationEpoch: 0,
        queryStatus: 'ready',
      });
      expect(state.sessions).toHaveLength(12);
      expect(state.generalSessions).toHaveLength(12);
      expect(state.projectSessionsByPath['/proj']).toHaveLength(1);
      expect(state.activeSessionId).toBe('older-active');
    });

    it('admits a local upsert outside the bounded set without double-counting', () => {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, { type: 'session/set', sessionId: 'outside' });
      state = chatUiReducer(state, {
        type: 'session/hydrate-scope',
        scope: { kind: 'general' },
        sessions: Array.from({ length: 40 }, (_, index) => ({
          id: `page-${index}`,
          name: `Page ${index}`,
        })),
        totalCount: 2005,
        truncated: true,
      });
      state = chatUiReducer(state, {
        type: 'session/update',
        session: { id: 'outside', name: 'Outside bound', scope: { kind: 'general' } },
      });
      expect(state.generalSessions.some((session) => session.id === 'outside')).toBe(true);
      expect(state.generalSessions).toHaveLength(41);
      expect(state.sessionListScopes.general?.totalCount).toBe(2005);
    });

    it('ignores a stale hydrate that started before a first-send name admit', () => {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, { type: 'session/clear-active' });
      state = chatUiReducer(state, { type: 'session/set', sessionId: 'live-new' });
      const epochBeforeName = state.sessionListMutationEpoch;
      state = chatUiReducer(state, {
        type: 'session/update',
        session: {
          id: 'live-new',
          name: 'Fix the login bug',
          scope: { kind: 'general' },
          updatedAt: '2026-08-27T12:00:00.000Z',
        },
      });
      expect(state.generalSessions.map((session) => session.id)).toContain('live-new');
      expect(state.sessionListMutationEpoch).toBe(epochBeforeName + 1);

      // In-flight session/list that started before the name landed.
      const afterStale = chatUiReducer(state, {
        type: 'session/hydrate-scope',
        scope: { kind: 'general' },
        sessions: [
          { id: 'older-1', name: 'Older one', updatedAt: '2026-08-26T00:00:00.000Z' },
          { id: 'older-2', name: 'Older two', updatedAt: '2026-08-25T00:00:00.000Z' },
        ],
        totalCount: 2,
        truncated: false,
        mutationEpoch: epochBeforeName,
      });
      expect(afterStale).toBe(state);
      expect(afterStale.generalSessions.map((session) => session.id)).toContain('live-new');

      // A hydrate that observed the post-admit epoch may still replace the page.
      const afterFresh = chatUiReducer(state, {
        type: 'session/hydrate-scope',
        scope: { kind: 'general' },
        sessions: [
          {
            id: 'live-new',
            name: 'Fix the login bug',
            updatedAt: '2026-08-27T12:00:00.000Z',
          },
          { id: 'older-1', name: 'Older one', updatedAt: '2026-08-26T00:00:00.000Z' },
        ],
        totalCount: 2,
        truncated: false,
        mutationEpoch: state.sessionListMutationEpoch,
      });
      expect(afterFresh.generalSessions.map((session) => session.id)).toEqual([
        'live-new',
        'older-1',
      ]);
    });

    it('does not let a placeholder index push erase an existing listable title', () => {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, { type: 'session/set', sessionId: 'named' });
      state = chatUiReducer(state, {
        type: 'session/update',
        session: {
          id: 'named',
          name: 'Fix the login bug',
          scope: { kind: 'general' },
        },
      });
      state = chatUiReducer(state, {
        type: 'session/update',
        session: {
          id: 'named',
          name: '',
          scope: { kind: 'general' },
          messageCount: 1,
        },
      });
      expect(state.generalSessions.find((session) => session.id === 'named')?.name).toBe(
        'Fix the login bug',
      );
      expect(state.generalSessions.find((session) => session.id === 'named')?.messageCount).toBe(1);
    });

    it('add and delete adjust total count once, and never rettruncate lists to 18/36', () => {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, {
        type: 'session/hydrate-scope',
        scope: { kind: 'general' },
        sessions: Array.from({ length: 40 }, (_, index) => ({
          id: `page-${index}`,
          name: `Page ${index}`,
        })),
        totalCount: 40,
        truncated: false,
      });
      state = chatUiReducer(state, {
        type: 'session/add',
        sessionId: 'new-row',
        name: 'Brand new',
      });
      expect(state.generalSessions).toHaveLength(41);
      expect(state.sessionListScopes.general?.totalCount).toBe(41);
      state = chatUiReducer(state, {
        type: 'session/add',
        sessionId: 'new-row',
        name: 'Brand new',
      });
      expect(state.sessionListScopes.general?.totalCount).toBe(41);
      state = chatUiReducer(state, { type: 'session/remove', sessionId: 'new-row' });
      expect(state.generalSessions).toHaveLength(40);
      expect(state.sessionListScopes.general?.totalCount).toBe(40);
    });

    it('keeps placeholder sessions unlistable', () => {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, {
        type: 'session/add',
        sessionId: 'draft',
        name: 'session-placeholder',
      });
      expect(state.generalSessions.some((session) => session.id === 'draft')).toBe(false);
      expect(state.activeSessionId).toBe('draft');
    });

    it('session/hydrate-general populates generalSessions without clearing project sessions', () => {
      let state = createInitialChatUiState();
      // Simulate opening a project: project/set clears sessions, then hydrate
      // loads project sessions.
      state = chatUiReducer(state, {
        type: 'project/set',
        path: '/proj',
        trusted: true,
      });
      state = chatUiReducer(state, {
        type: 'session/hydrate',
        sessions: [{ id: 'p1', name: 'Project Session' }],
      });
      // Background hydrate of general sessions should not wipe project sessions.
      state = chatUiReducer(state, {
        type: 'session/hydrate-general',
        sessions: [
          { id: 'g1', name: 'General 1' },
          { id: 'g2', name: 'General 2' },
        ],
      });
      expect(state.sessions.map((item) => item.id)).toEqual(['p1']);
      expect(state.generalSessions.map((item) => item.id)).toEqual(['g1', 'g2']);
      expect(state.activeSessionId).toBeNull();
    });

    it('session/hydrate-general mirrors into sessions when general is active scope', () => {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, {
        type: 'session/hydrate-general',
        sessions: [
          { id: 'g1', name: 'General 1' },
          { id: 'g2', name: 'General 2' },
        ],
      });
      // activeScope is general by default → sessions should mirror generalSessions.
      expect(state.sessions.map((item) => item.id)).toEqual(['g1', 'g2']);
      expect(state.generalSessions.map((item) => item.id)).toEqual(['g1', 'g2']);
    });

    it('session/add prepends to generalSessions when active scope is general', () => {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, {
        type: 'session/hydrate-general',
        sessions: [
          {
            id: 'g1',
            name: 'General 1',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      });
      state = chatUiReducer(state, {
        type: 'session/add',
        sessionId: 'g2',
        name: 'New General',
      });
      expect(state.generalSessions.map((item) => item.id)).toEqual(['g2', 'g1']);
      expect(state.sessions.map((item) => item.id)).toEqual(['g2', 'g1']);
      // New Conversations rows must carry updatedAt so sort keeps them on top.
      expect(state.generalSessions[0]?.updatedAt).toBeTruthy();
      const newStamp = Date.parse(state.generalSessions[0]?.updatedAt ?? '');
      const oldStamp = Date.parse(state.generalSessions[1]?.updatedAt ?? '');
      expect(newStamp).toBeGreaterThan(oldStamp);
    });

    it('session/add does NOT touch generalSessions when active scope is project', () => {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, {
        type: 'session/hydrate-general',
        sessions: [{ id: 'g1', name: 'General 1' }],
      });
      state = chatUiReducer(state, {
        type: 'project/set',
        path: '/proj',
        trusted: true,
      });
      state = chatUiReducer(state, {
        type: 'session/add',
        sessionId: 'p1',
        name: 'New Project',
      });
      expect(state.generalSessions.map((item) => item.id)).toEqual(['g1']);
      expect(state.sessions.map((item) => item.id)).toEqual(['p1']);
    });

    it('session/remove drops from both sessions and generalSessions', () => {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, {
        type: 'session/hydrate-general',
        sessions: [
          { id: 'g1', name: 'G1' },
          { id: 'g2', name: 'G2' },
        ],
      });
      state = chatUiReducer(state, { type: 'session/set', sessionId: 'g1' });
      state = chatUiReducer(state, { type: 'session/remove', sessionId: 'g1' });
      expect(state.sessions.map((item) => item.id)).toEqual(['g2']);
      expect(state.generalSessions.map((item) => item.id)).toEqual(['g2']);
    });

    it('session/hydrate-project populates projectSessionsByPath without touching active scope', () => {
      let state = createInitialChatUiState();
      // Active scope is general with its own sessions.
      state = chatUiReducer(state, {
        type: 'session/hydrate-general',
        sessions: [{ id: 'g1', name: 'General 1' }],
      });
      // Hydrate a non-active project folder.
      state = chatUiReducer(state, {
        type: 'session/hydrate-project',
        projectPath: '/other-proj',
        sessions: [{ id: 'p1', name: 'Other Project Session' }],
      });
      expect(state.projectSessionsByPath['/other-proj']?.map((s) => s.id)).toEqual(['p1']);
      // Active scope sessions and generalSessions must be untouched.
      expect(state.sessions.map((s) => s.id)).toEqual(['g1']);
      expect(state.generalSessions.map((s) => s.id)).toEqual(['g1']);
      expect(state.activeSessionId).toBeNull();
    });

    it('session/retain-project-paths drops folders that left the recent list', () => {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, { type: 'project/set', path: '/keep-active', trusted: true });
      state = chatUiReducer(state, {
        type: 'session/hydrate-project',
        projectPath: '/keep-active',
        sessions: [{ id: 'active-1', name: 'Active' }],
      });
      state = chatUiReducer(state, {
        type: 'session/hydrate-project',
        projectPath: '/recent',
        sessions: [{ id: 'recent-1', name: 'Recent' }],
      });
      state = chatUiReducer(state, {
        type: 'session/hydrate-project',
        projectPath: '/stale',
        sessions: [{ id: 'stale-1', name: 'Stale' }],
      });
      state = chatUiReducer(state, {
        type: 'session/retain-project-paths',
        projectPaths: ['/recent'],
      });
      expect(Object.keys(state.projectSessionsByPath).sort()).toEqual(['/keep-active', '/recent']);
    });

    it('session/hydrate mirrors into projectSessionsByPath for the active project', () => {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, { type: 'project/set', path: '/proj', trusted: true });
      state = chatUiReducer(state, {
        type: 'session/hydrate',
        sessions: [{ id: 'p1', name: 'Project Session' }],
      });
      expect(state.sessions.map((s) => s.id)).toEqual(['p1']);
      expect(state.projectSessionsByPath['/proj']?.map((s) => s.id)).toEqual(['p1']);
    });

    it('session/remove drops from projectSessionsByPath across all projects', () => {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, {
        type: 'session/hydrate-project',
        projectPath: '/proj-a',
        sessions: [{ id: 'shared', name: 'A' }],
      });
      state = chatUiReducer(state, {
        type: 'session/hydrate-project',
        projectPath: '/proj-b',
        sessions: [{ id: 'shared', name: 'B' }],
      });
      state = chatUiReducer(state, { type: 'session/remove', sessionId: 'shared' });
      expect(state.projectSessionsByPath['/proj-a']).toEqual([]);
      expect(state.projectSessionsByPath['/proj-b']).toEqual([]);
    });

    it('project/set and project/clear preserve generalSessions', () => {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, {
        type: 'session/hydrate-general',
        sessions: [{ id: 'g1', name: 'G1' }],
      });
      state = chatUiReducer(state, {
        type: 'project/set',
        path: '/proj',
        trusted: true,
      });
      expect(state.generalSessions.map((item) => item.id)).toEqual(['g1']);
      expect(state.sessions).toEqual([]);

      state = chatUiReducer(state, { type: 'project/clear' });
      expect(state.generalSessions.map((item) => item.id)).toEqual(['g1']);
      expect(state.sessions).toEqual([]);
    });

    it('session/clear-active enters draft mode (null activeSessionId, cleared messages)', () => {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, {
        type: 'session/hydrate-general',
        sessions: [{ id: 'g1', name: 'G1' }],
      });
      state = chatUiReducer(state, { type: 'session/set', sessionId: 'g1' });
      state = chatUiReducer(state, {
        type: 'session/load-messages',
        sessionId: 'g1',
        messages: [
          {
            id: 'm1',
            role: 'user',
            text: 'hi',
            thinking: '',
            tools: [],
            attachments: [],
            status: 'done',
            createdAt: new Date().toISOString(),
          },
        ],
        contextUsage: {
          sessionId: 'g1',
          tokensUsed: 8_276,
          updatedAt: '2026-08-11T10:21:36.342Z',
          source: 'assistant-usage',
        },
      });
      expect(state.activeSessionId).toBe('g1');
      expect(state.messages).toHaveLength(1);
      expect(state.contextUsage?.tokensUsed).toBe(8_276);

      // session/clear-active is the "New session" (draft mode) action.
      state = chatUiReducer(state, { type: 'session/clear-active' });
      expect(state.activeSessionId).toBe(null);
      expect(state.contextUsage).toBeNull();
      expect(state.messages).toEqual([]);
      expect(state.outline).toEqual([]);
      expect(state.activeSessionArchived).toBe(false);
      expect(state.runPhase).toBe('idle');
      expect(state.streaming).toBe(false);
      // Sidebar list is preserved — only the active session is cleared.
      expect(state.sessions.map((item) => item.id)).toEqual(['g1']);
      expect(state.generalSessions.map((item) => item.id)).toEqual(['g1']);
    });

    it('session/update does not insert a project session into generalSessions when general is active', () => {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, {
        type: 'session/hydrate-general',
        sessions: [{ id: 'g1', name: 'General 1', scope: { kind: 'general' } }],
      });
      state = chatUiReducer(state, {
        type: 'session/hydrate-project',
        projectPath: '/proj',
        sessions: [
          {
            id: 'p1',
            name: 'Project Session',
            scope: { kind: 'project', projectPath: '/proj' },
          },
        ],
      });
      // Simulate a name-updated push while Conversations (general) is active.
      state = chatUiReducer(state, {
        type: 'session/update',
        session: {
          id: 'p1',
          name: 'Renamed Project',
          scope: { kind: 'project', projectPath: '/proj' },
        },
      });
      expect(state.generalSessions.map((item) => item.id)).toEqual(['g1']);
      expect(state.projectSessionsByPath['/proj']?.map((item) => item.id)).toEqual(['p1']);
      expect(state.projectSessionsByPath['/proj']?.[0]?.name).toBe('Renamed Project');
      // Active general list must not gain the project row either.
      expect(state.sessions.map((item) => item.id)).toEqual(['g1']);
    });

    it('session/update rehomes a dual-listed project row out of Conversations', () => {
      let state = createInitialChatUiState();
      // Corrupt dual listing: same id under general and a project folder.
      state = chatUiReducer(state, {
        type: 'session/hydrate-general',
        sessions: [
          {
            id: 'shared',
            name: '继续',
            scope: { kind: 'general' },
          },
        ],
      });
      state = chatUiReducer(state, {
        type: 'session/hydrate-project',
        projectPath: '/Users/dev/piwin',
        sessions: [
          {
            id: 'shared',
            name: '继续',
            scope: { kind: 'project', projectPath: '/Users/dev/piwin' },
          },
        ],
      });
      expect(state.generalSessions.map((item) => item.id)).toEqual(['shared']);
      // Authoritative project scope from host clears the Conversations copy.
      state = chatUiReducer(state, {
        type: 'session/update',
        session: {
          id: 'shared',
          name: '继续',
          scope: { kind: 'project', projectPath: '/Users/dev/piwin' },
        },
      });
      expect(state.generalSessions.map((item) => item.id)).toEqual([]);
      expect(state.projectSessionsByPath['/Users/dev/piwin']?.map((item) => item.id)).toEqual([
        'shared',
      ]);
      expect(state.sessions.map((item) => item.id)).toEqual([]);
    });
  });
});
