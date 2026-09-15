import { describe, expect, it } from 'vitest';
import { isDockingWorkspaceEnabled, setDockingWorkspaceEnabled } from './flag.js';

class MemoryStorage {
  private readonly data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

describe('docking feature flag', () => {
  it('defaults to enabled and honors explicit off', () => {
    const storage = new MemoryStorage();
    expect(isDockingWorkspaceEnabled(storage)).toBe(true);
    setDockingWorkspaceEnabled(false, storage);
    expect(isDockingWorkspaceEnabled(storage)).toBe(false);
    setDockingWorkspaceEnabled(true, storage);
    expect(isDockingWorkspaceEnabled(storage)).toBe(true);
  });
});
