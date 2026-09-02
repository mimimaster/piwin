import { classifyCompactionNoOp } from '@piwin/contracts';
import type { AgentEvent, CompactionReason } from '@piwin/contracts';
import { asRecord, readNumber, readString } from './pi-event-read.js';
import { readPiCompactionFileOps } from './pi-compaction-result.js';

/**
 * Map Pi compaction_end (+ host-enriched fields) into AgentEvent.
 * Never invents token counts — only maps numbers when present.
 */
export function mapCompactionEndEvent(
  event: Record<string, unknown>,
): Extract<AgentEvent, { type: 'compaction/end' }> {
  const endEvent: Extract<AgentEvent, { type: 'compaction/end' }> = {
    type: 'compaction/end',
  };

  const operationId = readString(event.operationId) ?? readString(event.compactionId);
  if (operationId) {
    endEvent.operationId = operationId;
  }
  const reason = readCompactionReason(event.reason);
  if (reason) {
    endEvent.reason = reason;
  }
  if (event.aborted === true) {
    endEvent.aborted = true;
  }
  if (event.willRetry === true) {
    endEvent.willRetry = true;
  }

  const aborted = event.aborted === true;
  const resultRecord = Array.isArray(event.result) ? null : asRecord(event.result);
  const result = isUsableCompactionResult(resultRecord) ? resultRecord : null;
  if (aborted) {
    // An aborted operation cannot be treated as a committed native boundary,
    // even if a legacy adapter optimistically included `ok: true`.
    endEvent.ok = false;
  } else if (typeof event.ok === 'boolean') {
    endEvent.ok = event.ok;
  } else if (result === null) {
    // A missing native result means Pi did not append a compaction entry.
    // Do this before the legacy isError fallback so isError=false cannot
    // manufacture a successful context boundary for a result-less event.
    endEvent.ok = false;
  } else if (readString(event.errorMessage)?.trim() || readString(event.error)?.trim()) {
    // Pi can expose a malformed result together with an error field. Treat
    // that combination as failed unless the adapter supplied an explicit
    // status; an error-bearing event must never advance the context barrier.
    endEvent.ok = false;
  } else if (typeof event.isError === 'boolean') {
    endEvent.ok = !event.isError;
  } else {
    endEvent.ok = true;
  }

  const msg =
    readString(event.message) ?? readString(event.errorMessage) ?? readString(event.error);
  if (msg) {
    endEvent.message = msg;
  } else if (aborted) {
    endEvent.message = 'Compaction aborted';
  }
  if (classifyCompactionNoOp(msg) !== undefined) {
    endEvent.noOp = true;
    // A no-op never appends a native compaction boundary, even if a custom
    // adapter supplied an optimistic `ok: true` field on the event.
    endEvent.ok = false;
  }

  const fileOps =
    readPiCompactionFileOps(result) ??
    readPiCompactionFileOps(event.details) ??
    readPiCompactionFileOps(event);
  if (fileOps) {
    endEvent.fileOps = fileOps;
  }
  if (result) {
    const summary = readString(result.summary) ?? readString(event.summary);
    if (summary) {
      endEvent.summary = summary;
    }
    const firstKeptEntryId =
      readString(result.firstKeptEntryId) ?? readString(event.firstKeptEntryId);
    if (firstKeptEntryId) {
      endEvent.firstKeptEntryId = firstKeptEntryId;
    }
    const tokensBefore = readNumber(result.tokensBefore) ?? readNumber(event.tokensBefore);
    if (tokensBefore !== undefined) {
      endEvent.tokensBefore = tokensBefore;
    }
    const tokensAfter =
      readNumber(result.estimatedTokensAfter) ??
      readNumber(result.tokensAfter) ??
      readNumber(event.tokensAfter);
    if (tokensAfter !== undefined) {
      endEvent.tokensAfter = tokensAfter;
    }
  } else {
    const tokensBefore = readNumber(event.tokensBefore);
    if (tokensBefore !== undefined) {
      endEvent.tokensBefore = tokensBefore;
    }
    const tokensAfter = readNumber(event.tokensAfter);
    if (tokensAfter !== undefined) {
      endEvent.tokensAfter = tokensAfter;
    }
    const summary = readString(event.summary);
    if (summary) {
      endEvent.summary = summary;
    }
    const firstKeptEntryId = readString(event.firstKeptEntryId);
    if (firstKeptEntryId) {
      endEvent.firstKeptEntryId = firstKeptEntryId;
    }
  }

  const durationMs = readNumber(event.durationMs);
  if (durationMs !== undefined) {
    endEvent.durationMs = durationMs;
  }

  return endEvent;
}

export function readCompactionReason(value: unknown): CompactionReason | undefined {
  return value === 'manual' || value === 'threshold' || value === 'overflow' ? value : undefined;
}

function isUsableCompactionResult(
  result: Record<string, unknown> | null,
): result is Record<string, unknown> {
  if (result === null) {
    return false;
  }
  return (
    readString(result.summary) !== undefined ||
    readString(result.firstKeptEntryId) !== undefined ||
    readNumber(result.tokensBefore) !== undefined ||
    readNumber(result.estimatedTokensAfter) !== undefined ||
    readPiCompactionFileOps(result) !== undefined
  );
}
