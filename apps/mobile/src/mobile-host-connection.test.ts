import { REMOTE_CHANNEL_CLOSE } from '@piwin/contracts';
import {
  HostHandshakeError,
  HostSocketClosedError,
  RELAY_SECURE_SOCKET_CLOSE,
} from '@piwin/host-transport';
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

  it('explains a Host that is offline or not behind the relay', () => {
    expect(
      formatMobileHostConnectionError(
        new HostSocketClosedError('closed', REMOTE_CHANNEL_CLOSE.unavailable),
      ),
    ).toContain('当前离线或未连入中继服务器');
  });

  it('explains a channel Host key mismatch as a re-pair', () => {
    expect(
      formatMobileHostConnectionError(
        new HostSocketClosedError('closed', RELAY_SECURE_SOCKET_CLOSE.handshakeFailed),
      ),
    ).toContain('密钥校验不匹配');
  });

  it('explains relay rate limiting and refusal', () => {
    expect(
      formatMobileHostConnectionError(
        new HostSocketClosedError('closed', REMOTE_CHANNEL_CLOSE.limited),
      ),
    ).toContain('受限或请求过于频繁');
    expect(
      formatMobileHostConnectionError(
        new HostSocketClosedError('closed', REMOTE_CHANNEL_CLOSE.forbidden),
      ),
    ).toContain('中继服务器拒绝');
  });

  it('keeps a Host-supplied hello reject reason on the existing path', () => {
    // classifyChannelFailure defers to the Host's own reason; the message
    // formatting below must keep handling it.
    expect(
      formatMobileHostConnectionError(
        new HostHandshakeError(
          'Host rejected the connection (4004): Authentication failed',
          REMOTE_CHANNEL_CLOSE.unavailable,
          'authentication-failed',
        ),
      ),
    ).toContain('配对码');
  });
});
