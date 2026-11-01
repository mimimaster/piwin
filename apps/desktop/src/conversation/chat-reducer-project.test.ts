import { describe, expect, it } from 'vitest';
import { chatUiReducer, createInitialChatUiState, type ChatUiAction } from './chat-reducer.js';

describe('project trust confirmation', () => {
  const cases: { action: ChatUiAction; path: string | null; trusted: boolean }[] = [
    {
      action: { type: 'project/set', path: '/project', trusted: true },
      path: '/project',
      trusted: true,
    },
    {
      action: { type: 'project/set', path: '/project', trusted: false },
      path: '/project',
      trusted: false,
    },
    {
      action: { type: 'project/set', path: '/project', trusted: true, keepActiveSession: true },
      path: '/project',
      trusted: true,
    },
    {
      action: { type: 'project/set', path: '/project', trusted: false, keepActiveSession: true },
      path: '/project',
      trusted: false,
    },
    { action: { type: 'project/clear' }, path: null, trusted: false },
    { action: { type: 'project/clear', keepActiveSession: true }, path: null, trusted: false },
    { action: { type: 'project/trusted' }, path: '/cached', trusted: true },
  ];

  it.each(cases)('settles a pending cached project after $action', ({ action, path, trusted }) => {
    const state = {
      ...createInitialChatUiState(),
      projectPath: '/cached',
      projectTrustPending: true,
    };
    const updated = chatUiReducer(state, action);
    expect(updated).toMatchObject({
      projectPath: path,
      projectTrusted: trusted,
      projectTrustPending: false,
    });
  });
});
