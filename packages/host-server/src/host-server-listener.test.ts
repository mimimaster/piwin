import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { startHostListener, stopHostListener, type HostListener } from './host-server-listener.js';

const USER_ID = 'AbCdEfGhIjKlMnOpQrSt_-';
const listeners: HostListener[] = [];

async function startListener(options: { onChannelUpgrade?: () => void } = {}) {
  const onConnection = vi.fn((socket: WebSocket) => socket.close(1000, 'ok'));
  const { listener, listening } = startHostListener({
    host: '127.0.0.1',
    port: 0,
    onRequest: (_request, response) => response.writeHead(204).end(),
    onConnection,
    ...(options.onChannelUpgrade === undefined
      ? {}
      : {
          onChannelUpgrade: (_request, socket) => {
            options.onChannelUpgrade?.();
            socket.destroy();
          },
        }),
    onError: () => undefined,
  });
  listeners.push(listener);
  const { port } = await listening;
  return { port, onConnection };
}

function dial(url: string): Promise<{ opened: boolean; status?: number }> {
  return new Promise((resolve) => {
    const socket = new WebSocket(url);
    socket.once('open', () => {
      resolve({ opened: true });
      socket.close();
    });
    socket.once('unexpected-response', (_request, response) => {
      resolve({ opened: false, status: response.statusCode ?? 0 });
    });
    socket.once('error', () => resolve({ opened: false }));
  });
}

afterEach(async () => {
  for (const listener of listeners.splice(0)) {
    await stopHostListener(listener);
  }
});

describe('startHostListener upgrade routing', () => {
  it('routes root and other legacy paths to the Host connection handler', async () => {
    const { port, onConnection } = await startListener();
    expect(await dial(`ws://127.0.0.1:${port}/`)).toEqual({ opened: true });
    expect(await dial(`ws://127.0.0.1:${port}/anything?x=1`)).toEqual({ opened: true });
    expect(onConnection).toHaveBeenCalledTimes(2);
  });

  it('answers channel paths with 404 while no channel handler is installed', async () => {
    const { port, onConnection } = await startListener();
    const result = await dial(`ws://127.0.0.1:${port}/v1/u/${USER_ID}/connect?hostId=x`);
    expect(result).toEqual({ opened: false, status: 404 });
    expect(await dial(`ws://127.0.0.1:${port}/v1/u/bad`)).toEqual({ opened: false, status: 404 });
    expect(onConnection).not.toHaveBeenCalled();
  });

  it('hands channel paths to the channel handler, never to the legacy route', async () => {
    const onChannelUpgrade = vi.fn();
    const { port, onConnection } = await startListener({ onChannelUpgrade });
    await dial(`ws://127.0.0.1:${port}/v1/u/${USER_ID}/connect`);
    expect(onChannelUpgrade).toHaveBeenCalledTimes(1);
    expect(onConnection).not.toHaveBeenCalled();
  });

  it('serves plain HTTP requests on the same port', async () => {
    const { port } = await startListener();
    const response = await fetch(`http://127.0.0.1:${port}/healthz`);
    expect(response.status).toBe(204);
  });

  it('rejects listening when the port is taken', async () => {
    const { port } = await startListener();
    const second = startHostListener({
      host: '127.0.0.1',
      port,
      onRequest: () => undefined,
      onConnection: () => undefined,
      onError: () => undefined,
    });
    listeners.push(second.listener);
    await expect(second.listening).rejects.toThrow();
  });
});
