import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostResponse } from '@piwin/contracts';
import { HostClient } from './host-client';

const invokeMock = vi.fn();
const listenMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: listenMock,
}));

describe('HostClient', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    listenMock.mockReset();
  });

  it('returns an unhandled-command error without restarting or retrying', async () => {
    const unhandledResponse: HostResponse = {
      id: 'ui-1',
      type: 'response',
      command: 'session/abort',
      success: false,
      error: 'Unhandled command',
    };
    invokeMock.mockResolvedValue(unhandledResponse);
    const client = new HostClient({ transport: 'live' });

    const response = await client.request({
      type: 'session/abort',
      sessionId: 'session-1',
      runId: 'run-1',
    });

    expect(response).toEqual(unhandledResponse);
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith('host_request', {
      command: {
        id: 'ui-1',
        type: 'session/abort',
        sessionId: 'session-1',
        runId: 'run-1',
      },
      timeoutMs: 5_000,
    });
  });

  it('shares concurrent live connect calls so host events have one listener each', async () => {
    const unlisten = vi.fn();
    listenMock.mockResolvedValue(unlisten);
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'host_start') {
        return { started: true };
      }
      if (command === 'host_request') {
        return {
          id: 'ui-1',
          type: 'response',
          command: 'host/status',
          success: true,
          data: { mode: 'sdk', ready: true, mock: false },
        } satisfies HostResponse;
      }
      throw new Error(`Unexpected Tauri command: ${command}`);
    });

    const client = new HostClient({ transport: 'live' });
    await Promise.all([client.connect(), client.connect()]);

    // One connection installs host-message + host-log + host-status listeners.
    expect(listenMock).toHaveBeenCalledTimes(3);
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });
});
