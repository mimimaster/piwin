import { describe, expect, it, vi } from 'vitest';
import { LiveIntendedSessionGate } from './live-intended-session-gate.js';
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

  it('rejects filler-only ASR leftovers', async () => {
    const prompt = {
      admitVoiceDelegation: vi.fn(),
    };
    const port = createVoiceDelegationAdmission({
      busy: { isSessionBusy: () => false },
      prompt,
    });
    const result = await port.admit({
      callId: 'c1',
      sessionId: 's1',
      instruction: '[clear throat] 噢。',
      providerDelegationId: 'd-filler',
    });
    expect(result).toEqual({ status: 'rejected', reason: 'live-delegation-rejected' });
    expect(prompt.admitVoiceDelegation).not.toHaveBeenCalled();
  });

  it('preserves the reviewed brief including negation before prompting', async () => {
    const prompt = {
      admitVoiceDelegation: vi.fn(async () => ({
        queued: false as const,
        runId: 'r-search',
        messageId: 'm-search',
      })),
    };
    const port = createVoiceDelegationAdmission({
      busy: { isSessionBusy: () => false },
      prompt,
    });
    const result = await port.admit({
      callId: 'c1',
      sessionId: 's1',
      instruction: '不是删除文件，只查清楚问题，不要修改',
      providerDelegationId: 'd-spoken',
    });
    expect(result.status).toBe('accepted');
    expect(prompt.admitVoiceDelegation).toHaveBeenCalledWith(
      expect.objectContaining({ instruction: '不是删除文件，只查清楚问题，不要修改' }),
    );
  });

  it('passes queue=true when session busy', async () => {
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

  it('holds when intended session is empty', async () => {
    const prompt = { admitVoiceDelegation: vi.fn() };
    const gate = new LiveIntendedSessionGate();
    gate.set('c1', null);
    const port = createVoiceDelegationAdmission({
      busy: { isSessionBusy: () => false },
      prompt,
      intended: gate,
    });
    const result = await port.admit({
      callId: 'c1',
      sessionId: 'session-a',
      instruction: '随便生成一张图片',
      providerDelegationId: 'item_EJE3',
    });
    expect(result).toEqual({
      status: 'rejected',
      reason: 'live-delegation-held-empty',
    });
    expect(prompt.admitVoiceDelegation).not.toHaveBeenCalled();
  });

  it('holds when intended session mismatches the bound session', async () => {
    const prompt = { admitVoiceDelegation: vi.fn() };
    const gate = new LiveIntendedSessionGate();
    gate.set('c1', 'session-b');
    const port = createVoiceDelegationAdmission({
      busy: { isSessionBusy: () => false },
      prompt,
      intended: gate,
    });
    const result = await port.admit({
      callId: 'c1',
      sessionId: 'session-a',
      instruction: '随便生成一张图片',
      providerDelegationId: 'd2',
    });
    expect(result).toEqual({
      status: 'rejected',
      reason: 'live-delegation-held-mismatch',
    });
    expect(prompt.admitVoiceDelegation).not.toHaveBeenCalled();
  });

  it('still admits STOP_CURRENT_RUN while held', async () => {
    const prompt = {
      admitVoiceDelegation: vi.fn(async () => ({
        queued: false as const,
        runId: 'r-stop',
        messageId: 'm-stop',
      })),
    };
    const gate = new LiveIntendedSessionGate();
    gate.set('c1', null);
    const port = createVoiceDelegationAdmission({
      busy: { isSessionBusy: () => false },
      prompt,
      intended: gate,
    });
    const result = await port.admit({
      callId: 'c1',
      sessionId: 'session-a',
      instruction: 'STOP_CURRENT_RUN',
      providerDelegationId: 'stop-1',
    });
    expect(result.status).toBe('accepted');
    expect(prompt.admitVoiceDelegation).toHaveBeenCalledTimes(1);
  });
});
