import { describe, expect, it } from 'vitest';
import { BrowserUnavailableError } from './browser-errors.js';
import { assertLoopbackCdpEndpoint } from './browser-cdp.js';

describe('assertLoopbackCdpEndpoint', () => {
  it('accepts loopback http and ws URLs', () => {
    expect(assertLoopbackCdpEndpoint('http://127.0.0.1:9222')).toBe('http://127.0.0.1:9222');
    expect(assertLoopbackCdpEndpoint(' http://localhost:9222/ ')).toBe('http://localhost:9222/');
    expect(assertLoopbackCdpEndpoint('ws://[::1]:9222')).toBe('ws://[::1]:9222');
  });

  it('rejects empty, non-URL, and non-loopback endpoints', () => {
    expect(() => assertLoopbackCdpEndpoint('')).toThrow(BrowserUnavailableError);
    expect(() => assertLoopbackCdpEndpoint('not-a-url')).toThrow(BrowserUnavailableError);
    expect(() => assertLoopbackCdpEndpoint('http://192.168.1.4:9222')).toThrow(
      /loopback/,
    );
    expect(() => assertLoopbackCdpEndpoint('http://example.com:9222')).toThrow(/loopback/);
    expect(() => assertLoopbackCdpEndpoint('file:///tmp/cdp')).toThrow(/http\(s\) or ws\(s\)/);
  });
});
