/** Owner-reported focused session for Live → Session admission hold. */
export class LiveIntendedSessionGate {
  private readonly byCallId = new Map<string, string | null>();

  set(callId: string, intendedSessionId: string | null): void {
    this.byCallId.set(callId, intendedSessionId);
  }

  /** `undefined` = never set → legacy admit. */
  read(callId: string): string | null | undefined {
    if (!this.byCallId.has(callId)) return undefined;
    return this.byCallId.get(callId);
  }
}
