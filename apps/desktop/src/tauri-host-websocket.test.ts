import { describe, expect, it, vi } from 'vitest';
import { createTauriHostWebSocket, type TauriHostWebSocketConnect } from './tauri-host-websocket.js';

type PluginMessage =
  | { type: 'Text'; data: string }
  | { type: 'Binary'; data: number[] }
  | { type: 'Close'; data: { code: number; reason: string } | null };

function mockSocket() {
  const listeners = new Set<(message: PluginMessage) => void>();
  return {
    addListener: (listener: (message: PluginMessage) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    send: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    emit(message: PluginMessage) {
      for (const listener of listeners) {
        listener(message);
      }
    },
  };
}

function waitForOpen(socket: ReturnType<typeof createTauriHostWebSocket>): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.onopen = () => resolve();
    socket.onerror = (error) => reject(error);
  });
}

describe('createTauriHostWebSocket', () => {
  it('opens and forwards text frames', async () => {
    const inner = mockSocket();
    const connect: TauriHostWebSocketConnect = async () => inner;
    const socket = createTauriHostWebSocket('ws://127.0.0.1:8787', connect);
    const messages: unknown[] = [];
    socket.onmessage = (event) => {
      messages.push(event.data);
    };
    await waitForOpen(socket);
    expect(socket.readyState).toBe(1);
    inner.emit({ type: 'Text', data: '{"type":"host/hello"}' });
    expect(messages).toEqual(['{"type":"host/hello"}']);
    socket.send('hello');
    expect(inner.send).toHaveBeenCalledWith('hello');
  });

  it('reports connect failure without using the browser WebSocket', async () => {
    const connect: TauriHostWebSocketConnect = async () => {
      throw new Error('plugin connect failed');
    };
    const socket = createTauriHostWebSocket('ws://127.0.0.1:8787', connect);
    const closed = await new Promise<{ code: number; reason: string }>((resolve) => {
      socket.onclose = resolve;
    });
    expect(closed).toEqual({ code: 1006, reason: 'plugin connect failed' });
    expect(socket.readyState).toBe(3);
  });

  it('closes an in-flight connect before onopen', async () => {
    let resolveConnect: ((socket: ReturnType<typeof mockSocket>) => void) | undefined;
    const connect: TauriHostWebSocketConnect = () =>
      new Promise((resolve) => {
        resolveConnect = resolve;
      });
    const socket = createTauriHostWebSocket('ws://127.0.0.1:8787', connect);
    const opened = vi.fn();
    socket.onopen = opened;
    const closed = new Promise<{ code: number; reason: string }>((resolve) => {
      socket.onclose = resolve;
    });
    socket.close(1000, 'probe done');
    await expect(closed).resolves.toEqual({ code: 1000, reason: 'probe done' });
    const inner = mockSocket();
    resolveConnect?.(inner);
    await vi.waitFor(() => {
      expect(inner.disconnect).toHaveBeenCalled();
    });
    expect(opened).not.toHaveBeenCalled();
  });

  it('does not open a second socket until the first has disconnected', async () => {
    let releaseFirstDisconnect: (() => void) | undefined;
    const firstDisconnect = new Promise<void>((resolve) => {
      releaseFirstDisconnect = resolve;
    });
    const events: string[] = [];
    const connect: TauriHostWebSocketConnect = async (endpoint) => {
      events.push(`connect ${endpoint}`);
      return {
        addListener: () => () => undefined,
        send: async () => undefined,
        disconnect: async () => {
          events.push(`disconnect-wait ${endpoint}`);
          if (endpoint.includes(':8787')) {
            await firstDisconnect;
          }
          events.push(`disconnect-done ${endpoint}`);
        },
      };
    };

    const first = createTauriHostWebSocket('ws://127.0.0.1:8787', connect);
    await waitForOpen(first);
    first.close();
    const secondOpened = waitForOpen(createTauriHostWebSocket('ws://127.0.0.1:8790', connect));
    await vi.waitFor(() => {
      expect(events).toContain('disconnect-wait ws://127.0.0.1:8787');
    });
    expect(events.some((event) => event.includes('8790'))).toBe(false);
    releaseFirstDisconnect?.();
    await secondOpened;
    expect(events).toEqual([
      'connect ws://127.0.0.1:8787',
      'disconnect-wait ws://127.0.0.1:8787',
      'disconnect-done ws://127.0.0.1:8787',
      'connect ws://127.0.0.1:8790',
    ]);
  });
});
