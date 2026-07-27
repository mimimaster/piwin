/**
 * Bounded JSONL stdout writer with backpressure.
 * Desktop sidecar treats stdout as a strict JSONL protocol.
 */
import type { HostServerMessage } from '@piwin/contracts';

export type JsonlWriter = {
  write: (message: HostServerMessage | Record<string, unknown>) => Promise<void>;
};

export function createJsonlWriter(
  writeStream: NodeJS.WritableStream = process.stdout,
): JsonlWriter {
  let chain: Promise<void> = Promise.resolve();

  function write(message: HostServerMessage | Record<string, unknown>): Promise<void> {
    const line = `${JSON.stringify(message)}\n`;
    chain = chain.then(
      () =>
        new Promise<void>((resolve, reject) => {
          let settled = false;
          const settleOk = (): void => {
            if (!settled) {
              settled = true;
              resolve();
            }
          };
          const settleErr = (error: Error): void => {
            if (!settled) {
              settled = true;
              reject(error);
            }
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
            writeStream.once('drain', settleOk);
          }
        }),
    );
    return chain;
  }

  return { write };
}
