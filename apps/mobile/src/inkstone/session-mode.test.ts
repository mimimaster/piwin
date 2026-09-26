import { describe, expect, it } from 'vitest';
import type { RemoteSessionSummary } from '@piwin/contracts';
import {
  SESSION_MODE_STORAGE_KEY,
  filterSessionsByMode,
  pickDefaultAgentProjectId,
  readSessionMode,
  sessionModeOf,
  writeSessionMode,
} from './session-mode.js';

const sessions: RemoteSessionSummary[] = [
  { sessionId: 'chat-1', scope: 'general', updatedAt: '2026-09-26T10:00:00.000Z' },
  { sessionId: 'old', scope: 'project', projectId: 'p-old', updatedAt: '2026-09-20T10:00:00.000Z' },
  { sessionId: 'new', scope: 'project', projectId: 'p-new', updatedAt: '2026-09-25T10:00:00.000Z' },
  { sessionId: 'gone', scope: 'project', projectId: 'p-gone', updatedAt: '2026-09-27T10:00:00.000Z' },
  { sessionId: 'odd', scope: 'unknown' },
];
const projects = [
  { projectId: 'p-old', displayName: 'Old' },
  { projectId: 'p-new', displayName: 'New' },
];

class MemoryStorage {
  private readonly data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

describe('session mode', () => {
  it('treats only project-scoped sessions as Agent work', () => {
    expect(sessionModeOf({ scope: 'project' })).toBe('agent');
    expect(sessionModeOf({ scope: 'general' })).toBe('chat');
    expect(sessionModeOf({ scope: 'unknown' })).toBe('chat');
    expect(sessionModeOf(undefined)).toBe('chat');
    expect(filterSessionsByMode(sessions, 'chat').map((session) => session.sessionId)).toEqual(['chat-1', 'odd']);
    expect(filterSessionsByMode(sessions, 'agent').map((session) => session.sessionId)).toEqual([
      'old',
      'new',
      'gone',
    ]);
  });

  it('defaults an Agent draft to the most recent project the Host still lists', () => {
    expect(pickDefaultAgentProjectId(sessions, projects)).toBe('p-new');
    expect(pickDefaultAgentProjectId([], projects)).toBe('p-old');
    expect(pickDefaultAgentProjectId(sessions, [])).toBeUndefined();
  });

  it('remembers the chosen half and falls back to conversations', () => {
    const storage = new MemoryStorage();
    expect(readSessionMode(storage)).toBe('chat');
    writeSessionMode('agent', storage);
    expect(readSessionMode(storage)).toBe('agent');
    storage.setItem(SESSION_MODE_STORAGE_KEY, 'bogus');
    expect(readSessionMode(storage)).toBe('chat');
  });
});
