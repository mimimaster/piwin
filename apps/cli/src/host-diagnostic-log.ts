import { createWriteStream, mkdirSync, renameSync, statSync, type WriteStream } from 'node:fs';
import { join } from 'node:path';

/** Rotate once the live file passes this size; one previous file is kept. */
export const HOST_DIAGNOSTIC_LOG_MAX_BYTES = 8 * 1024 * 1024;

type StderrWrite = typeof process.stderr.write;

/**
 * The packaged sidecar's stderr only reaches the Desktop as transient
 * `host-log` events, so a Host that stalled or failed leaves nothing to read
 * afterwards. Tee every stderr write into `<root>/logs/host.log` with a
 * timestamp per line. stdout is untouched: it carries the JSONL protocol.
 */
export function installHostDiagnosticLog(piwinRoot: string): void {
  redirectHostLogsToStandardError();
  const directory = join(piwinRoot, 'logs');
  const filePath = join(directory, 'host.log');
  const forward = process.stderr.write.bind(process.stderr) as StderrWrite;
  let stream: WriteStream | undefined;
  let bytes = 0;
  let atLineStart = true;

  function open(): void {
    try {
      mkdirSync(directory, { recursive: true });
      bytes = fileSize(filePath);
      if (bytes >= HOST_DIAGNOSTIC_LOG_MAX_BYTES) {
        renameSync(filePath, join(directory, 'host.1.log'));
        bytes = 0;
      }
      stream = createWriteStream(filePath, { flags: 'a' });
      stream.on('error', (error) => {
        stream = undefined;
        forward(`[piwin host serve] diagnostic log disabled: ${error.message}\n`);
      });
    } catch (error) {
      stream = undefined;
      forward(
        `[piwin host serve] diagnostic log unavailable: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
  }

  function append(text: string): void {
    if (stream === undefined) return;
    const stamped = stampLines(text, atLineStart, new Date().toISOString());
    atLineStart = text.endsWith('\n');
    stream.write(stamped);
    bytes += Buffer.byteLength(stamped);
    if (bytes >= HOST_DIAGNOSTIC_LOG_MAX_BYTES) {
      // Windows cannot rename a file that is still open: rotate once the
      // descriptor is closed. Lines written in between are dropped.
      const full = stream;
      stream = undefined;
      full.once('close', open);
      full.end();
    }
  }

  process.stderr.write = ((chunk: unknown, ...rest: unknown[]) => {
    append(typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array).toString('utf8'));
    return (forward as (...args: unknown[]) => boolean)(chunk, ...rest);
  }) as StderrWrite;

  open();
  append(`[piwin host serve] started pid=${process.pid} platform=${process.platform}\n`);
}

/** Prefix each line that starts in `text` with `[timestamp] `. */
export function stampLines(text: string, atLineStart: boolean, timestamp: string): string {
  const prefix = `[${timestamp}] `;
  const body = text.replace(/\n(?=.)/g, `\n${prefix}`);
  return atLineStart && text.length > 0 ? `${prefix}${body}` : body;
}

function fileSize(filePath: string): number {
  try {
    return statSync(filePath).size;
  } catch {
    // Missing file: a fresh log starts empty.
    return 0;
  }
}

/**
 * The desktop sidecar treats stdout as a strict JSONL protocol. Agent-host and
 * third-party extensions use console.info/warn for diagnostics, which otherwise
 * insert plain text between protocol messages and corrupt the stream.
 */
function redirectHostLogsToStandardError(): void {
  const writeDiagnostic = console.error.bind(console);
  console.log = writeDiagnostic;
  console.info = writeDiagnostic;
  console.warn = writeDiagnostic;
}
