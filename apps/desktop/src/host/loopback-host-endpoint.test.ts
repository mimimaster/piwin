import { describe, expect, it } from 'vitest';
import { isLoopbackHostEndpoint } from './loopback-host-endpoint.js';

describe('isLoopbackHostEndpoint', () => {
  it('accepts local Host WebSockets', () => {
    expect(isLoopbackHostEndpoint('ws://127.0.0.1:8787')).toBe(true);
    expect(isLoopbackHostEndpoint('ws://localhost:8787')).toBe(true);
  });

  it('rejects remote Hosts and junk', () => {
    expect(isLoopbackHostEndpoint('wss://mac.tailnet.ts.net:8787')).toBe(false);
    expect(isLoopbackHostEndpoint('not a url')).toBe(false);
    expect(isLoopbackHostEndpoint(undefined)).toBe(false);
  });
});
