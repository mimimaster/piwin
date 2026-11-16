import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostResponse } from '@piwin/contracts';
import type { HostClient } from '../host/host-client.js';
import { globalMemoryGovernor } from '../notes/memory-governor.js';
import { getDisposableCache } from '../notes/cache-budget.js';
import { collectReclaimCandidates, releaseReclaimCandidate } from '../notes/reclaim-candidates.js';
import { desktopMetrics } from '../run-activity/diagnostic-metrics.js';
import { createHostToolOutputReader } from './tool-output-reader.js';

const CACHE_NAME = 'historicalToolOutputs';

function response(output = 'persisted output'): HostResponse {
  return { type: 'response', command: 'session/tool-output', success: true,
    data: { status: 'ready', output, truncated: false } };
}

function clearCache(): void {
  globalMemoryGovernor.reset();
  getDisposableCache(CACHE_NAME)?.applyBudget({
    ...globalMemoryGovernor.getDisposableBudget(CACHE_NAME), evictAll: true,
  });
}

beforeEach(clearCache);
afterEach(clearCache);

describe('historical tool output retention', () => {
  it('coalesces concurrent reads and reuses a recent result', async () => {
    let complete: ((value: HostResponse) => void) | undefined;
    const request = vi.fn<HostClient['request']>(() => new Promise(resolve => { complete = resolve; }));
    const read = createHostToolOutputReader(request, 'session');
    const first = read('message', 'tool');
    expect(read('message', 'tool')).toBe(first);
    if (complete === undefined) throw new Error('request did not start');
    complete(response());
    expect(await first).toMatchObject({ status: 'ready', output: 'persisted output' });
    await read('message', 'tool');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('evicts old outputs instead of keeping every expanded tool forever', async () => {
    const request = vi.fn<HostClient['request']>(async () => response());
    const read = createHostToolOutputReader(request, 'session');
    for (let index = 0; index < 100; index++) await read('message', `tool-${index}`);
    await read('message', 'tool-0');
    expect(request).toHaveBeenCalledTimes(101);
  });

  it('touches recent reads before evicting the oldest entry', async () => {
    const request = vi.fn<HostClient['request']>(async () => response());
    const read = createHostToolOutputReader(request, 'session');
    for (let index = 0; index < 64; index++) await read('message', `tool-${index}`);
    await read('message', 'tool-0');
    await read('message', 'tool-64');
    await read('message', 'tool-0');
    expect(request).toHaveBeenCalledTimes(65);
    await read('message', 'tool-1');
    expect(request).toHaveBeenCalledTimes(66);
  });

  it('returns an oversized result without retaining or truncating it', async () => {
    const output = 'x'.repeat(5 * 1024 * 1024);
    const request = vi.fn<HostClient['request']>(async () => response(output));
    const read = createHostToolOutputReader(request, 'session');
    expect(await read('message', 'tool')).toMatchObject({ output, truncated: false });
    await read('message', 'tool');
    expect(request).toHaveBeenCalledTimes(2);
    expect(desktopMetrics.collectObservability().cacheEstimates[CACHE_NAME]?.bytes).toBe(0);
  });

  it('bounds bytes across readers from different conversations', async () => {
    const request = vi.fn<HostClient['request']>(async () => response('x'.repeat(256 * 1024)));
    const first = createHostToolOutputReader(request, 'first');
    const second = createHostToolOutputReader(request, 'second');
    await first('message', 'old');
    for (let index = 0; index < 32; index++) await second('message', `tool-${index}`);
    await first('message', 'old');
    expect(request).toHaveBeenCalledTimes(34);
  });

  it('clears retained output under critical pressure without invalidating a visible result', async () => {
    const request = vi.fn<HostClient['request']>(async () => response());
    const read = createHostToolOutputReader(request, 'session');
    const visible = await read('message', 'tool');
    globalMemoryGovernor.setLevel('critical');
    expect(visible).toMatchObject({ status: 'ready', output: 'persisted output' });
    await read('message', 'tool');
    await read('message', 'tool');
    expect(request).toHaveBeenCalledTimes(3);
  });

  it('does not reinsert a late response after pressure clears the cache', async () => {
    let complete: ((value: HostResponse) => void) | undefined;
    const request = vi.fn<HostClient['request']>(() => new Promise(resolve => { complete = resolve; }));
    const read = createHostToolOutputReader(request, 'session');
    const pending = read('message', 'tool');
    globalMemoryGovernor.setLevel('critical');
    globalMemoryGovernor.reset();
    if (complete === undefined) throw new Error('request did not start');
    complete(response());
    await pending;
    const retry = read('message', 'tool');
    expect(request).toHaveBeenCalledTimes(2);
    if (complete === undefined) throw new Error('retry did not start');
    complete(response());
    await retry;
  });

  it('exposes retained bytes to the report and manual reclaim', async () => {
    const request = vi.fn<HostClient['request']>(async () => response());
    const read = createHostToolOutputReader(request, 'session');
    await read('message', 'tool');
    expect(desktopMetrics.collectObservability().cacheEstimates[CACHE_NAME]).toMatchObject({ entries: 1 });
    expect(collectReclaimCandidates()).toContainEqual(expect.objectContaining({ key: `cache:${CACHE_NAME}` }));
    await releaseReclaimCandidate(`cache:${CACHE_NAME}`, Date.now() + 1000);
    await read('message', 'tool');
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('keeps identical message/tool ids on different Hosts isolated', async () => {
    const first = createHostToolOutputReader(vi.fn(async () => response('host one')), 'same-session');
    const second = createHostToolOutputReader(vi.fn(async () => response('host two')), 'same-session');
    expect(await first('message', 'tool')).toMatchObject({ output: 'host one' });
    expect(await second('message', 'tool')).toMatchObject({ output: 'host two' });
  });

  it('retries a transient Host failure', async () => {
    const request = vi.fn<HostClient['request']>()
      .mockRejectedValueOnce(new Error('temporary disconnect'))
      .mockResolvedValue(response());
    const read = createHostToolOutputReader(request, 'session');
    expect(await read('message', 'tool')).toEqual({ status: 'unavailable' });
    expect(await read('message', 'tool')).toMatchObject({ status: 'ready' });
    expect(request).toHaveBeenCalledTimes(2);
  });
});
