import { describe, expect, it, vi } from 'vitest';
import type { HostCommand, HostServerMessage } from '@piwin/contracts';
import type { HostClient } from '../host/host-client';
import {
  requestBrowserBack,
  requestBrowserNewTab,
  requestBrowserDialog,
} from '../host/host-client-browser';
import { createBrowserSessionClient } from './browser-session-client';

describe('conversation browser client', () => {
  it('binds lease, navigation, input, capture, chrome, and cleanup to the same conversation', async () => {
    const request = vi.fn(async (_command: HostCommand) => ({ success: true }));
    const client = createBrowserSessionClient({ request } as unknown as HostClient, 'session-a');
    await client.browserStart('mirror-a');
    await client.browserNavigate('https://a.example');
    await client.browserInput([{ type: 'insertText', text: 'hello' }]);
    await client.browserPickAt(2, 3);
    await client.browserResize(800, 600, { mode: 'follow', leaseId: 'mirror-a' });
    await client.browserCapture({ sessionId: 'cannot-retarget' });
    await client.browserReload();
    await client.browserRestart();
    await requestBrowserBack(client);
    await requestBrowserNewTab(client, 'https://tab.example');
    await requestBrowserDialog(client, 'dismiss');
    await client.browserStop('mirror-a');
    expect(request).toHaveBeenCalledTimes(12);
    for (const call of request.mock.calls)
      expect(call[0]).toMatchObject({ sessionId: 'session-a' });
  });

  it('drops foreign and legacy pushes while preserving Host status', () => {
    let emit: ((message: HostServerMessage) => void) | undefined;
    const unsubscribe = vi.fn();
    const host = {
      subscribe: (listener: typeof emit) => {
        emit = listener;
        return unsubscribe;
      },
    };
    const client = createBrowserSessionClient(host as unknown as HostClient, 'session-a');
    const received = vi.fn();
    const stop = client.subscribe(received);
    emit?.({ type: 'browser/state', sessionId: 'session-b', url: 'https://b.example', ts: 0 });
    emit?.({ type: 'browser/controller', owner: 'agent', ts: 0 });
    expect(received).not.toHaveBeenCalled();
    emit?.({ type: 'browser/state', sessionId: 'session-a', url: 'https://a.example', ts: 0 });
    emit?.({ type: 'host/log', level: 'info', message: 'connected' });
    expect(received).toHaveBeenCalledTimes(2);
    stop();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
