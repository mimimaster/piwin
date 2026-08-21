import { describe, expect, it } from 'vitest';
import type { SessionListItemUi } from './chat-reducer';
import { findAdjacentSessionId } from './session-navigation';

function createMockSession(id: string, overrides?: Partial<SessionListItemUi>): SessionListItemUi {
  return {
    id,
    name: `Session ${id}`,
    ...overrides,
  };
}

describe('findAdjacentSessionId', () => {
  it('selects the next session when archiving a middle session', () => {
    const sessions = [
      createMockSession('s1'),
      createMockSession('s2'),
      createMockSession('s3'),
      createMockSession('s4'),
    ];
    const result = findAdjacentSessionId({
      activeSessionId: 's2',
      sessions,
    });
    expect(result).toBe('s3');
  });

  it('selects the previous session when archiving the last session', () => {
    const sessions = [
      createMockSession('s1'),
      createMockSession('s2'),
      createMockSession('s3'),
    ];
    const result = findAdjacentSessionId({
      activeSessionId: 's3',
      sessions,
    });
    expect(result).toBe('s2');
  });

  it('selects the next session when archiving the first session', () => {
    const sessions = [
      createMockSession('s1'),
      createMockSession('s2'),
    ];
    const result = findAdjacentSessionId({
      activeSessionId: 's1',
      sessions,
    });
    expect(result).toBe('s2');
  });

  it('skips already archived sessions to find the nearest active session', () => {
    const sessions = [
      createMockSession('s1'),
      createMockSession('s2'),
      createMockSession('s3', { isArchived: true }),
      createMockSession('s4'),
    ];
    const result = findAdjacentSessionId({
      activeSessionId: 's2',
      sessions,
    });
    expect(result).toBe('s4');
  });

  it('falls back to earlier unarchived session if subsequent sessions are all archived', () => {
    const sessions = [
      createMockSession('s1'),
      createMockSession('s2'),
      createMockSession('s3', { isArchived: true }),
    ];
    const result = findAdjacentSessionId({
      activeSessionId: 's2',
      sessions,
    });
    expect(result).toBe('s1');
  });

  it('searches fallback sessions if primary sessions has no other unarchived session', () => {
    const sessions = [
      createMockSession('p1'),
    ];
    const fallbackSessions = [
      createMockSession('g1'),
      createMockSession('g2'),
    ];
    const result = findAdjacentSessionId({
      activeSessionId: 'p1',
      sessions,
      fallbackSessions,
    });
    expect(result).toBe('g1');
  });

  it('returns null when no unarchived session exists in primary or fallback', () => {
    const sessions = [
      createMockSession('s1'),
    ];
    const fallbackSessions = [
      createMockSession('g1', { isArchived: true }),
    ];
    const result = findAdjacentSessionId({
      activeSessionId: 's1',
      sessions,
      fallbackSessions,
    });
    expect(result).toBeNull();
  });

  it('returns null when session lists are empty', () => {
    const result = findAdjacentSessionId({
      activeSessionId: 's1',
      sessions: [],
    });
    expect(result).toBeNull();
  });
});
