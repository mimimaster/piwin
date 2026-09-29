import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createGrokProcessTransport,
  GrokProcessClosedError,
  type GrokChildProcess,
  type GrokSpawn,
} from './grok-process-transport.js';

afterEach(() => {
  vi.useRealTimers();
});

type FakeChild = GrokChildProcess & {
  signals: NodeJS.Signals[];
  emitExit: (code: number | null, signal: NodeJS.Signals | null) => void;
  emitError: (error: Error) => void;
  stdout: PassThrough;
  stderr: PassThrough;
  stdin: PassThrough;
};

function createFakeChild(pid = 4242): FakeChild {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const emitter = new EventEmitter();
  const signals: NodeJS.Signals[] = [];
  const child: FakeChild = {
    stdin,
    stdout,
    stderr,
    pid,
    signals,
    kill(signal?: NodeJS.Signals): boolean {
      signals.push(signal ?? 'SIGTERM');
      return true;
    },
    on(
      event: 'exit' | 'error',
      listener:
        | ((code: number | null, signal: NodeJS.Signals | null) => void)
        | ((error: Error) => void),
    ): unknown {
      emitter.on(event, listener);
      return emitter;
    },
    emitExit(code, signal): void {
      emitter.emit('exit', code, signal);
    },
    emitError(error): void {
      emitter.emit('error', error);
    },
  };
  return child;
}

function collectLines(transport: ReturnType<typeof createGrokProcessTransport>): string[] {
  const lines: string[] = [];
  transport.onLine((line) => {
    lines.push(line);
  });
  return lines;
}

describe('createGrokProcessTransport', () => {
  it('spawns grok agent stdio and splits stdout lines across chunks and CRLF', () => {
    const spawned: Array<{ command: string; args: readonly string[]; cwd?: string }> = [];
    const child = createFakeChild();
    const spawn: GrokSpawn = (command, args, options) => {
      spawned.push(
        options.cwd === undefined
          ? { command, args }
          : { command, args, cwd: options.cwd },
      );
      return child;
    };
    const transport = createGrokProcessTransport({
      binaryPath: '/opt/grok',
      cwd: '/tmp/work',
      spawn,
    });
    const lines = collectLines(transport);
    expect(spawned).toEqual([{ command: '/opt/grok', args: ['agent', 'stdio'], cwd: '/tmp/work' }]);
    expect(transport.pid).toBe(4242);

    child.stdout.write('hel');
    child.stdout.write('lo\nwor');
    child.stdout.write('ld\r\n\nnext\n');
    expect(lines).toEqual(['hello', 'world', 'next']);
  });

  it('keeps a bounded stderr ring and never emits stderr as lines', () => {
    const child = createFakeChild();
    const transport = createGrokProcessTransport({
      binaryPath: '/opt/grok',
      spawn: () => child,
      stderrRingBytes: 8,
    });
    const lines = collectLines(transport);
    child.stderr.write('XAI_API_KEY=sk-test-secret-value-abcdef');
    child.stdout.write('ok\n');
    expect(lines).toEqual(['ok']);
    expect(transport.stderrTail()).toBe('e-abcdef');
    expect(transport.stderrTail().length).toBe(8);
  });

  it('fires onClose once on process exit', () => {
    const child = createFakeChild();
    const transport = createGrokProcessTransport({
      binaryPath: '/opt/grok',
      spawn: () => child,
    });
    const closes: unknown[] = [];
    transport.onClose((info) => {
      closes.push(info);
    });
    child.emitExit(0, null);
    child.emitExit(1, null);
    expect(closes).toEqual([{ code: 0, signal: null }]);
  });

  it('reports spawn error close reason once', () => {
    const child = createFakeChild();
    const transport = createGrokProcessTransport({
      binaryPath: '/opt/grok',
      spawn: () => child,
    });
    const closes: unknown[] = [];
    transport.onClose((info) => {
      closes.push(info);
    });
    const error = new Error('spawn grok ENOENT');
    child.emitError(error);
    child.emitExit(null, null);
    expect(closes).toEqual([{ code: null, signal: null, reason: 'Error: spawn grok ENOENT' }]);
  });

  it('close() sends SIGTERM then SIGKILL after timeout', async () => {
    vi.useFakeTimers();
    const child = createFakeChild();
    const transport = createGrokProcessTransport({
      binaryPath: '/opt/grok',
      spawn: () => child,
      killTimeoutMs: 50,
    });
    const closePromise = transport.close();
    expect(child.signals).toEqual(['SIGTERM']);
    await vi.advanceTimersByTimeAsync(50);
    expect(child.signals).toEqual(['SIGTERM', 'SIGKILL']);
    child.emitExit(null, 'SIGKILL');
    await closePromise;
    await expect(transport.close()).resolves.toBeUndefined();
  });

  it('throws GrokProcessClosedError when sending after close', () => {
    const child = createFakeChild();
    const transport = createGrokProcessTransport({
      binaryPath: '/opt/grok',
      spawn: () => child,
    });
    child.emitExit(0, null);
    expect(() => transport.send('{"jsonrpc":"2.0","method":"ping"}')).toThrow(GrokProcessClosedError);
  });
});
