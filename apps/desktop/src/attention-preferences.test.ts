import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_ATTENTION_PREFERENCES } from '@piwin/host-client';
import {
  ATTENTION_PREFERENCES_KEY,
  readAttentionPreferences,
  subscribeAttentionPreferences,
  writeAttentionPreferences,
} from './attention-preferences';

class MemoryStorage {
  private readonly data = new Map<string, string>();

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

describe('AN-T45 attention preferences', () => {
  const unsubscribers: Array<() => void> = [];

  afterEach(() => {
    while (unsubscribers.length > 0) {
      unsubscribers.pop()?.();
    }
  });

  it('round-trips a full preference object', () => {
    const storage = new MemoryStorage();
    const next = {
      ...DEFAULT_ATTENTION_PREFERENCES,
      enabled: false,
      sound: false,
      badge: false,
    };
    writeAttentionPreferences(next, storage);
    expect(JSON.parse(storage.getItem(ATTENTION_PREFERENCES_KEY) ?? '')).toEqual(next);
    expect(readAttentionPreferences(storage)).toEqual(next);
  });

  it('returns defaults for missing and invalid JSON', () => {
    const storage = new MemoryStorage();
    expect(readAttentionPreferences(storage)).toEqual(DEFAULT_ATTENTION_PREFERENCES);

    storage.setItem(ATTENTION_PREFERENCES_KEY, '{not json');
    expect(readAttentionPreferences(storage)).toEqual(DEFAULT_ATTENTION_PREFERENCES);

    storage.setItem(ATTENTION_PREFERENCES_KEY, 'null');
    expect(readAttentionPreferences(storage)).toEqual(DEFAULT_ATTENTION_PREFERENCES);

    storage.setItem(ATTENTION_PREFERENCES_KEY, '[]');
    expect(readAttentionPreferences(storage)).toEqual(DEFAULT_ATTENTION_PREFERENCES);

    storage.setItem(ATTENTION_PREFERENCES_KEY, '"nope"');
    expect(readAttentionPreferences(storage)).toEqual(DEFAULT_ATTENTION_PREFERENCES);
  });

  it('fills missing fields from defaults without dropping known booleans', () => {
    const storage = new MemoryStorage();
    storage.setItem(
      ATTENTION_PREFERENCES_KEY,
      JSON.stringify({ enabled: false, onComplete: false, unknownFuture: true }),
    );
    expect(readAttentionPreferences(storage)).toEqual({
      ...DEFAULT_ATTENTION_PREFERENCES,
      enabled: false,
      onComplete: false,
    });
  });

  it('ignores non-boolean stored fields', () => {
    const storage = new MemoryStorage();
    storage.setItem(
      ATTENTION_PREFERENCES_KEY,
      JSON.stringify({ enabled: 'false', onNeedsInput: 1, badge: false }),
    );
    expect(readAttentionPreferences(storage)).toEqual({
      ...DEFAULT_ATTENTION_PREFERENCES,
      badge: false,
    });
  });

  it('notifies in-process subscribers and honors unsubscribe', () => {
    const storage = new MemoryStorage();
    const seen: boolean[] = [];
    const extra: boolean[] = [];
    unsubscribers.push(
      subscribeAttentionPreferences((next) => {
        seen.push(next.enabled);
      }),
    );
    const stopExtra = subscribeAttentionPreferences((next) => {
      extra.push(next.sound);
    });
    writeAttentionPreferences({ ...DEFAULT_ATTENTION_PREFERENCES, enabled: false }, storage);
    stopExtra();
    writeAttentionPreferences({ ...DEFAULT_ATTENTION_PREFERENCES, sound: false }, storage);
    expect(seen).toEqual([false, true]);
    expect(extra).toEqual([true]);
  });

  it('uses window.localStorage when storage is omitted', () => {
    const data = new Map<string, string>();
    const localStorage = {
      getItem(key: string): string | null {
        return data.get(key) ?? null;
      },
      setItem(key: string, value: string): void {
        data.set(key, value);
      },
    };
    const previousWindow = globalThis.window;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { localStorage },
    });
    try {
      writeAttentionPreferences({ ...DEFAULT_ATTENTION_PREFERENCES, badge: false });
      expect(readAttentionPreferences()).toEqual({
        ...DEFAULT_ATTENTION_PREFERENCES,
        badge: false,
      });
    } finally {
      if (previousWindow === undefined) {
        Reflect.deleteProperty(globalThis, 'window');
      } else {
        Object.defineProperty(globalThis, 'window', {
          configurable: true,
          value: previousWindow,
        });
      }
    }
  });
});
