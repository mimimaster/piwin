import { describe, expect, it } from 'vitest';
import {
  readStoredRightPanelView,
  writeStoredRightPanelView,
  RIGHT_PANEL_VIEW_STORAGE_KEY,
} from './right-panel-memory';

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.get(key) ?? null;
    },
    key(index: number) {
      return [...map.keys()][index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    },
  };
}

describe('right-panel-memory', () => {
  it('defaults to home when empty or invalid', () => {
    expect(readStoredRightPanelView(memoryStorage())).toBe('home');
    expect(
      readStoredRightPanelView(
        memoryStorage({ [RIGHT_PANEL_VIEW_STORAGE_KEY]: 'nope' }),
      ),
    ).toBe('home');
    expect(readStoredRightPanelView(null)).toBe('home');
  });

  it('round-trips detail view', () => {
    const storage = memoryStorage();
    writeStoredRightPanelView('detail', storage);
    expect(storage.getItem(RIGHT_PANEL_VIEW_STORAGE_KEY)).toBe('detail');
    expect(readStoredRightPanelView(storage)).toBe('detail');
    writeStoredRightPanelView('home', storage);
    expect(readStoredRightPanelView(storage)).toBe('home');
  });
});
