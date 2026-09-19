import { describe, expect, it } from 'vitest';
import { resolveComposerAgentModeForSessionChange } from './composer-agent-mode-session';

describe('resolveComposerAgentModeForSessionChange', () => {
  it('does not carry Goal onto another live session', () => {
    const result = resolveComposerAgentModeForSessionChange({
      previousSessionId: 'session-a',
      nextSessionId: 'session-b',
      currentMode: 'goal',
      parked: new Map(),
    });
    expect(result.mode).toBe('agent');
    expect(result.parked.get('session-a')).toBe('goal');
    expect(result.parked.has('session-b')).toBe(false);
  });

  it('restores Goal when returning to the session that armed it', () => {
    const parked = new Map<string, 'agent' | 'goal'>([['session-a', 'goal']]);
    const result = resolveComposerAgentModeForSessionChange({
      previousSessionId: 'session-b',
      nextSessionId: 'session-a',
      currentMode: 'agent',
      parked,
    });
    expect(result.mode).toBe('goal');
    expect(result.parked.get('session-a')).toBe('goal');
    expect(result.parked.has('session-b')).toBe(false);
  });

  it('opens New Agent as Agent and parks the live session Goal', () => {
    const result = resolveComposerAgentModeForSessionChange({
      previousSessionId: 'session-a',
      nextSessionId: null,
      currentMode: 'goal',
      parked: new Map(),
    });
    expect(result.mode).toBe('agent');
    expect(result.parked.get('session-a')).toBe('goal');
  });

  it('does not park a New Agent draft Goal onto the next session', () => {
    const result = resolveComposerAgentModeForSessionChange({
      previousSessionId: null,
      nextSessionId: 'session-b',
      currentMode: 'goal',
      parked: new Map(),
    });
    expect(result.mode).toBe('agent');
    expect(result.parked.size).toBe(0);
  });

  it('treats another New Agent from a draft as Agent', () => {
    const result = resolveComposerAgentModeForSessionChange({
      previousSessionId: null,
      nextSessionId: null,
      currentMode: 'goal',
      parked: new Map(),
    });
    expect(result.mode).toBe('agent');
    expect(result.parked.size).toBe(0);
  });
});
