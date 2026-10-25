import { EventEmitter } from 'node:events';
import type { WebSocket } from 'ws';
import { describe, expect, it, vi } from 'vitest';
import { wrapWsPeerSocket } from './host-peer-socket.js';

class FakeWs extends EventEmitter {
  public readyState = 0;
  public bufferedAmount = 0;
  public readonly send = vi.fn();
  public readonly close = vi.fn();
  public readonly terminate = vi.fn();
  public readonly ping = vi.fn();
}

function wrap(fake: FakeWs) {
  return wrapWsPeerSocket(fake as unknown as WebSocket);
}

describe('wrapWsPeerSocket', () => {
  it('reads readyState and bufferedAmount live', () => {
    const fake = new FakeWs();
    const peer = wrap(fake);
    expect(peer.readyState).toBe(0);
    fake.readyState = 1;
    fake.bufferedAmount = 42;
    expect(peer.readyState).toBe(1);
    expect(peer.bufferedAmount).toBe(42);
  });

  it('delivers every ws RawData shape as text', () => {
    const fake = new FakeWs();
    const received: string[] = [];
    wrap(fake).onMessage((text) => received.push(text));
    fake.emit('message', Buffer.from('{"a":1}'));
    fake.emit('message', new TextEncoder().encode('{"b":2}').buffer);
    fake.emit('message', [Buffer.from('{"c"'), Buffer.from(':3}')]);
    expect(received).toEqual(['{"a":1}', '{"b":2}', '{"c":3}']);
  });

  it('maps close reason buffers to strings and forwards pong and error', () => {
    const fake = new FakeWs();
    const peer = wrap(fake);
    const onClose = vi.fn();
    const onPong = vi.fn();
    const onError = vi.fn();
    peer.onClose(onClose);
    peer.onPong(onPong);
    peer.onError(onError);
    fake.emit('pong');
    const failure = new Error('boom');
    fake.emit('error', failure);
    fake.emit('close', 4004, Buffer.from('device revoked'));
    expect(onPong).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(failure);
    expect(onClose).toHaveBeenCalledWith(4004, 'device revoked');
  });

  it('forwards outbound calls to the ws socket', () => {
    const fake = new FakeWs();
    const peer = wrap(fake);
    const bytes = new Uint8Array([1, 2, 3]);
    peer.send('text');
    peer.send(bytes);
    peer.ping();
    peer.close(1001, 'stopping');
    peer.terminate();
    expect(fake.send).toHaveBeenNthCalledWith(1, 'text');
    expect(fake.send).toHaveBeenNthCalledWith(2, bytes);
    expect(fake.ping).toHaveBeenCalledTimes(1);
    expect(fake.close).toHaveBeenCalledWith(1001, 'stopping');
    expect(fake.terminate).toHaveBeenCalledTimes(1);
  });
});
