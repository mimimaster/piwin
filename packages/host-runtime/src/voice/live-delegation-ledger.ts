import type { LiveDelegationContext } from '@piwin/contracts';

const LIVE_DELEGATION_LEDGER_MAX = 64;

export type LiveDelegationRecord = {
  callId: string;
  providerDelegationId: string;
  sessionId: string;
  messageId: string;
  queueId?: string;
  runId?: string;
  admission: 'accepted' | 'rejected';
  /** The matching terminal Run has been recorded; provider delivery is not implied. */
  resultRecorded: boolean;
  brief?: string;
  result?: string;
  status?: LiveDelegationContext['status'];
};

export class LiveDelegationLedger {
  private readonly records: LiveDelegationRecord[] = [];

  hasCapacity(): boolean { return this.records.length < LIVE_DELEGATION_LEDGER_MAX; }

  context(): LiveDelegationContext[] {
    return this.contextForSession();
  }

  contextForSession(sessionId?: string): LiveDelegationContext[] {
    return this.records.flatMap((record) => {
      if (sessionId && record.sessionId !== sessionId) return [];
      return record.brief
        ? [{
            delegationId: record.providerDelegationId,
            brief: record.brief,
            status: record.status ?? (record.queueId && !record.runId ? 'queued' : 'working'),
            ...(record.result ? { result: record.result } : {}),
          }]
        : [];
    }).slice(-12);
  }

  remember(record: LiveDelegationRecord): { ok: true } | { ok: false; reason: 'full' } {
    if (this.records.length >= LIVE_DELEGATION_LEDGER_MAX) return { ok: false, reason: 'full' };
    this.records.push(record);
    return { ok: true };
  }

  find(callId: string, providerDelegationId: string): LiveDelegationRecord | undefined {
    return this.records.find(
      (record) => record.callId === callId && record.providerDelegationId === providerDelegationId,
    );
  }

  bindRunId(input: { sessionId: string; messageId?: string; queueId?: string; runId: string }): void {
    const record = this.records.find(
      (item) =>
        item.sessionId === input.sessionId &&
        !item.runId &&
        item.admission === 'accepted' &&
        (input.messageId
          ? item.messageId === input.messageId
          : input.queueId
            ? item.queueId === input.queueId
            : false),
    );
    if (record) record.runId = input.runId;
  }

  findForTurn(input: { sessionId: string; runId: string }): LiveDelegationRecord | undefined {
    return this.records.find(
      (record) =>
        record.sessionId === input.sessionId &&
        record.runId === input.runId &&
        record.admission === 'accepted' &&
        !record.resultRecorded,
    );
  }

  markResultRecorded(record: LiveDelegationRecord): void {
    record.resultRecorded = true;
  }

  clear(): void {
    this.records.length = 0;
  }
}
