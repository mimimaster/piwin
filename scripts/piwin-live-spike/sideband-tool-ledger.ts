/**
 * WP1.3 — Host-side ledger for client-delegation admissions (fake Session).
 * Idempotent on (callId, providerDelegationId).
 */

import { normalizeDelegationCreatedEvent } from './delegation-normalize.js';

export type FakeAdmission =
  | { status: 'accepted'; runId: string; messageId: string }
  | { status: 'rejected'; reason: 'invalid-schema' | 'byte-cap' | 'call-closed' };

export class SidebandToolLedger {
  private readonly admissions = new Map<string, FakeAdmission>();
  private closed = false;
  private seq = 0;

  private key(callId: string, providerDelegationId: string): string {
    return `${callId}::${providerDelegationId}`;
  }

  close(): void {
    this.closed = true;
  }

  admitFromUpstreamEvent(callId: string, rawEvent: unknown): FakeAdmission {
    if (this.closed) return { status: 'rejected', reason: 'call-closed' };
    const normalized = normalizeDelegationCreatedEvent(rawEvent);
    if (!normalized) return { status: 'rejected', reason: 'invalid-schema' };

    const key = this.key(callId, normalized.providerDelegationId);
    const existing = this.admissions.get(key);
    if (existing) return existing;

    this.seq += 1;
    const admission: FakeAdmission = {
      status: 'accepted',
      runId: `run-fake-${this.seq}`,
      messageId: `msg-fake-${this.seq}`,
    };
    this.admissions.set(key, admission);
    return admission;
  }
}
