import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostResponse } from '@piwin/contracts';
import { HostClient } from './host-client.js';

const invokeMock = vi.fn();
const listenMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: listenMock,
}));

type ListenerEvent = { payload: unknown };

function captureListeners(): Map<string, (event: ListenerEvent) => void> {
  const callbacks = new Map<string, (event: ListenerEvent) => void>();
  listenMock.mockImplementation(
    async (eventName: string, callback: (event: ListenerEvent) => void) => {
      callbacks.set(eventName, callback);
      return vi.fn();
    },
  );
  return callbacks;
}

function mockLiveInvokes(): void {
  invokeMock.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
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
    if (command === 'host_update_subscriptions') {
      return {
        type: 'subscriptions/applied',
        requestId: 'sub-1',
        revision: args?.revision ?? 0,
        fenceSeq: 7,
      };
    }
    throw new Error(`Unexpected Tauri command: ${command}`);
  });
}

function subscriptionInvokes(): Array<Record<string, unknown>> {
  return invokeMock.mock.calls
    .filter(([command]) => command === 'host_update_subscriptions')
    .map(([, args]) => args as Record<string, unknown>);
}

describe('HostClient.updateSubscriptions (live transport)', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    listenMock.mockReset();
  });

  it('sends client/subscriptions through the Rust bridge once the host is ready', async () => {
    captureListeners();
    mockLiveInvokes();
    const client = new HostClient({ transport: 'live' });

    // Before connect: desired set is held, state is awaiting-hello.
    await client.updateSubscriptions({ sessionIds: ['session-a'] });
    expect(client.getSubscriptionState()).toBe('awaiting-hello');
    expect(subscriptionInvokes()).toHaveLength(0);

    await client.connect();
    await vi.waitFor(() => {
      expect(subscriptionInvokes()).toHaveLength(1);
    });
    expect(subscriptionInvokes()[0]).toEqual({
      sessionIds: ['session-a'],
      jobIds: [],
      revision: 1,
      timeoutMs: 15_000,
    });
    await vi.waitFor(() => {
      expect(client.getSubscriptionState()).toBe('applied');
    });
  });

  it('sends only changed sets and bumps revision per send', async () => {
    captureListeners();
    mockLiveInvokes();
    const client = new HostClient({ transport: 'live' });
    await client.connect();

    await client.updateSubscriptions({ sessionIds: ['session-a'] });
    await client.updateSubscriptions({ sessionIds: ['session-a'] }); // no-op: same signature
    await client.updateSubscriptions({ sessionIds: ['session-b'] });

    expect(subscriptionInvokes()).toEqual([
      { sessionIds: ['session-a'], jobIds: [], revision: 1, timeoutMs: 15_000 },
      { sessionIds: ['session-b'], jobIds: [], revision: 2, timeoutMs: 15_000 },
    ]);
  });

  it('re-applies the last desired set after a sidecar restart reports ready', async () => {
    const callbacks = captureListeners();
    mockLiveInvokes();
    const client = new HostClient({ transport: 'live' });
    await client.connect();
    await client.updateSubscriptions({ sessionIds: ['session-a'] });
    expect(subscriptionInvokes()).toHaveLength(1);

    // Sidecar died → reconnecting; new host reports ready via push.
    callbacks.get('host-status')?.({ payload: { state: 'reconnecting' } });
    callbacks.get('host-message')?.({
      payload: { type: 'host/status', mode: 'sdk', ready: true, mock: false },
    });

    await vi.waitFor(() => {
      expect(subscriptionInvokes()).toHaveLength(2);
    });
    expect(subscriptionInvokes()[1]?.sessionIds).toEqual(['session-a']);
    expect(subscriptionInvokes()[1]?.revision).toBe(2);
  });

  it('mock transport keeps updateSubscriptions a no-op', async () => {
    const client = new HostClient({ transport: 'mock' });
    await expect(client.updateSubscriptions({ sessionIds: ['session-a'] })).resolves.toBeUndefined();
    expect(client.getSubscriptionState()).toBe('unsupported');
    expect(subscriptionInvokes()).toHaveLength(0);
  });
});
