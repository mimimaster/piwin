import { describe, expect, it } from 'vitest';
import {
  readStoredRightPanelState,
  writeStoredRightPanelState,
  readStoredRightPanelView,
  writeStoredRightPanelView,
  RIGHT_PANEL_STATE_STORAGE_KEY,
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

describe('right-panel-memory multi-tab', () => {
  it('defaults to empty open tabs', () => {
    expect(readStoredRightPanelState(memoryStorage())).toEqual({
      openTabs: [],
      activeTab: null,
    });
    expect(readStoredRightPanelState(null)).toEqual({ openTabs: [], activeTab: null });
  });

  it('round-trips open tabs', () => {
    const storage = memoryStorage();
    writeStoredRightPanelState({ openTabs: ['terminal', 'files'], activeTab: 'files' }, storage);
    expect(JSON.parse(storage.getItem(RIGHT_PANEL_STATE_STORAGE_KEY) ?? '{}')).toEqual({
      openTabs: ['terminal', 'files'],
      activeTab: 'files',
    });
    expect(readStoredRightPanelState(storage)).toEqual({
      openTabs: ['terminal', 'files'],
      activeTab: 'files',
    });
  });

  it('migrates legacy detail view to empty home', () => {
    const storage = memoryStorage({ [RIGHT_PANEL_VIEW_STORAGE_KEY]: 'detail' });
    expect(readStoredRightPanelState(storage)).toEqual({
      openTabs: [],
      activeTab: null,
    });
  });

  it('legacy view helpers map empty/open', () => {
    expect(readStoredRightPanelView(memoryStorage())).toBe('home');
    const storage = memoryStorage();
    writeStoredRightPanelView('detail', storage);
    expect(readStoredRightPanelView(storage)).toBe('detail');
    writeStoredRightPanelView('home', storage);
    expect(readStoredRightPanelView(storage)).toBe('home');
  });
});
