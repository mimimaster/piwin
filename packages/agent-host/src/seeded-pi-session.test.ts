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

  it('replays native entries verbatim and falls back per-seed on truncation', () => {
    const appended: unknown[] = [];
    const manager = {
      appendMessage: vi.fn((message: unknown) => {
        appended.push(message);
        return `entry-${appended.length}`;
      }),
    };
    const nativeAssistant = JSON.stringify({
      role: 'assistant',
      content: [{ type: 'toolCall', id: 't1', name: 'bash', arguments: { command: 'pwd' } }],
      timestamp: 5,
    });
    const nativeToolResult = JSON.stringify({
      role: 'toolResult',
      toolCallId: 't1',
      toolName: 'bash',
      content: [{ type: 'text', text: '/workspace' }],
      isError: false,
      timestamp: 6,
    });

    createSeededPiSessionManager({ SessionManager: { inMemory: () => manager } }, '/tmp', [
      { role: 'user', text: 'run it', timestamp: 4 },
      {
        role: 'assistant',
        text: 'ok',
        timestamp: 5,
        native: [
          { format: 'pi-message-v1', payload: nativeAssistant, byteLength: nativeAssistant.length },
          {
            format: 'pi-message-v1',
            payload: nativeToolResult,
            byteLength: nativeToolResult.length,
          },
        ],
      },
      {
        role: 'assistant',
        text: 'fallback text',
        timestamp: 7,
        native: [{ format: 'pi-message-v1', payload: '', byteLength: 999_999, truncated: true }],
      },
    ]);

    expect(appended).toHaveLength(4);
    expect(appended[0]).toMatchObject({ role: 'user', content: 'run it' });
    expect(appended[1]).toMatchObject({
      role: 'assistant',
      content: [{ type: 'toolCall', id: 't1' }],
    });
    expect(appended[2]).toMatchObject({ role: 'toolResult', toolCallId: 't1' });
    expect(appended[3]).toMatchObject({
      role: 'assistant',
      content: [{ type: 'text', text: 'fallback text' }],
    });
  });

  it('falls back to text when any native entry fails to parse', () => {
    const appended: unknown[] = [];
    const manager = {
      appendMessage: vi.fn((message: unknown) => {
        appended.push(message);
        return 'entry';
      }),
    };
    createSeededPiSessionManager({ SessionManager: { inMemory: () => manager } }, '/tmp', [
      {
        role: 'assistant',
        text: 'text form',
        timestamp: 1,
        native: [{ format: 'pi-message-v1', payload: '{not-json', byteLength: 9 }],
      },
    ]);
    expect(appended).toHaveLength(1);
    expect(appended[0]).toMatchObject({
      role: 'assistant',
      content: [{ type: 'text', text: 'text form' }],
    });
  });

  it('limits recent tokens only for the ephemeral compaction settings', () => {
    const inMemory = vi.fn((settings: Record<string, unknown>) => settings);

    const result = createSeededPiSettingsManager({ SettingsManager: { inMemory } });

    expect(inMemory).toHaveBeenCalledWith({
      compaction: { keepRecentTokens: 1 },
      retry: { enabled: false, maxRetries: 0 },
    });
    expect(result).toEqual({
      compaction: { keepRecentTokens: 1 },
      retry: { enabled: false, maxRetries: 0 },
    });
  });
});
