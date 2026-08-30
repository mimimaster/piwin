const LIVE_DELEGATION_LEDGER_MAX = 64;

export type LiveDelegationRecord = {
  callId: string;
  providerDelegationId: string;
  sessionId: string;
  messageId: string;
  queueId?: string;
  runId?: string;
  admission: 'accepted' | 'rejected';
  resultDelivered: boolean;
};

export class LiveDelegationLedger {
  private readonly records: LiveDelegationRecord[] = [];

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
            : Boolean(item.queueId)),
    );
    if (record) record.runId = input.runId;
  }

  findForTurn(input: { sessionId: string; runId: string }): LiveDelegationRecord | undefined {
    return this.records.find(
      (record) =>
        record.sessionId === input.sessionId &&
        record.runId === input.runId &&
        record.admission === 'accepted' &&
        !record.resultDelivered,
    );
  }

  markDelivered(record: LiveDelegationRecord): void {
    record.resultDelivered = true;
  }

  clear(): void {
    this.records.length = 0;
  }
}
