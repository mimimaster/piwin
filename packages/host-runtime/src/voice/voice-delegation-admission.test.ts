import { describe, expect, it, vi } from 'vitest';
import { createVoiceDelegationAdmission } from './voice-delegation-admission.js';

describe('createVoiceDelegationAdmission', () => {
  it('is idempotent on providerDelegationId', async () => {
    const prompt = {
      admitVoiceDelegation: vi.fn(async () => ({
        queued: false as const,
        runId: 'r1',
        messageId: 'm1',
      })),
    };
    const port = createVoiceDelegationAdmission({
      busy: { isSessionBusy: () => false },
      prompt,
    });

    const first = await port.admit({
      callId: 'c1',
      sessionId: 's1',
      instruction: 'do it',
      providerDelegationId: 'd1',
    });
    const second = await port.admit({
      callId: 'c1',
      sessionId: 's1',
      instruction: 'do it again',
      providerDelegationId: 'd1',
    });
    expect(first).toEqual(second);
    expect(prompt.admitVoiceDelegation).toHaveBeenCalledTimes(1);
  });

  it('queues when session busy', async () => {
    const prompt = {
      admitVoiceDelegation: vi.fn(async () => ({
        queued: true as const,
        queuedTurnId: 'qt-c1-d2',
        messageId: 'm2',
      })),
    };
    const port = createVoiceDelegationAdmission({
      busy: { isSessionBusy: () => true },
      prompt,
    });
    const result = await port.admit({
      callId: 'c1',
      sessionId: 's1',
      instruction: 'queued work',
      providerDelegationId: 'd2',
    });
    expect(result.status).toBe('accepted');
    if (result.status === 'accepted') expect(result.queued).toBe(true);
    expect(prompt.admitVoiceDelegation).toHaveBeenCalledWith(
      expect.objectContaining({ queue: true }),
    );
  });

  it('retries after a transient prompt failure instead of sticky-rejecting', async () => {
    const prompt = {
      admitVoiceDelegation: vi
        .fn()
        .mockRejectedValueOnce(new Error('session-busy-race'))
        .mockResolvedValueOnce({ queued: false, runId: 'r3', messageId: 'm3' }),
    };
    const port = createVoiceDelegationAdmission({
      busy: { isSessionBusy: () => false },
      prompt,
    });
    const input = {
      callId: 'c1',
      sessionId: 's1',
      instruction: 'retry me',
      providerDelegationId: 'd3',
    };
    const first = await port.admit(input);
    expect(first.status).toBe('rejected');
    const second = await port.admit(input);
    expect(second.status).toBe('accepted');
    if (second.status === 'accepted') {
      expect(second.queued).toBe(false);
      if (!second.queued) expect(second.runId).toBe('r3');
    }
    expect(prompt.admitVoiceDelegation).toHaveBeenCalledTimes(2);
  });
});
