import { describe, expect, it, vi } from 'vitest';
import {
  resolveSessionDisplayName,
  routeSessionChromeMenuAction,
} from './use-session-list-chrome';

describe('resolveSessionDisplayName', () => {
  it('prefers a trimmed name and falls back to a short id', () => {
    expect(
      resolveSessionDisplayName('session-abcdef', [{ id: 'session-abcdef', name: '  Alpha  ' }]),
    ).toBe('Alpha');
    expect(resolveSessionDisplayName('session-abcdef', [{ id: 'other', name: 'Nope' }])).toBe(
      'session-',
    );
  });
});

describe('routeSessionChromeMenuAction', () => {
  it('opens delete / continue drafts and forwards other actions to Host', () => {
    const requestDelete = vi.fn();
    const requestContinueInProject = vi.fn();
    const handleHostMenuAction = vi.fn();
    const sessions = [{ id: 's1', name: 'Notes' }];

    routeSessionChromeMenuAction({
      sessionId: 's1',
      action: 'delete',
      sessions,
      requestDelete,
      requestContinueInProject,
      handleHostMenuAction,
    });
    routeSessionChromeMenuAction({
      sessionId: 's1',
      action: 'continue-in-project',
      sessions,
      requestDelete,
      requestContinueInProject,
      handleHostMenuAction,
    });
    routeSessionChromeMenuAction({
      sessionId: 's1',
      action: 'archive',
      sessions,
      requestDelete,
      requestContinueInProject,
      handleHostMenuAction,
    });

    expect(requestDelete).toHaveBeenCalledWith('s1', 'Notes');
    expect(requestContinueInProject).toHaveBeenCalledWith('s1', 'Notes');
    expect(handleHostMenuAction).toHaveBeenCalledWith('s1', 'archive');
  });
});
