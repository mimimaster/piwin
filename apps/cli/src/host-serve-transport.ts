/**
 * ADR 0027: transport abstraction for `host serve`.
 *
 * The serve loop is split into a transport (how commands arrive / messages
 * leave) and a dispatcher (what commands do). Today the only transport is
 * JSONL over stdin/stdout, but the interface is shaped so a future
 * `WebSocketTransport` / `GatewayDialTransport` can reuse the dispatcher and
 * `HostRuntime` unchanged. See ADR 0027 §3.
 */
import { createInterface } from 'node:readline';
import type { HostCommandRequest, HostServerMessage } from '@piwin/contracts';
import { parseHostCommandRequest } from '@piwin/contracts';
import { createJsonlWriter, type JsonlWriter } from './host-serve-jsonl-writer.js';
import { createWorkerJsonlWriter } from './host-serve-worker-jsonl-writer.js';

/**
 * Output bytes allowed in flight before pushes wait in the egress channel,
 * where browser frames and other projections coalesce to their latest value.
 * Keeps a response from queueing behind tens of MB of frames.
 */
export const HOST_SERVE_OUTPUT_BACKLOG_BYTES = 2 * 1024 * 1024;

/**
 * The local Desktop is the only client and must never be dropped as a slow
 * consumer; backpressure plus coalescing bound the queue instead.
 */
export const HOST_SERVE_LOCAL_EGRESS_LIMITS = {
  maxQueueBytes: 256 * 1024 * 1024,
  maxQueueItems: 200_000,
} as const;

/**
 * A bidirectional transport for the host serve protocol.
 *
 * `start` resolves when the input side ends (EOF) or `stop` is called. The
 * caller owns shutdown ordering: typically `stop()` → drain dispatcher →
 * flush stream batcher → dispose runtime.
 */
export type Transport = {
  /** Write one framed message to the output side. */
  send: (message: HostServerMessage) => Promise<void>;
  /** Begin reading commands; call `onCommand` for each parsed frame. Resolves on EOF/stop. */
  start: (onCommand: (request: HostCommandRequest) => void) => Promise<void>;
  /** Stop reading commands and flush the output side. Idempotent. */
  stop: () => Promise<void>;
  /** False while the output backlog is over budget; pushes should wait. */
  canAcceptPush: () => boolean;
};

export type JsonlStdioTransportOptions = {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
};

/**
 * JSONL over stdin/stdout transport — the default and currently only transport.
 * Each line on input is one `HostCommand` or versioned request envelope JSON;
 * each `send` writes one `HostServerMessage` JSON line on output.
 */
export function createJsonlStdioTransport(options: JsonlStdioTransportOptions = {}): Transport {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  // Windows stdout pipes block the event loop; write them from a worker.
  const workerWriter =
    output === process.stdout && process.platform === 'win32' ? createWorkerJsonlWriter() : undefined;
  const writer: JsonlWriter = workerWriter ?? createJsonlWriter(output);
  // Chain backlog plus what the stream itself still buffers.
  const backlogBytes = (): number =>
    writer.pendingBytes() + ((output as { writableLength?: number }).writableLength ?? 0);
  let readlineInterface: ReturnType<typeof createInterface> | undefined;
  let stopPromise: Promise<void> | undefined;
  let startResolve: (() => void) | undefined;

  async function send(message: HostServerMessage): Promise<void> {
    await writer.write(message);
  }

  function stop(): Promise<void> {
    if (stopPromise !== undefined) {
      return stopPromise;
    }
    stopPromise = (async (): Promise<void> => {
      // Stop reading first so EOF/SIGINT cannot admit more commands.
      readlineInterface?.close();
      if (startResolve !== undefined) {
        startResolve();
        startResolve = undefined;
      }
    })();
    return stopPromise;
  }

  function start(onCommand: (request: HostCommandRequest) => void): Promise<void> {
    if (readlineInterface !== undefined) {
      // Transport already started; a single transport serves one serve loop.
      return Promise.resolve();
    }
    readlineInterface = createInterface({ input, crlfDelay: Infinity });
    return new Promise<void>((resolve) => {
      startResolve = resolve;
      readlineInterface?.on('line', (line) => {
        const trimmed = line.trim();
        if (!trimmed) {
          return;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(trimmed) as unknown;
        } catch {
          void send({
            type: 'response',
            command: 'parse',
            success: false,
            error: 'invalid JSON command line',
          });
          return;
        }
        const request = parseHostCommandRequest(parsed);
        if ('error' in request) {
          void send({
            type: 'response',
            command: 'parse',
            success: false,
            error: request.error,
          });
          return;
        }
        onCommand(request);
      });
      readlineInterface?.on('close', () => {
        if (startResolve !== undefined) {
          startResolve();
          startResolve = undefined;
        }
      });
    });
  }

  return {
    send,
    start,
    stop,
    canAcceptPush: () => backlogBytes() < HOST_SERVE_OUTPUT_BACKLOG_BYTES,
  };
}
