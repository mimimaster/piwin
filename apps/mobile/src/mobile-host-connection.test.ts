import { describe, expect, it } from 'vitest';
import {
  formatMobileHostConnectionError,
  normalizeMobileHostEndpoint,
} from './mobile-host-connection.js';

describe('mobile Host connection diagnostics', () => {
  it('accepts and trims WebSocket endpoints', () => {
    expect(normalizeMobileHostEndpoint('  ws://192.168.1.100:8787  ')).toBe(
      'ws://192.168.1.100:8787',
    );
    expect(normalizeMobileHostEndpoint('wss://host.example:9443')).toBe('wss://host.example:9443');
  });

  it('rejects endpoints without a WebSocket scheme', () => {
    expect(() => normalizeMobileHostEndpoint('192.168.1.100:8787')).toThrow('ws:// 或 wss://');
  });

  it('explains pairing failures instead of exposing transport jargon', () => {
    expect(
      formatMobileHostConnectionError(
        new Error('Host rejected the connection (4004): Authentication failed'),
      ),
    ).toContain('配对码');
  });

  it('explains the packaged WebView transport failure', () => {
    expect(formatMobileHostConnectionError(new Error('The operation is insecure'))).toContain(
      '原生通信通道',
    );
  });

  it('explains a dial timeout with network checks', () => {
    expect(
      formatMobileHostConnectionError(
        new Error('Native Host WebSocket connect timed out after 15000ms'),
      ),
    ).toContain('无法连通 Host');
  });
});
