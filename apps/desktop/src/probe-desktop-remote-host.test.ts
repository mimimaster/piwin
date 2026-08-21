import { afterEach, describe, expect, it, vi } from 'vitest';
import { probeDesktopRemoteHost } from './probe-desktop-remote-host.js';
import {
  registerLiveDesktopRemoteHost,
  type DesktopRemoteHostClientOptions,
} from './remote-host-session.js';

const created: DesktopRemoteHostClientOptions[] = [];

vi.mock('./remote-host-session.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./remote-host-session.js')>();
  return {
    ...actual,
    createDesktopRemoteHostClient: vi.fn(
      (_target: unknown, options?: DesktopRemoteHostClientOptions) => {
        created.push(options ?? {});
        return {
          connect: async () => ({
            type: 'host/hello',
            protocolVersion: 1,
            hostInstanceId: 'probed',
            currentSeq: 0,
            authRequired: false,
            authenticated: true,
            capabilities: {},
          }),
          request: async () => ({
            type: 'response',
            command: 'host/status',
            success: true,
            data: { hostInstanceId: 'probed' },
          }),
          close: async () => undefined,
          getHostHello: () => ({ hostInstanceId: 'probed' }),
        };
      },
    ),
  };
});

describe('probeDesktopRemoteHost', () => {
  afterEach(() => {
    created.length = 0;
  });

  it('reuses the live workbench socket when the target already matches', async () => {
    const requestStatus = vi.fn(async () => ({ ok: true as const, hostInstanceId: 'live-1' }));
    const unregister = registerLiveDesktopRemoteHost({
      target: { endpoint: 'ws://127.0.0.1:8787' },
      isReady: () => true,
      requestStatus,
    });
    const result = await probeDesktopRemoteHost({
      endpoint: 'ws://127.0.0.1:8787',
      invalidEndpointMessage: 'bad',
    });
    unregister();
    expect(result).toEqual({
      ok: true,
      target: { endpoint: 'ws://127.0.0.1:8787' },
      hostInstanceId: 'live-1',
    });
    expect(requestStatus).toHaveBeenCalledTimes(1);
    expect(created).toHaveLength(0);
  });

  it('opens a one-shot probe id when the live socket is down', async () => {
    const unregister = registerLiveDesktopRemoteHost({
      target: { endpoint: 'ws://127.0.0.1:8787' },
      isReady: () => false,
      requestStatus: async () => ({ ok: false, error: 'offline' }),
    });
    const result = await probeDesktopRemoteHost({
      endpoint: 'ws://127.0.0.1:8787',
      invalidEndpointMessage: 'bad',
    });
    unregister();
    expect(result).toMatchObject({ ok: true, hostInstanceId: 'probed' });
    expect(created).toHaveLength(1);
    expect(created[0]?.autoReconnect).toBe(false);
    expect(created[0]?.clientId?.startsWith('desktop-probe-')).toBe(true);
  });
});
