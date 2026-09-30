import { describe, expect, it, vi } from 'vitest';
import {
  resolveSessionAgentId,
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

describe('resolveSessionAgentId (ADR 0082)', () => {
  it('reports the agent for a non-Pi backend session', () => {
    expect(
      resolveSessionAgentId('s1', [{ id: 's1', name: 'Grok work', backend: { agentId: 'grok' } }]),
    ).toBe('grok');
  });

  it('treats Pi and missing backend as no external agent', () => {
    // Pi is the default; labelling its sessions would add noise for no reason.
    expect(resolveSessionAgentId('s1', [{ id: 's1', backend: { agentId: 'pi' } }])).toBeUndefined();
    expect(resolveSessionAgentId('s1', [{ id: 's1', name: 'Plain' }])).toBeUndefined();
    expect(resolveSessionAgentId('missing', [])).toBeUndefined();
  });
});

describe('routeSessionChromeMenuAction delete', () => {
  it('passes the agent id so destructive copy can name the backend', () => {
    const requestDelete = vi.fn();
    routeSessionChromeMenuAction({
      sessionId: 's1',
      action: 'delete',
      sessions: [{ id: 's1', name: 'Grok work', backend: { agentId: 'grok' } }],
      requestDelete,
      requestContinueInProject: vi.fn(),
      handleHostMenuAction: vi.fn(),
    });
    expect(requestDelete).toHaveBeenCalledWith('s1', 'Grok work', 'grok');
  });

  it('omits the agent id for a Pi session', () => {
    const requestDelete = vi.fn();
    routeSessionChromeMenuAction({
      sessionId: 's1',
      action: 'delete',
      sessions: [{ id: 's1', name: 'Pi work' }],
      requestDelete,
      requestContinueInProject: vi.fn(),
      handleHostMenuAction: vi.fn(),
    });
    expect(requestDelete).toHaveBeenCalledWith('s1', 'Pi work');
  });
});
