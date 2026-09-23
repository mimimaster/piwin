/**
 * JSONL stdout writer that performs the blocking writes on a worker thread.
 *
 * On Windows, Node writes to a stdout *pipe* synchronously: when the Desktop
 * reader falls behind, `process.stdout.write` blocks the Host's event loop —
 * no timers, no `host/status` answer, no command handling — until the pipe
 * drains (measured: one write blocked 2.4s, 3 of 50 timer ticks ran). Moving
 * the write onto a worker keeps the Host responsive; the backlog becomes a
 * counted queue that the egress channel can apply backpressure to.
 */
import { Worker } from 'node:worker_threads';
import type { HostServerMessage } from '@piwin/contracts';
import type { JsonlWriter } from './host-serve-jsonl-writer.js';

/** Runs inside the worker: write each line fully to the fd, then acknowledge. */
const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
const { writeSync } = require('node:fs');
parentPort.on('message', ({ id, line }) => {
  const bytes = Buffer.from(line, 'utf8');
  try {
    let offset = 0;
    while (offset < bytes.length) offset += writeSync(workerData.fd, bytes, offset);
    parentPort.postMessage({ id, ok: true });
  } catch (error) {
    parentPort.postMessage({ id, ok: false, error: String((error && error.message) || error) });
  }
});
`;

type Pending = { bytes: number; resolve: () => void; reject: (error: Error) => void };
type Ack = { id: number; ok: boolean; error?: string };

/** `fd` defaults to stdout; tests pass a file descriptor. */
export function createWorkerJsonlWriter(fd = 1): JsonlWriter {
  const worker = new Worker(WORKER_SOURCE, { eval: true, workerData: { fd } });
  const pending = new Map<number, Pending>();
  let nextId = 0;
  let queuedBytes = 0;
  let failure: Error | undefined;
  // Only hold the process open while lines are in flight, so an idle Host can
  // exit on stdin EOF yet a final response is never cut off.
  worker.unref();

  worker.on('message', (ack: Ack) => {
    const entry = pending.get(ack.id);
    if (entry === undefined) return;
    pending.delete(ack.id);
    queuedBytes -= entry.bytes;
    if (pending.size === 0) worker.unref();
    if (ack.ok) entry.resolve();
    else entry.reject(new Error(`stdout write failed: ${ack.error ?? 'unknown error'}`));
  });
  const failAll = (error: Error): void => {
    failure ??= error;
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
    queuedBytes = 0;
  };
  worker.on('error', failAll);
  worker.on('exit', (code) => failAll(new Error(`stdout writer exited with code ${code}`)));

  function write(message: HostServerMessage | Record<string, unknown>): Promise<void> {
    if (failure !== undefined) return Promise.reject(failure);
    const line = `${JSON.stringify(message)}\n`;
    const bytes = Buffer.byteLength(line);
    const id = nextId;
    nextId += 1;
    return new Promise<void>((resolve, reject) => {
      pending.set(id, { bytes, resolve, reject });
      queuedBytes += bytes;
      worker.ref();
      worker.postMessage({ id, line });
    });
  }

  return { write, pendingBytes: () => queuedBytes };
}
