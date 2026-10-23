import { expect, it } from 'vitest';
import { chatUiReducer, createInitialChatUiState } from './chat-reducer.js';
it('retains native activity while a title arrives and a sidebar scope hydrates', () => {
  let state = createInitialChatUiState();
  const scope = { kind: 'project' as const, projectPath: '/project' };
  state = chatUiReducer(state, { type: 'session/update', session: { id: 'grok', name: '', scope, backend: { agentId: 'grok' } } });
  state = chatUiReducer(state, { type: 'session/update', session: { id: 'grok', name: '', nativeCli: { kind: 'native', sessionId: 'grok', ptyId: 'pty', activity: 'running' } } });
  state = chatUiReducer(state, { type: 'session/update', session: { id: 'grok', name: 'Late title', scope } });
  state = chatUiReducer(state, { type: 'session/hydrate-scope', scope, sessions: [{ id: 'grok', name: 'Late title', scope }], totalCount: 1, truncated: false, mutationEpoch: state.sessionListMutationEpoch });
  expect(state.projectSessionsByPath['/project']?.[0]).toMatchObject({ nativeCli: { kind: 'native', activity: 'running' } });
});
