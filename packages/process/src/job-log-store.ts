/**
 * Bounded in-memory log store for job output with monotonic cursors and redaction.
 *
 * JC-07: Logs use monotonic cursors, a bounded memory tail, disk spool, and redaction.
 * This implementation provides the in-memory bounded tail + redaction + cursor
 * pagination. Disk spool is a future extension point.
 */

import type { JobLogChunk } from '@piwin/contracts';

import { redactSecretText } from './redact-logs.js';

/** Default maximum bytes retained per job in the ring buffer. */
const DEFAULT_MAX_LOG_BYTES = 2 * 1024 * 1024; // 2 MB

/** Default maximum bytes returned per read call. */
const DEFAULT_READ_MAX_BYTES = 256 * 1024; // 256 KB

/** Per-job ring buffer state. */
interface JobLogBuffer {
  /** Monotonic cursor counter — incremented by 1 for every appended chunk. */
  nextCursor: number;
  /** Stored chunks (oldest at index 0). */
  chunks: JobLogChunk[];
  /** Approximate total bytes of stored chunk text. */
  bytes: number;
}

/** Input for {@link JobLogStore.read}. */
interface ReadInput {
  jobId: string;
  /** Exclusive lower-bound cursor. Default 0 = from start. */
  afterCursor?: number;
  /** Maximum bytes to return. Default 256 KB. */
  maxBytes?: number;
}

/** Result of {@link JobLogStore.read}. */
interface ReadResult {
  chunks: JobLogChunk[];
  /** Highest cursor in returned chunks (or afterCursor if none). */
  nextCursor: number;
  /** True when there are chunks beyond what was returned. */
  hasMore: boolean;
}

/**
 * Bounded in-memory log store with per-job monotonic cursors and redaction.
 *
 * Each job gets its own ring buffer. When the buffer exceeds `maxLogBytes`,
 * the oldest chunks are dropped, but the monotonic cursor continues to
 * increase — readers that request `afterCursor` values older than the
 * retained tail will simply receive the oldest available chunks.
 */
interface JobLogStore {
  /** Append a redacted log chunk for a job, assigning the next monotonic cursor. Returns the redacted text. */
  append(jobId: string, stream: 'stdout' | 'stderr' | 'system', text: string): string;
  /** Read log chunks for a job after the given cursor, up to `maxBytes`. */
  read(input: ReadInput): ReadResult;
  /** Return the latest cursor assigned for a job (0 if no logs). */
  getLatestCursor(jobId: string): number;
  /** Clear all stored logs for a job. */
  clear(jobId: string): void;
  /** Clear all stored logs for all jobs. */
  dispose(): void;
}

/** Create a bounded, redacting job log store. */
function createJobLogStore(maxLogBytes: number = DEFAULT_MAX_LOG_BYTES): JobLogStore {
  const buffers = new Map<string, JobLogBuffer>();

  function ensureBuffer(jobId: string): JobLogBuffer {
    let buffer = buffers.get(jobId);
    if (!buffer) {
      buffer = { nextCursor: 1, chunks: [], bytes: 0 };
      buffers.set(jobId, buffer);
    }
    return buffer;
  }

  function evictUntilUnderLimit(buffer: JobLogBuffer): void {
    while (buffer.bytes > maxLogBytes && buffer.chunks.length > 0) {
      const dropped = buffer.chunks.shift();
      if (dropped) {
        buffer.bytes -= dropped.text.length;
      }
    }
  }

  return {
    append(jobId: string, stream: 'stdout' | 'stderr' | 'system', text: string): string {
      const buffer = ensureBuffer(jobId);
      const redacted = redactSecretText(text);
      const cursor = buffer.nextCursor;
      buffer.nextCursor += 1;
      const chunk: JobLogChunk = {
        jobId,
        stream,
        text: redacted,
        at: new Date().toISOString(),
        cursor,
      };
      buffer.chunks.push(chunk);
      buffer.bytes += redacted.length;
      evictUntilUnderLimit(buffer);
      return redacted;
    },

    read(input: ReadInput): ReadResult {
      const { jobId } = input;
      const afterCursor = input.afterCursor ?? 0;
      const maxBytes = input.maxBytes ?? DEFAULT_READ_MAX_BYTES;

      const buffer = buffers.get(jobId);
      if (!buffer || buffer.chunks.length === 0) {
        return { chunks: [], nextCursor: afterCursor, hasMore: false };
      }

      // Collect chunks whose cursor is strictly greater than afterCursor.
      const eligible: JobLogChunk[] = [];
      let accumulated = 0;
      let splitIndex = buffer.chunks.length; // index where we stop

      for (let index = 0; index < buffer.chunks.length; index++) {
        const chunk = buffer.chunks[index]!;
        if (chunk.cursor <= afterCursor) {
          continue;
        }
        if (accumulated + chunk.text.length > maxBytes && eligible.length > 0) {
          splitIndex = index;
          break;
        }
        eligible.push(chunk);
        accumulated += chunk.text.length;
        splitIndex = index + 1;
      }

      if (eligible.length === 0) {
        return { chunks: [], nextCursor: afterCursor, hasMore: false };
      }

      const lastReturned = eligible[eligible.length - 1]!;
      const nextCursor = lastReturned.cursor;
      const hasMore = splitIndex < buffer.chunks.length;

      return { chunks: eligible, nextCursor, hasMore };
    },

    getLatestCursor(jobId: string): number {
      const buffer = buffers.get(jobId);
      if (!buffer || buffer.nextCursor === 1) {
        return 0;  // No logs yet
      }
      // The latest assigned cursor is nextCursor - 1.
      return buffer.nextCursor - 1;
    },

    clear(jobId: string): void {
      buffers.delete(jobId);
    },

    dispose(): void {
      buffers.clear();
    },
  };
}

export { createJobLogStore };
export type { JobLogStore, ReadInput as JobLogReadInput, ReadResult as JobLogReadResult };
