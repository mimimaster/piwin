import type { AgentEvent } from '@piwin/contracts';
import { asRecord, readNumber, readString } from './pi-event-read.js';

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

  const aborted = event.aborted === true;
  if (typeof event.ok === 'boolean') {
    endEvent.ok = event.ok;
  } else if (typeof event.isError === 'boolean') {
    endEvent.ok = !event.isError;
  } else if (aborted) {
    endEvent.ok = false;
  } else if (event.result !== undefined) {
    endEvent.ok = event.result !== null;
  }

  const msg =
    readString(event.message) ?? readString(event.errorMessage) ?? readString(event.error);
  if (msg) {
    endEvent.message = msg;
  } else if (aborted) {
    endEvent.message = 'Compaction aborted';
  }

  const result = asRecord(event.result);
  if (result) {
    const summary = readString(result.summary);
    if (summary) {
      endEvent.summary = summary;
      if (!endEvent.message) {
        endEvent.message = summary.slice(0, 200);
      }
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
  }

  const durationMs = readNumber(event.durationMs);
  if (durationMs !== undefined) {
    endEvent.durationMs = durationMs;
  }

  return endEvent;
}
