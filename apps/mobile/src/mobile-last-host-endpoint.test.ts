import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MOBILE_LAST_HOST_ENDPOINT_KEY,
  clearLastMobileHostEndpoint,
  readLastMobileHostEndpoint,
  writeLastMobileHostEndpoint,
} from './mobile-last-host-endpoint.js';
import { getDefaultHostEndpoint } from './mobile-host-connection.js';

class MemoryStorage {
  private readonly data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
}

describe('mobile last Host endpoint', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('round-trips the trimmed endpoint', () => {
    const storage = new MemoryStorage();
    writeLastMobileHostEndpoint('  ws://192.168.1.20:8787  ', storage);
    expect(readLastMobileHostEndpoint(storage)).toBe('ws://192.168.1.20:8787');
  });

  it('forgets the endpoint on clear', () => {
    const storage = new MemoryStorage();
    writeLastMobileHostEndpoint('wss://host.example:9443', storage);
    clearLastMobileHostEndpoint(storage);
    expect(readLastMobileHostEndpoint(storage)).toBeUndefined();
  });

  it('ignores stored values that are not WebSocket URLs', () => {
    const storage = new MemoryStorage();
    storage.setItem(MOBILE_LAST_HOST_ENDPOINT_KEY, 'http://192.168.1.20:8787');
    expect(readLastMobileHostEndpoint(storage)).toBeUndefined();
    storage.setItem(MOBILE_LAST_HOST_ENDPOINT_KEY, 'not a url');
    expect(readLastMobileHostEndpoint(storage)).toBeUndefined();
  });

  it('treats a throwing storage as empty', () => {
    const storage = {
      getItem: (): string | null => {
        throw new Error('blocked');
      },
    };
    expect(readLastMobileHostEndpoint(storage)).toBeUndefined();
  });

  it('makes a cold launch dial the remembered Host instead of loopback', () => {
    const storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
    expect(getDefaultHostEndpoint()).toBe('ws://127.0.0.1:8787');
    writeLastMobileHostEndpoint('ws://100.64.0.7:8787');
    expect(getDefaultHostEndpoint()).toBe('ws://100.64.0.7:8787');
    clearLastMobileHostEndpoint();
    expect(getDefaultHostEndpoint()).toBe('ws://127.0.0.1:8787');
  });
});
