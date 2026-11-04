import { beforeEach, describe, expect, it } from 'vitest';
import {
  LIBRARY_FAVORITES_STORAGE_KEY,
  loadLibraryFavorites,
  saveLibraryFavorites,
  toggleLibraryFavorite,
} from './library-favorites.js';

class MemoryStorage {
  private readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

describe('device-local 收藏', () => {
  let storage: MemoryStorage;
  beforeEach(() => {
    storage = new MemoryStorage();
  });

  it('round-trips keys and ignores junk payloads', () => {
    expect(loadLibraryFavorites(storage as unknown as Storage).size).toBe(0);
    saveLibraryFavorites(new Set(['s1:a1']), storage as unknown as Storage);
    expect([...loadLibraryFavorites(storage as unknown as Storage)]).toEqual(['s1:a1']);
    expect(storage.getItem(LIBRARY_FAVORITES_STORAGE_KEY)).toBe('["s1:a1"]');
    storage.setItem(LIBRARY_FAVORITES_STORAGE_KEY, '{"not":"a list"}');
    expect(loadLibraryFavorites(storage as unknown as Storage).size).toBe(0);
    storage.setItem(LIBRARY_FAVORITES_STORAGE_KEY, '["s1:a1", 42]');
    expect([...loadLibraryFavorites(storage as unknown as Storage)]).toEqual(['s1:a1']);
  });

  it('toggles without mutating the previous set', () => {
    const before = new Set(['s1:a1']);
    const added = toggleLibraryFavorite(before, 's1:a2');
    expect([...before]).toEqual(['s1:a1']);
    expect([...added]).toEqual(['s1:a1', 's1:a2']);
    expect([...toggleLibraryFavorite(added, 's1:a1')]).toEqual(['s1:a2']);
  });

  it('survives a storage that throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    } as unknown as Storage;
    expect(loadLibraryFavorites(broken).size).toBe(0);
    expect(() => saveLibraryFavorites(new Set(['s1:a1']), broken)).not.toThrow();
  });
});
