import { afterEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({ native: vi.fn(() => ({ kind: 'native' })) }));

vi.mock('@piwin/host-transport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@piwin/host-transport')>()),
  createNativeRelayInnerSocket: fakes.native,
}));

import { channelInnerSocketFactory } from './channel-host-book';

class FakeBrowserSocket {
  public constructor(public readonly url: string) {}
}

describe('channelInnerSocketFactory', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('dials a TLS relay with the WebView socket even inside a Tauri shell', () => {
    vi.stubGlobal('WebSocket', FakeBrowserSocket);
    const socket = channelInnerSocketFactory(true)('wss://relay.example.com:8443/v1/u/a/connect');
    expect(socket).toBeInstanceOf(FakeBrowserSocket);
    expect(fakes.native).not.toHaveBeenCalled();
  });

  it('keeps the native plugin for cleartext LAN addresses', () => {
    vi.stubGlobal('WebSocket', FakeBrowserSocket);
    const socket = channelInnerSocketFactory(true)('ws://192.168.1.20:8790/v1/u/a/connect');
    expect(socket).toEqual({ kind: 'native' });
  });

  it('always uses the browser socket outside Tauri', () => {
    vi.stubGlobal('WebSocket', FakeBrowserSocket);
    const socket = channelInnerSocketFactory(false)('ws://192.168.1.20:8790/v1/u/a/connect');
    expect(socket).toBeInstanceOf(FakeBrowserSocket);
  });
});
