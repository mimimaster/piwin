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
      resultRecorded: false,
    });
    ledger.remember({
      callId: 'c1',
      providerDelegationId: 'd2',
      sessionId: 's1',
      messageId: 'm2',
      runId: 'r2',
      admission: 'accepted',
      resultRecorded: false,
    });
    const first = ledger.findForTurn({ sessionId: 's1', runId: 'r1' });
    expect(first?.providerDelegationId).toBe('d1');
    ledger.markResultRecorded(first!);
    expect(ledger.findForTurn({ sessionId: 's1', runId: 'r1' })).toBeUndefined();
    expect(ledger.findForTurn({ sessionId: 's1', runId: 'r2' })?.providerDelegationId).toBe('d2');
  });

  it('scopes review context to one session', () => {
    const ledger = new LiveDelegationLedger();
    ledger.remember({
      callId: 'c1',
      providerDelegationId: 'd1',
      sessionId: 's1',
      messageId: 'm1',
      admission: 'accepted',
      resultRecorded: false,
      brief: 'from s1',
    });
    ledger.remember({
      callId: 'c1',
      providerDelegationId: 'd2',
      sessionId: 's2',
      messageId: 'm2',
      admission: 'accepted',
      resultRecorded: false,
      brief: 'from s2',
    });
    expect(ledger.contextForSession('s2').map((task) => task.brief)).toEqual(['from s2']);
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
      resultRecorded: false,
      brief: 'queued work',
    });
    expect(ledger.contextForSession('s1')[0]?.status).toBe('queued');
    ledger.bindRunId({ sessionId: 's1', queueId: 'q1', runId: 'r-late' });
    expect(ledger.findForTurn({ sessionId: 's1', runId: 'r-late' })?.messageId).toBe('m1');
    expect(ledger.contextForSession('s1')[0]?.status).toBe('working');
  });
});
