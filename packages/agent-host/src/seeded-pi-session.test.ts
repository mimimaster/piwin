import { describe, expect, it, vi } from 'vitest';
import type { SessionSeedMessage } from '@piwin/contracts';
import {
  createSeededPiSessionManager,
  createSeededPiSettingsManager,
} from './seeded-pi-session.js';

describe('createSeededPiSessionManager', () => {
  it('uses Pi in-memory history without creating a persisted session file', () => {
    const appended: unknown[] = [];
    const manager = {
      appendMessage: vi.fn((message: unknown) => {
        appended.push(message);
        return `entry-${appended.length}`;
      }),
    };
    const inMemory = vi.fn(() => manager);
    const seedMessages: SessionSeedMessage[] = [
      { role: 'user', text: 'Question', timestamp: 1000 },
      { role: 'assistant', text: 'Answer', timestamp: 2000 },
    ];

    const result = createSeededPiSessionManager(
      { SessionManager: { inMemory } },
      '/tmp/project',
      seedMessages,
    );

    expect(result).toBe(manager);
    expect(inMemory).toHaveBeenCalledWith('/tmp/project');
    expect(appended).toHaveLength(2);
    expect(appended[0]).toMatchObject({ role: 'user', content: 'Question', timestamp: 1000 });
    expect(appended[1]).toMatchObject({
      role: 'assistant',
      content: [{ type: 'text', text: 'Answer' }],
      timestamp: 2000,
    });
  });

  it('limits recent tokens only for the ephemeral compaction settings', () => {
    const inMemory = vi.fn((settings: Record<string, unknown>) => settings);

    const result = createSeededPiSettingsManager({ SettingsManager: { inMemory } });

    expect(inMemory).toHaveBeenCalledWith({ compaction: { keepRecentTokens: 1 } });
    expect(result).toEqual({ compaction: { keepRecentTokens: 1 } });
  });
});
