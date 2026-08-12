import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostPushBatchFrame, HostResponse, HostServerMessage } from '@piwin/contracts';
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

  it('does not impose an acknowledgement timeout on model-backed compaction', async () => {
    const compactResponse: HostResponse = {
      id: 'ui-1',
      type: 'response',
      command: 'session/compact',
      success: true,
      data: { ok: true },
    };
    invokeMock.mockResolvedValue(compactResponse);
    const client = new HostClient({ transport: 'live' });

    const response = await client.request({
      type: 'session/compact',
      sessionId: 'session-1',
    });

    expect(response).toEqual(compactResponse);
    expect(invokeMock).toHaveBeenCalledWith('host_request', {
      command: {
        id: 'ui-1',
        type: 'session/compact',
        sessionId: 'session-1',
      },
      timeoutMs: 0,
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

    // One connection installs host-message + host-message-batch + host-log +
    // host-status listeners.
    expect(listenMock).toHaveBeenCalledTimes(4);
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it('applies a local push batch once and advances its cursor after delivery', async () => {
    const callbacks = new Map<string, (event: { payload: unknown }) => void>();
    const unlisten = vi.fn();
    listenMock.mockImplementation(
      async (eventName: string, callback: (event: { payload: unknown }) => void) => {
        callbacks.set(eventName, callback);
        return unlisten;
      },
    );
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
    const pushes: HostServerMessage[] = [];
    client.subscribe((message) => pushes.push(message));
    await client.connect();

    const batch: HostPushBatchFrame = {
      type: 'push/batch',
      hostInstanceId: 'host-test',
      afterSeq: 0,
      throughSeq: 2,
      items: [
        {
          seq: 1,
          eventId: 'event-1',
          push: { type: 'host/status', mode: 'sdk', ready: false, mock: false },
        },
        {
          seq: 2,
          eventId: 'event-2',
          push: {
            type: 'session/name-updated',
            sessionId: 'session-1',
            name: 'Demo',
            nameSource: 'text',
          },
        },
      ],
    };
    callbacks.get('host-message-batch')?.({ payload: batch });
    callbacks.get('host-message-batch')?.({ payload: batch });

    expect(pushes.filter((message) => message.type === 'session/name-updated')).toHaveLength(1);
    expect(pushes.filter((message) => message.type === 'host/status')).toHaveLength(2);
    expect(client.isReady()).toBe(false);
  });
});
