import { describe, expect, it } from 'vitest';
import { LiveDelegationLedger } from './live-delegation-ledger.js';

describe('LiveDelegationLedger', () => {
  it('matches two delegations without crossing results', () => {
    const ledger = new LiveDelegationLedger();
    ledger.remember({
      callId: 'c1',
      providerDelegationId: 'd1',
      sessionId: 's1',
      messageId: 'm1',
      runId: 'r1',
      admission: 'accepted',
      resultDelivered: false,
    });
    ledger.remember({
      callId: 'c1',
      providerDelegationId: 'd2',
      sessionId: 's1',
      messageId: 'm2',
      runId: 'r2',
      admission: 'accepted',
      resultDelivered: false,
    });
    const first = ledger.findForTurn({ sessionId: 's1', runId: 'r1' });
    expect(first?.providerDelegationId).toBe('d1');
    ledger.markDelivered(first!);
    expect(ledger.findForTurn({ sessionId: 's1', runId: 'r1' })).toBeUndefined();
    expect(ledger.findForTurn({ sessionId: 's1', runId: 'r2' })?.providerDelegationId).toBe('d2');
  });

  it('binds a queued run id later', () => {
    const ledger = new LiveDelegationLedger();
    ledger.remember({
      callId: 'c1',
      providerDelegationId: 'd1',
      sessionId: 's1',
      messageId: 'm1',
      queueId: 'q1',
      admission: 'accepted',
      resultDelivered: false,
    });
    ledger.bindRunId({ sessionId: 's1', queueId: 'q1', runId: 'r-late' });
    expect(ledger.findForTurn({ sessionId: 's1', runId: 'r-late' })?.messageId).toBe('m1');
  });
});
