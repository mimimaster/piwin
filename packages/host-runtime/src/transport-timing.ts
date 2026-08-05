/**
 * Bounded ring buffer for transport-boundary timing records.
 * Used to measure prompt acknowledgement latency, Stop-to-abort dispatch,
 * first-token delay, and cancellation terminal timing without unbounded
 * memory growth. Records are redacted by design: no prompt text, model
 * output, or secrets are stored.
 */

export type TransportTimingRecord = {
  /** Stable label identifying the timing point (e.g. "prompt/accepted"). */
  label: string;
  /** Monotonic timestamp in milliseconds (performance.now() when available). */
  atMs: number;
  /** Optional correlation id (runId, requestId, sessionId). */
  correlationId?: string;
  /** Optional short detail (phase name, error code). Never user content. */
  detail?: string;
};

export type TransportTimingBufferOptions = {
  /** Maximum records retained. Default 200. */
  maxRecords?: number;
  /** Injectable clock for deterministic tests. Default: performance.now(). */
  now?: () => number;
};

export type TransportTimingBuffer = {
  /** Record a timing point. */
  record(label: string, options?: { correlationId?: string; detail?: string }): void;
  /** Return a snapshot of all retained records (oldest first). */
  snapshot(): TransportTimingRecord[];
  /** Return records matching a correlation id. */
  byCorrelation(correlationId: string): TransportTimingRecord[];
  /** Compute elapsed ms between two labels for a given correlation id. */
  elapsedBetween(
    correlationId: string,
    startLabel: string,
    endLabel: string,
  ): number | null;
  /** Clear all records. */
  clear(): void;
  /** Current record count. */
  readonly size: number;
};

function defaultNow(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

export function createTransportTimingBuffer(
  options: TransportTimingBufferOptions = {},
): TransportTimingBuffer {
  const maxRecords = options.maxRecords ?? 200;
  const now = options.now ?? defaultNow;
  const records: TransportTimingRecord[] = [];

  function record(
    label: string,
    recordOptions?: { correlationId?: string; detail?: string },
  ): void {
    const entry: TransportTimingRecord = { label, atMs: now() };
    if (recordOptions?.correlationId !== undefined) {
      entry.correlationId = recordOptions.correlationId;
    }
    if (recordOptions?.detail !== undefined) {
      entry.detail = recordOptions.detail;
    }
    records.push(entry);
    // Evict oldest when over capacity.
    if (records.length > maxRecords) {
      records.splice(0, records.length - maxRecords);
    }
  }

  function snapshot(): TransportTimingRecord[] {
    return [...records];
  }

  function byCorrelation(correlationId: string): TransportTimingRecord[] {
    return records.filter((entry) => entry.correlationId === correlationId);
  }

  function elapsedBetween(
    correlationId: string,
    startLabel: string,
    endLabel: string,
  ): number | null {
    const matched = byCorrelation(correlationId);
    const startEntry = matched.find((entry) => entry.label === startLabel);
    const endEntry = matched.find((entry) => entry.label === endLabel);
    if (startEntry === undefined || endEntry === undefined) {
      return null;
    }
    return endEntry.atMs - startEntry.atMs;
  }

  function clear(): void {
    records.length = 0;
  }

  return {
    record,
    snapshot,
    byCorrelation,
    elapsedBetween,
    clear,
    get size() {
      return records.length;
    },
  };
}
