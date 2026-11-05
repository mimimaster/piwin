import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  listSavedRemoteTargets,
  removeSavedRemoteTarget,
  saveSavedRemoteTarget,
} from './saved-remote-targets.js';

function createMockStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => map.delete(key),
    setItem: (key, value) => map.set(key, value),
  };
}

const ENDPOINT_A = 'ws://100.75.148.88:8788';
const ENDPOINT_B = 'ws://100.71.255.78:8788';

describe('saved remote targets', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createMockStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts empty', () => {
    expect(listSavedRemoteTargets()).toEqual([]);
  });

  it('saves and upserts by endpoint, newest first', () => {
    saveSavedRemoteTarget({ endpoint: ENDPOINT_A });
    saveSavedRemoteTarget({ endpoint: ENDPOINT_B });
    saveSavedRemoteTarget({ endpoint: ENDPOINT_A, hostInstanceId: 'instance-1' });

    const listed = listSavedRemoteTargets();
    expect(listed).toHaveLength(2);
    expect(listed[0]?.endpoint).toBe(ENDPOINT_A);
    expect(listed[0]?.hostInstanceId).toBe('instance-1');
    expect(listed[1]?.endpoint).toBe(ENDPOINT_B);
  });

  it('persists across reads (localStorage backed)', () => {
    saveSavedRemoteTarget({ endpoint: ENDPOINT_A });
    const secondView = JSON.parse(
      globalThis.localStorage.getItem('piwin.desktop.saved-remote-targets') ?? '[]',
    ) as unknown[];
    expect(secondView).toHaveLength(1);
  });

  it('drops invalid endpoints and keeps the list untouched', () => {
    saveSavedRemoteTarget({ endpoint: ENDPOINT_A });
    saveSavedRemoteTarget({ endpoint: 'not-a-websocket-url' });
    expect(listSavedRemoteTargets()).toHaveLength(1);
  });

  it('removes by endpoint', () => {
    saveSavedRemoteTarget({ endpoint: ENDPOINT_A });
    saveSavedRemoteTarget({ endpoint: ENDPOINT_B });
    removeSavedRemoteTarget(ENDPOINT_A);
    const listed = listSavedRemoteTargets();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.endpoint).toBe(ENDPOINT_B);
  });

  it('tolerates damaged storage content', () => {
    globalThis.localStorage.setItem('piwin.desktop.saved-remote-targets', '{not json');
    expect(listSavedRemoteTargets()).toEqual([]);
  });
});
