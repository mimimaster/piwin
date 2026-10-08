import { describe, expect, it } from 'vitest';
import {
  CONVERSATION_SURFACE_STORAGE_KEY,
  readConversationSurface,
  writeConversationSurface,
} from './conversation-surface';

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

describe('conversation surface preference', () => {
  it('defaults to the chat surface, including for unknown stored values', () => {
    expect(readConversationSurface(memoryStorage())).toBe('chat');
    expect(readConversationSurface(memoryStorage({ [CONVERSATION_SURFACE_STORAGE_KEY]: 'vim' }))).toBe('chat');
    expect(readConversationSurface(undefined)).toBe('chat');
  });

  it('round-trips the terminal surface', () => {
    const storage = memoryStorage();
    writeConversationSurface('tui', storage);
    expect(readConversationSurface(storage)).toBe('tui');
  });

  it('survives storage that throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readConversationSurface(broken)).toBe('chat');
    expect(() => writeConversationSurface('tui', broken)).not.toThrow();
  });
});
