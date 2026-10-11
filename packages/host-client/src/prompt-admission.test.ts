import { describe, expect, it, vi } from 'vitest';
import type { HostResponse } from '@piwin/contracts';
import { requestPromptWithForeground } from './prompt-admission.js';

const refused = (reason: 'active' | 'transitioning' | 'changed', runId?: string): HostResponse => ({
  type: 'response',
  command: 'session/prompt',
  success: false,
  error: `foreground-run-mismatch: ${reason}`,
  problem: {
    code: 'foreground-run-mismatch',
    data: runId === undefined ? { reason } : { reason, actualRun: { runId } },
  },
});

const queued: HostResponse = {
  type: 'response',
  command: 'session/queued-turn-submit',
  success: true,
  data: { queuedTurn: { queuedTurnId: 'q-1' } },
};

describe('requestPromptWithForeground with queueWhenBusy', () => {
  it.each([
    ['active', 'run-1'],
    ['transitioning', undefined],
  ] as const)('queues a %s refusal without asking', async (reason, runId) => {
    const request = vi.fn(async (_command: { foreground: unknown }) => refused(reason, runId));
    const onQueue = vi.fn(async () => queued);
    const resolveBusy = vi.fn();
    const response = await requestPromptWithForeground({
      request,
      sessionId: 's-1',
      input: { text: '紧接着的一条' },
      queueWhenBusy: true,
      onQueue,
      resolveBusy,
    });
    expect(response).toBe(queued);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[0]).toMatchObject({ foreground: { kind: 'if-idle' } });
    expect(onQueue).toHaveBeenCalledTimes(1);
    expect(resolveBusy).not.toHaveBeenCalled();
  });

  it('does not queue a refusal that is not about a busy session', async () => {
    const first = refused('changed', 'run-2');
    const onQueue = vi.fn(async () => queued);
    const response = await requestPromptWithForeground({
      request: async () => first,
      sessionId: 's-1',
      input: { text: 'x' },
      queueWhenBusy: true,
      onQueue,
    });
    expect(response).toBe(first);
    expect(onQueue).not.toHaveBeenCalled();
  });

  it('leaves the choice to the caller without queueWhenBusy', async () => {
    const first = refused('active', 'run-1');
    const onQueue = vi.fn(async () => queued);
    const response = await requestPromptWithForeground({
      request: async () => first,
      sessionId: 's-1',
      input: { text: 'x' },
      onQueue,
    });
    expect(response).toBe(first);
    expect(onQueue).not.toHaveBeenCalled();
  });
});
