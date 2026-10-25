import { describe, expect, it } from 'vitest';
import {
  createNativeRelayInnerSocket,
  type NativeHostWebSocketMessage,
  type NativeHostWebSocketOutbound,
} from './native-websocket.js';

function fakeNative() {
  const sent: NativeHostWebSocketOutbound[] = [];
  let listener: ((message: NativeHostWebSocketMessage) => void) | undefined;
  let release: () => void = () => undefined;
  const firstSendGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let sends = 0;
  return {
    sent,
    deliver: (message: NativeHostWebSocketMessage) => listener?.(message),
    releaseFirstSend: () => release(),
    connect: async () => ({
      addListener: (next: (message: NativeHostWebSocketMessage) => void) => {
        listener = next;
        return () => undefined;
      },
      send: async (message: NativeHostWebSocketOutbound) => {
        sends += 1;
        // The first native send is slow; later ones must still land after it.
        if (sends === 1) await firstSendGate;
        sent.push(message);
      },
      disconnect: async () => undefined,
    }),
  };
}

describe('native relay inner socket', () => {
  it('sends binary as a Binary message and keeps frames in order across slow sends', async () => {
    const native = fakeNative();
    const socket = createNativeRelayInnerSocket('ws://host/v1/u/x/connect', native.connect);
    await new Promise<void>((resolve) => {
      socket.onopen = () => resolve();
    });
    socket.send(Uint8Array.of(1, 2));
    socket.send('text');
    socket.send(Uint8Array.of(3));
    native.releaseFirstSend();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(native.sent).toEqual([
      { type: 'Binary', data: [1, 2] },
      'text',
      { type: 'Binary', data: [3] },
    ]);
  });

  it('delivers Binary messages as bytes', async () => {
    const native = fakeNative();
    const socket = createNativeRelayInnerSocket('ws://host', native.connect);
    await new Promise<void>((resolve) => {
      socket.onopen = () => resolve();
    });
    const received: unknown[] = [];
    socket.onmessage = (event) => received.push(event.data);
    native.deliver({ type: 'Binary', data: [9, 8] });
    expect(received).toEqual([Uint8Array.of(9, 8)]);
  });
});
