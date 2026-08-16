import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { createJsonlWriter } from './host-serve-jsonl-writer.js';

/** Scriptable fake stdout: records lines and lets tests control backpressure. */
class FakeStdout extends EventEmitter {
  readonly lines: string[] = [];
  writable = true;
  private backpressured = false;

  write(
    chunk: Uint8Array | string,
    encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
    callback?: (error?: Error | null) => void,
  ): boolean {
    const cb = typeof encodingOrCallback === 'function' ? encodingOrCallback : callback;
    this.lines.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk));
    queueMicrotask(() => cb?.(null));
    return !this.backpressured;
  }

  end(): this {
    return this;
  }

  setBackpressured(backpressured: boolean): void {
    this.backpressured = backpressured;
  }
}

/** Let the writer's promise chain attach its drain/error listeners first. */
function flushMicrotasks(): Promise<void> {
  return new Promise<void>((resolve) => {
    queueMicrotask(resolve);
  });
}

function message(type: string): Record<string, unknown> {
  return { type };
}

describe('createJsonlWriter', () => {
  it('writes lines in submission order', async () => {
    const stdout = new FakeStdout();
    const writer = createJsonlWriter(stdout);
    await writer.write(message('one'));
    await writer.write(message('two'));
    expect(stdout.lines).toEqual(['{"type":"one"}\n', '{"type":"two"}\n']);
  });

  it('resolves a backpressured write once the stream drains', async () => {
    const stdout = new FakeStdout();
    stdout.setBackpressured(true);
    const writer = createJsonlWriter(stdout);
    const pending = writer.write(message('one'));
    await flushMicrotasks();
    stdout.emit('drain');
    await pending;
    expect(stdout.lines).toHaveLength(1);
  });

  it('rejects the failing write but keeps the chain usable', async () => {
    const stdout = new FakeStdout();
    stdout.setBackpressured(true);
    const writer = createJsonlWriter(stdout);

    const failed = writer.write(message('doomed'));
    const after = writer.write(message('survivor'));
    await flushMicrotasks();
    stdout.emit('error', new Error('stream destroyed'));

    await expect(failed).rejects.toThrow('stream destroyed');
    stdout.setBackpressured(false);
    stdout.emit('drain');
    await after;
    expect(stdout.lines).toEqual(['{"type":"doomed"}\n', '{"type":"survivor"}\n']);
  });

  it('does not leave duplicate listeners behind after settlement', async () => {
    const stdout = new FakeStdout();
    stdout.setBackpressured(true);
    const writer = createJsonlWriter(stdout);

    const first = writer.write(message('one'));
    await flushMicrotasks();
    stdout.setBackpressured(false);
    stdout.emit('drain');
    await first;

    expect(stdout.listenerCount('drain')).toBe(0);
    expect(stdout.listenerCount('error')).toBe(0);
  });
});
