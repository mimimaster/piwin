import type { HostResponse } from '@piwin/contracts';
import { fail } from './response-helpers.js';

/**
 * Per-session mutex for body jobs (compact / truncate / delete / pack).
 * Prompt admission is a separate gate; a reserved body job makes prompt
 * return `session-busy`.
 */
export class SessionBodyGate {
  private readonly reservedSessionIds = new Set<string>();

  tryReserve(sessionId: string): boolean {
    if (this.reservedSessionIds.has(sessionId)) {
      return false;
    }
    this.reservedSessionIds.add(sessionId);
    return true;
  }

  release(sessionId: string): void {
    this.reservedSessionIds.delete(sessionId);
  }

  isReserved(sessionId: string): boolean {
    return this.reservedSessionIds.has(sessionId);
  }
}

export function sessionBusyResponse(
  requestId: string | undefined,
  command: string,
  sessionId: string,
  reason: 'body-job' | 'foreground-run',
): HostResponse {
  return fail(requestId, command, `session-busy: ${reason}`, {
    code: 'session-busy',
    data: { sessionId, reason },
  });
}
