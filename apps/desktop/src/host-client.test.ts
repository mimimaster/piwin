import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostPushBatchFrame, HostResponse, HostServerMessage } from '@piwin/contracts';
import { HostClient, mergeRemoteCapabilities } from './host-client';

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

    const response = await client.request(
      {
        type: 'session/abort',
        sessionId: 'session-1',
        runId: 'run-1',
      },
      { idempotencyKey: 'gesture-abort-1' },
    );

    expect(response).toEqual(unhandledResponse);
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith('host_request', {
      command: {
        v: 1,
        command: {
          id: 'ui-1',
          type: 'session/abort',
          sessionId: 'session-1',
          runId: 'run-1',
        },
        idempotencyKey: 'gesture-abort-1',
        clientPrincipalId: expect.any(String),
      },
      timeoutMs: 5_000,
    });
  });

  it('does not mint an idempotency key when the live caller omits one', async () => {
    const client = new HostClient({ transport: 'live' });
    const response = await client.request({
      type: 'session/abort',
      sessionId: 'session-1',
      runId: 'run-1',
    });
    expect(response).toMatchObject({
      success: false,
      error: 'idempotency-key-required',
      problem: { code: 'idempotency-key-required' },
    });
    expect(invokeMock).not.toHaveBeenCalled();
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
        v: 1,
        command: {
          id: 'ui-1',
          type: 'session/compact',
          sessionId: 'session-1',
        },
        clientPrincipalId: expect.any(String),
      },
      timeoutMs: 0,
    });
  });

  it('uses an operation timeout of at least 20s for flashcards/explain-selection', async () => {
    const explainResponse: HostResponse = {
      id: 'ui-1',
      type: 'response',
      command: 'flashcards/explain-selection',
      success: true,
      data: {
        explanationId: 'e1',
        itemId: 'c1',
        selectedText: '光合',
        intent: 'hint',
        markdown: 'tip',
      },
    };
    invokeMock.mockResolvedValue(explainResponse);
    const client = new HostClient({ transport: 'live' });
    await client.request({
      type: 'flashcards/explain-selection',
      input: {
        explanationId: 'e1',
        itemId: 'c1',
        face: 'front',
        selectedText: '光合',
        intent: 'hint',
        locale: 'zh-CN',
      },
    });
    expect(invokeMock).toHaveBeenCalledWith(
      'host_request',
      expect.objectContaining({ timeoutMs: expect.any(Number) }),
    );
    const arg = invokeMock.mock.calls[0]?.[1] as { timeoutMs: number };
    expect(arg.timeoutMs).toBeGreaterThanOrEqual(20_000);
  });

  it('keeps flashcards/cancel-explanation on the short query timeout', async () => {
    invokeMock.mockResolvedValue({
      id: 'ui-1',
      type: 'response',
      command: 'flashcards/cancel-explanation',
      success: true,
      data: { cancelled: true },
    } satisfies HostResponse);
    const client = new HostClient({ transport: 'live' });
    await client.request({
      type: 'flashcards/cancel-explanation',
      explanationId: 'e1',
    });
    const arg = invokeMock.mock.calls[0]?.[1] as { timeoutMs: number };
    expect(arg.timeoutMs).toBe(15_000);
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

  it('reports a push sequence gap and still applies the closing batch', async () => {
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
    const gaps: unknown[] = [];
    client.registerSequenceGapHandler((gap) => gaps.push(gap));
    await client.connect();

    const firstBatch: HostPushBatchFrame = {
      type: 'push/batch',
      hostInstanceId: 'host-test',
      afterSeq: 0,
      throughSeq: 2,
      items: [
        {
          seq: 1,
          eventId: 'event-1',
          push: { type: 'host/status', mode: 'sdk', ready: true, mock: false },
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
    callbacks.get('host-message-batch')?.({ payload: firstBatch });

    // Frames 3–5 are lost in transit; the next batch jumps past them.
    const closingBatch: HostPushBatchFrame = {
      type: 'push/batch',
      hostInstanceId: 'host-test',
      afterSeq: 5,
      throughSeq: 6,
      items: [
        {
          seq: 6,
          eventId: 'event-6',
          push: {
            type: 'session/name-updated',
            sessionId: 'session-1',
            name: 'Renamed',
            nameSource: 'text',
          },
        },
      ],
    };
    callbacks.get('host-message-batch')?.({ payload: closingBatch });

    expect(gaps).toEqual([
      {
        hostInstanceId: 'host-test',
        missedFromSeq: 3,
        receivedFromSeq: 6,
      },
    ]);

    // The cursor closed over the hole: a following contiguous batch reports
    // no second gap.
    const nextBatch: HostPushBatchFrame = {
      type: 'push/batch',
      hostInstanceId: 'host-test',
      afterSeq: 6,
      throughSeq: 7,
      items: [
        {
          seq: 7,
          eventId: 'event-7',
          push: {
            type: 'session/name-updated',
            sessionId: 'session-1',
            name: 'Again',
            nameSource: 'text',
          },
        },
      ],
    };
    callbacks.get('host-message-batch')?.({ payload: nextBatch });
    expect(gaps).toHaveLength(1);
  });

  it('adopts replay/done currentSeq so a filtered tail does not look like a live gap', async () => {
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
    const gaps: unknown[] = [];
    const pushes: HostServerMessage[] = [];
    client.registerSequenceGapHandler((gap) => gaps.push(gap));
    client.subscribe((message) => pushes.push(message));
    await client.connect();

    callbacks.get('host-message-batch')?.({
      payload: {
        type: 'push/batch',
        hostInstanceId: 'host-test',
        afterSeq: 0,
        throughSeq: 3,
        items: [
          {
            seq: 1,
            eventId: 'event-1',
            push: { type: 'host/log', level: 'info', message: 'one' },
          },
          {
            seq: 3,
            eventId: 'event-3',
            push: { type: 'host/log', level: 'info', message: 'three' },
          },
        ],
      },
    });
    callbacks.get('host-message')?.({
      payload: {
        type: 'replay/done',
        requestId: 'hello-replay-filtered',
        fromSeq: 1,
        toSeq: 3,
        currentSeq: 5,
        complete: true,
      },
    });
    callbacks.get('host-message-batch')?.({
      payload: {
        type: 'push/batch',
        hostInstanceId: 'host-test',
        afterSeq: 5,
        throughSeq: 7,
        items: [
          {
            seq: 7,
            eventId: 'event-7',
            push: { type: 'host/log', level: 'info', message: 'seven' },
          },
        ],
      },
    });

    expect(gaps).toEqual([]);
    expect(
      pushes
        .filter((message) => message.type === 'host/log')
        .map((message) => (message.type === 'host/log' ? message.message : '')),
    ).toEqual(['one', 'three', 'seven']);
  });

  it('does not invoke the JSONL sidecar when transport is remote', async () => {
    const client = new HostClient({
      transport: 'remote',
      remoteTarget: { endpoint: 'ws://127.0.0.1:8787' },
    });
    expect(client.getTransport()).toBe('remote');
    expect(client.getRemoteTarget()).toEqual({ endpoint: 'ws://127.0.0.1:8787' });
    expect(client.supportsForegroundAdmission()).toBe(false);
    const response = await client.request({ type: 'host/ping' });
    expect(response.success).toBe(false);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('drops a previous remote command ceiling when the Host hello omits one', () => {
    const previous = {
      allowedCommands: ['host/ping'] as const,
      pushSequencing: true,
      replay: true,
      snapshot: true,
      sessionRead: true,
      sessionControl: true,
      permissionResolve: true,
      mediaUpload: false,
    };
    const next = {
      pushSequencing: true,
      replay: true,
      snapshot: true,
      sessionRead: true,
      sessionControl: true,
      permissionResolve: true,
      mediaUpload: true,
    };
    expect(mergeRemoteCapabilities(previous, next).allowedCommands).toBeUndefined();
  });

  it('does not send remote commands the Host did not advertise', async () => {
    const remote = new HostClient({
      transport: 'remote',
      remoteTarget: { endpoint: 'ws://127.0.0.1:8787' },
    });
    (remote as unknown as { remoteCapabilities: { allowedCommands: ['host/ping'] } }).remoteCapabilities =
      { allowedCommands: ['host/ping'] };
    const denied = await remote.request({ type: 'theme/get-active' });
    expect(denied).toMatchObject({
      success: false,
      command: 'theme/get-active',
      error: 'This Host does not expose theme/get-active to remote clients',
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('refuses mobile-access commands unless the live sidecar is attached', async () => {
    const remote = new HostClient({
      transport: 'remote',
      remoteTarget: { endpoint: 'ws://127.0.0.1:8787' },
    });
    const denied = await remote.request({ type: 'mobile-access/status' });
    expect(denied).toMatchObject({
      success: false,
      command: 'mobile-access/status',
      error: 'Phone access is only available on this Mac’s sidecar',
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
