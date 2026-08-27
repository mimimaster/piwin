import type { AgentEvent } from '@piwin/contracts';
import { readNumber, readString } from './pi-event-read.js';

function readRetryAttempt(event: Record<string, unknown>): number {
  return readNumber(event.attempt) ?? 1;
}

function readMaxAttempts(event: Record<string, unknown>): number | undefined {
  return readNumber(event.maxAttempts) ?? readNumber(event.maxRetries);
}

export function mapPiAutoRetryEvent(event: Record<string, unknown>): AgentEvent[] {
  const type = readString(event.type);
  const maxAttempts = readMaxAttempts(event);
  if (type === 'auto_retry_start') {
    const delayMs = readNumber(event.delayMs);
    return [
      {
        type: 'model/retry',
        phase: delayMs !== undefined && delayMs > 0 ? 'waiting' : 'attempting',
        attempt: readRetryAttempt(event),
        ...(maxAttempts === undefined ? {} : { maxAttempts }),
        ...(delayMs === undefined ? {} : { delayMs }),
      },
    ];
  }
  if (type === 'auto_retry_end') {
    return [
      {
        type: 'model/retry',
        phase: 'finished',
        attempt: readRetryAttempt(event),
        ...(maxAttempts === undefined ? {} : { maxAttempts }),
      },
    ];
  }
  return [];
}
