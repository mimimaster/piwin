import { describe, expect, it } from 'vitest';
import { readSessionKeyedValue, writeSessionKeyedValue } from './session-keyed-memory';

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

const asString = (value: unknown): string | null => (typeof value === 'string' ? value : null);

describe('session keyed memory', () => {
  it('reads back the value written for a session', () => {
    const storage = memoryStorage();
    writeSessionKeyedValue('k', 's1', 'one', storage);
    writeSessionKeyedValue('k', 's2', 'two', storage);
    writeSessionKeyedValue('k', 's1', 'uno', storage);
    expect(readSessionKeyedValue('k', 's1', asString, storage)).toBe('uno');
    expect(readSessionKeyedValue('k', 's2', asString, storage)).toBe('two');
    expect(readSessionKeyedValue('k', 's3', asString, storage)).toBeNull();
  });

  it('drops the least recently written sessions past the cap', () => {
    const storage = memoryStorage();
    writeSessionKeyedValue('k', 'old', 'a', storage, 2);
    writeSessionKeyedValue('k', 'mid', 'b', storage, 2);
    writeSessionKeyedValue('k', 'new', 'c', storage, 2);
    expect(readSessionKeyedValue('k', 'old', asString, storage)).toBeNull();
    expect(readSessionKeyedValue('k', 'new', asString, storage)).toBe('c');
  });

  it('treats damaged storage as empty', () => {
    const storage = memoryStorage();
    storage.setItem('k', '{not json');
    expect(readSessionKeyedValue('k', 's1', asString, storage)).toBeNull();
  });
});
