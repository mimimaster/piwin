import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { HostClientSubscriptionsFrame, HostCommandRequest } from '@piwin/contracts';
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

/** In-memory stdin/stdout pair: lines pushed in, JSON lines collected out. */
function createPipe() {
  const input = new Readable({
    read(): void {},
  });
  const written: unknown[] = [];
  const output = new Writable({
    write(chunk, _encoding, callback) {
      const text = String(chunk).trim();
      if (text.length > 0) {
        written.push(JSON.parse(text));
      }
      callback();
    },
  });
  const transport = createJsonlStdioTransport({ input, output });
  const pushLine = (value: unknown): void => {
    input.push(typeof value === 'string' ? `${value}\n` : `${JSON.stringify(value)}\n`);
  };
  const settled = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
  return { transport, written, pushLine, settled };
}

describe('createJsonlStdioTransport transport-control frames', () => {
  it('routes a well-formed client/subscriptions frame to control, not command', async () => {
    const { transport, written, pushLine, settled } = createPipe();
    const commands: HostCommandRequest[] = [];
    const control: HostClientSubscriptionsFrame[] = [];
    const started = transport.start(
      (request) => commands.push(request),
      (frame) => control.push(frame),
    );

    pushLine({
      type: 'client/subscriptions',
      requestId: 'sub-1',
      revision: 3,
      subscriptions: { sessionIds: ['session-a', 'session-b'] },
    });
    // A real command envelope still reaches the command lane.
    pushLine({ v: 1, command: { type: 'host/status' } });
    await settled();

    expect(control).toEqual([
      {
        type: 'client/subscriptions',
        requestId: 'sub-1',
        revision: 3,
        subscriptions: { sessionIds: ['session-a', 'session-b'] },
      },
    ]);
    expect(commands).toHaveLength(1);
    expect(commands[0]?.command.type).toBe('host/status');
    expect(written).toHaveLength(0);

    await transport.stop();
    await started;
  });

  it('sends a parse error for malformed lines and missing requestId falls through', async () => {
    const { transport, written, pushLine, settled } = createPipe();
    const commands: HostCommandRequest[] = [];
    const control: HostClientSubscriptionsFrame[] = [];
    const started = transport.start(
      (request) => commands.push(request),
      (frame) => control.push(frame),
    );

    pushLine('not json at all');
    // type matches but requestId is absent → command-parser path: any record
    // with a `type` string parses as a bare command, so it lands on the
    // command lane and the dispatcher answers with unhandled-command.
    pushLine({ type: 'client/subscriptions', revision: 1 });
    await settled();

    expect(control).toHaveLength(0);
    expect(commands).toHaveLength(1);
    expect(commands[0]?.command.type).toBe('client/subscriptions');
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({ type: 'response', command: 'parse', success: false });

    await transport.stop();
    await started;
  });
});
