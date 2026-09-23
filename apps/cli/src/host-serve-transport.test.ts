import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { createJsonlStdioTransport, HOST_SERVE_OUTPUT_BACKLOG_BYTES } from './host-serve-transport.js';

/** A stdout whose reader never drains: every write reports a full buffer. */
class StalledStdout extends EventEmitter {
  writableLength = 0;

  write(chunk: string, callback?: (error?: Error | null) => void): boolean {
    this.writableLength += Buffer.byteLength(chunk);
    queueMicrotask(() => callback?.(null));
    return false;
  }
}

describe('createJsonlStdioTransport backpressure', () => {
  it('stops accepting pushes once the output backlog passes the budget', async () => {
    const output = new StalledStdout();
    const transport = createJsonlStdioTransport({
      input: new EventEmitter() as unknown as NodeJS.ReadableStream,
      output: output as unknown as NodeJS.WritableStream,
    });
    expect(transport.canAcceptPush()).toBe(true);

    const payload = 'x'.repeat(256 * 1024);
    const writes = Math.ceil(HOST_SERVE_OUTPUT_BACKLOG_BYTES / payload.length) + 1;
    for (let index = 0; index < writes; index += 1) {
      void transport.send({ type: 'host/log', level: 'info', message: payload });
    }
    await Promise.resolve();
    expect(transport.canAcceptPush()).toBe(false);
  });
});
