import { describe, expect, it, vi } from 'vitest';
import type { HostCommand, HostResponse } from '@piwin/contracts';
import { nativeHistorySyncFailure, syncNativeHistory } from './native-history-sync.js';

function host(response: HostResponse | Error) {
  return { request: vi.fn(async (_command: HostCommand): Promise<HostResponse> => {
    if (response instanceof Error) throw response;
    return response;
  }) };
}

describe('syncNativeHistory', () => {
  it('asks the Host to replay the agent history', async () => {
    const target = host({ type: 'response', command: 'agents/cli-sync', success: true, data: {} } as HostResponse);
    await expect(syncNativeHistory(target, 'grok-1')).resolves.toEqual({ ok: true });
    expect(target.request).toHaveBeenCalledWith({ type: 'agents/cli-snapshot', sessionId: 'grok-1' });
  });

  it('reports a refused replay', async () => {
    const target = host({ type: 'response', command: 'agents/cli-sync', success: false, error: 'history unavailable' } as HostResponse);
    await expect(syncNativeHistory(target, 'grok-1')).resolves.toEqual({ ok: false, error: 'history unavailable' });
  });

  it('settles when the replay outlives the request timeout', async () => {
    await expect(syncNativeHistory(host(new Error('Host request timed out')), 'grok-1'))
      .resolves.toEqual({ ok: false, error: 'Host request timed out' });
  });
});

it('names the failure so an empty transcript is not mistaken for a new conversation', () => {
  expect(nativeHistorySyncFailure('zh-CN', 'x')).toContain('历史');
  expect(nativeHistorySyncFailure('en', 'x')).toContain('history');
});
