import { describe, expect, it } from 'vitest';
import {
  readMobileAttentionPreferences,
  readMobileAttentionSwitches,
  writeMobileAttentionPreferences,
} from './mobile-attention-preferences.js';

class MemoryStorage {
  private readonly data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

describe('mobile attention preferences', () => {
  it('fills defaults for invalid JSON', () => {
    const storage = new MemoryStorage();
    storage.setItem('piwin.mobile.attention.v1', '{');
    const prefs = readMobileAttentionPreferences(storage);
    expect(prefs.onNeedsInput).toBe(true);
    expect(prefs.onComplete).toBe(true);
    expect(prefs.onFailure).toBe(true);
    expect(prefs.badge).toBe(false);
  });

  it('writes three switches and derives enabled', () => {
    const storage = new MemoryStorage();
    const prefs = writeMobileAttentionPreferences(
      { onNeedsInput: false, onComplete: false, onFailure: false },
      storage,
    );
    expect(prefs.enabled).toBe(false);
    expect(readMobileAttentionSwitches(storage)).toEqual({
      onNeedsInput: false,
      onComplete: false,
      onFailure: false,
    });
  });
});
