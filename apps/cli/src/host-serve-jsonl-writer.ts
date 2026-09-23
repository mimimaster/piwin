/**
 * Bounded JSONL stdout writer with backpressure.
 * Desktop sidecar treats stdout as a strict JSONL protocol.
 */
import type { HostServerMessage } from '@piwin/contracts';

export type JsonlWriter = {
  write: (message: HostServerMessage | Record<string, unknown>) => Promise<void>;
  /**
   * Bytes accepted by `write` but not yet handed to the stream. Lines behind a
   * full buffer wait in this writer's chain, which `writableLength` never
   * sees, so backpressure must read this count.
   */
  pendingBytes: () => number;
};

export function createJsonlWriter(
  writeStream: NodeJS.WritableStream = process.stdout,
): JsonlWriter {
  let chain: Promise<void> = Promise.resolve();
  let queuedBytes = 0;

  function write(message: HostServerMessage | Record<string, unknown>): Promise<void> {
    const line = `${JSON.stringify(message)}\n`;
    const bytes = Buffer.byteLength(line);
    queuedBytes += bytes;
    const attempt = chain.then(
      () =>
        new Promise<void>((resolve, reject) => {
          let settled = false;
          const cleanup = (): void => {
            writeStream.removeListener('drain', settleOk);
            writeStream.removeListener('error', settleErr);
          };
          const settleOk = (): void => {
            if (settled) {
              return;
            }
            settled = true;
            cleanup();
            resolve();
          };
          const settleErr = (error: Error): void => {
            if (settled) {
              return;
            }
            settled = true;
            cleanup();
            reject(error instanceof Error ? error : new Error(String(error)));
          };

          const canContinue = writeStream.write(line, (error) => {
            if (error) {
              settleErr(error instanceof Error ? error : new Error(String(error)));
            }
          });

          if (canContinue) {
            // Buffer accepted; resolve without waiting for full flush callback.
            settleOk();
          } else {
            // While waiting for drain, a stream error is the only other
            // settlement; without this listener the promise (and the chain)
            // would hang forever.
            writeStream.once('drain', settleOk);
            writeStream.once('error', settleErr);
          }
        }),
    );
    // A single failed line must not poison the chain: later writes still
    // execute, and only the failed write's own promise rejects so its caller
    // can log. Without this catch, one rejection skips every subsequent
    // `.then` and the sidecar silently stops writing stdout.
    chain = attempt.catch(() => undefined);
    void chain.then(() => {
      queuedBytes -= bytes;
    });
    return attempt;
  }

  return { write, pendingBytes: () => queuedBytes };
}
