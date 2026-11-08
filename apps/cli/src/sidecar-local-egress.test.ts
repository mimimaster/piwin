import { describe, expect, it } from 'vitest';
import type { HostPush, HostPushBatchFrame, HostPushFrame } from '@piwin/contracts';
import { HostEgressHub } from '@piwin/host-server';
import { attachSidecarLocalEgress } from './sidecar-local-egress.js';

const STATUS_PUSH: HostPush = { type: 'host/status', mode: 'sdk', ready: true, mock: false };

function jobLogPush(text: string, cursor: number): HostPush {
  return {
    type: 'job/log',
    chunk: { jobId: 'job-1', stream: 'stdout', text, at: '2026-09-28T05:05:20.000Z', cursor },
  };
}

function transcriptAppendPush(sessionId: string, id: string): HostPush {
  return {
    type: 'transcript/append',
    sessionId,
    message: {
      id,
      role: 'assistant',
      text: `text-${id}`,
      createdAt: '2026-09-28T05:05:20.000Z',
      status: 'done',
    },
  };
}

function createHarness(hydration?: (sessionIds: string[], fenceSeq: number) => Promise<HostPushFrame | null>) {
  const hub = new HostEgressHub({ hostInstanceId: 'host-1', maxFrameBytes: 4 * 1024 });
  const frames: HostPushBatchFrame[] = [];
  const sentMessages: Array<HostPushFrame | HostPushBatchFrame> = [];
  const logs: string[] = [];
  const reattachCallbacks: Array<() => void> = [];
  const egress = attachSidecarLocalEgress({
    egressHub: hub,
    clientId: 'local-jsonl',
    canSend: () => true,
    send: (message: HostPushFrame | HostPushBatchFrame) => {
      sentMessages.push(message);
      if (message.type === 'push/batch') frames.push(message);
    },
    maxQueueBytes: 256 * 1024 * 1024,
    maxQueueItems: 200_000,
    log: (line) => logs.push(line),
    onReattached: () => hub.ingest(STATUS_PUSH),
    scheduleReattach: (callback) => reattachCallbacks.push(callback),
    ...(hydration === undefined ? {} : { hydration }),
  });
  return { hub, frames, sentMessages, logs, egress, reattachCallbacks };
}

function deliveredPushTypes(frames: HostPushBatchFrame[]): string[] {
  return frames.flatMap((frame) => frame.items.map((item) => item.push.type));
}

function deliveredSessionItems(frames: HostPushBatchFrame[]): string[] {
  return frames.flatMap((frame) =>
    frame.items
      .map((item) => item.push)
      .filter(
        (push): push is Extract<HostPush, { type: 'transcript/append' }> =>
          push.type === 'transcript/append',
      )
      .map((push) => push.sessionId),
  );
}

describe('attachSidecarLocalEgress', () => {
  it('re-attaches after an oversized append so Desktop sees a gap instead of silence', () => {
    const { hub, frames, logs, egress, reattachCallbacks } = createHarness();

    hub.ingest(STATUS_PUSH);
    hub.flush();
    const appliedCursor = frames.at(-1)?.throughSeq ?? 0;
    expect(appliedCursor).toBeGreaterThan(0);

    // Incident shape: one job/log append larger than the frame budget.
    hub.ingest(jobLogPush('x'.repeat(8 * 1024), 1));
    hub.flush();
    expect(logs.some((line) => line.includes('local egress closed: oversized-item'))).toBe(true);
    expect(
      logs.some((line) => line.includes('push=job/log') && line.includes('key=job/job-1/log')),
    ).toBe(true);
    const framesBeforeReattach = frames.length;

    // Before the fix every later push was dropped for the Host lifetime.
    expect(reattachCallbacks).toHaveLength(1);
    reattachCallbacks.shift()?.();
    hub.flush();
    expect(egress.getReattachCount()).toBe(1);

    hub.ingest(jobLogPush('small', 2));
    hub.flush();
    egress.flushNow();

    const delivered = frames.slice(framesBeforeReattach);
    expect(delivered.length).toBeGreaterThan(0);
    const firstAfter = delivered[0];
    // afterSeq beyond Desktop's applied cursor is the gap Desktop reconciles.
    expect(firstAfter?.afterSeq).toBeGreaterThan(appliedCursor);
    const deliveredTypes = delivered.flatMap((frame) => frame.items.map((item) => item.push.type));
    expect(deliveredTypes).toContain('host/status');
    expect(deliveredTypes).toContain('job/log');
  });

  it('does not re-attach after dispose', () => {
    const { hub, egress, reattachCallbacks } = createHarness();
    hub.ingest(jobLogPush('x'.repeat(8 * 1024), 1));
    hub.flush();
    egress.dispose();
    reattachCallbacks.shift()?.();
    expect(egress.getReattachCount()).toBe(0);
  });
});

describe('applySubscriptions', () => {
  it('filters live pushes to subscribed sessions and replays the fence tail', async () => {
    const { hub, frames, egress } = createHarness();

    const { fenceSeq } = await egress.applySubscriptions(
      { sessionIds: ['session-a'] },
      1,
    );
    expect(fenceSeq).toBe(hub.getCurrentSeq());

    // Post-fence pushes are covered by the replay tail inside the paused
    // window; here they arrive after apply → live path through the filter.
    const baseline = frames.length;
    hub.ingest(transcriptAppendPush('session-a', 'm3'));
    hub.ingest(transcriptAppendPush('session-b', 'm4'));
    hub.ingest(STATUS_PUSH);
    hub.flush();
    egress.flushNow();
    const live = frames.slice(baseline);
    expect(deliveredSessionItems(live)).toEqual(['session-a']);
    expect(deliveredPushTypes(live)).toContain('host/status');
  });

  it('replay tail redelivers post-fence records through the new filter', async () => {
    let releaseGate: () => void = () => undefined;
    const hydrationGate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const { hub, frames, egress } = createHarness((sessionIds, fenceSeq) =>
      hydrationGate.then(() => {
        void sessionIds;
        return Promise.resolve({
          type: 'push' as const,
          seq: fenceSeq,
          eventId: 'hydration-gated',
          push: STATUS_PUSH,
        });
      }),
    );

    await egress.applySubscriptions({ sessionIds: ['session-a'] }, 1);
    const applying = egress.applySubscriptions({ sessionIds: ['session-a', 'session-b'] }, 2);
    // Serialized applies: rev2 queues behind rev1's completed apply, so its
    // fence is read AFTER the two ingests below. session-a lands live through
    // rev1's filter; session-b is correctly dropped by rev1's filter (it was
    // not subscribed at ingest time) and needs no replay because rev2's fence
    // is taken before its filter is installed — a tighter guarantee than the
    // unserialized version this test originally described.
    hub.ingest(transcriptAppendPush('session-a', 'm8'));
    hub.ingest(transcriptAppendPush('session-b', 'm9'));
    hub.flush();
    releaseGate();
    const { fenceSeq } = await applying;
    expect(fenceSeq).toBe(2);
    egress.flushNow();

    const delivered = deliveredSessionItems(frames);
    expect(delivered).toContain('session-a');
    expect(delivered).toContain('session-b');
  });

  it('caps interest sets at LIVE_SUBSCRIPTION_MAX_SESSION_IDS and dedupes', async () => {
    const { hub, frames, egress } = createHarness();
    const ids = Array.from({ length: 12 }, (_, index) => `session-${index}`);
    ids.push('session-0'); // duplicate
    await egress.applySubscriptions({ sessionIds: ids }, 1);

    for (let index = 0; index < 12; index += 1) {
      hub.ingest(transcriptAppendPush(`session-${index}`, `m-${index}`));
    }
    hub.flush();
    egress.flushNow();

    const delivered = new Set(deliveredSessionItems(frames));
    // Sessions 0..7 pass; 8..11 are beyond the cap.
    for (let index = 0; index < 8; index += 1) {
      expect(delivered.has(`session-${index}`)).toBe(true);
    }
    for (let index = 8; index < 12; index += 1) {
      expect(delivered.has(`session-${index}`)).toBe(false);
    }
  });

  it('confirmed filter survives a channel re-attach', async () => {
    const { hub, frames, egress, reattachCallbacks } = createHarness();
    await egress.applySubscriptions({ sessionIds: ['session-a'] }, 1);

    // Oversized append closes the channel; re-attach recreates it.
    hub.ingest(jobLogPush('x'.repeat(8 * 1024), 1));
    hub.flush();
    expect(reattachCallbacks).toHaveLength(1);
    reattachCallbacks.shift()?.();
    expect(egress.getReattachCount()).toBe(1);

    const baseline = frames.length;
    hub.ingest(transcriptAppendPush('session-a', 'm5'));
    hub.ingest(transcriptAppendPush('session-b', 'm6'));
    hub.flush();
    egress.flushNow();
    const live = frames.slice(baseline);
    expect(deliveredSessionItems(live)).toEqual(['session-a']);
  });

  it('sends the hydration frame before the filter swap for newly added ids', async () => {
    const hydrationCalls: Array<{ sessionIds: string[]; fenceSeq: number }> = [];
    const { hub, frames, sentMessages, egress } = createHarness((sessionIds, fenceSeq) => {
      hydrationCalls.push({ sessionIds, fenceSeq });
      return Promise.resolve({
        type: 'push',
        seq: fenceSeq,
        eventId: 'hydration-1',
        push: STATUS_PUSH,
      });
    });

    // First apply: no previous filter → no added ids → no hydration.
    await egress.applySubscriptions({ sessionIds: ['session-a'] }, 1);
    expect(hydrationCalls).toHaveLength(0);

    // Second apply adds session-b → hydration for added ids only.
    await egress.applySubscriptions({ sessionIds: ['session-a', 'session-b'] }, 2);
    expect(hydrationCalls).toHaveLength(1);
    expect(hydrationCalls[0]?.sessionIds).toEqual(['session-b']);
    expect(hydrationCalls[0]?.fenceSeq).toBe(hub.getCurrentSeq());

    // Hydration was delivered directly through send(), before any replay batch.
    const hydrationIndex = sentMessages.findIndex(
      (message) => message.type === 'push' && message.eventId === 'hydration-1',
    );
    const firstBatchIndex = sentMessages.findIndex((message) => message.type === 'push/batch');
    expect(hydrationIndex).toBeGreaterThanOrEqual(0);
    expect(firstBatchIndex === -1 || hydrationIndex < firstBatchIndex).toBe(true);

    // Filter is live for both ids now.
    const baseline = frames.length;
    hub.ingest(transcriptAppendPush('session-a', 'ha'));
    hub.ingest(transcriptAppendPush('session-b', 'hb'));
    hub.flush();
    egress.flushNow();
    expect(deliveredSessionItems(frames.slice(baseline))).toEqual(['session-a', 'session-b']);
  });

  it('unpauses the channel when hydration fails', async () => {
    const { hub, frames, egress } = createHarness(() =>
      Promise.reject(new Error('hydration boom')),
    );
    await egress.applySubscriptions({ sessionIds: ['session-a'] }, 1);
    await expect(
      egress.applySubscriptions({ sessionIds: ['session-b'] }, 2),
    ).rejects.toThrow('hydration boom');

    // Channel must be unpaused: later live pushes still flow.
    hub.ingest(STATUS_PUSH);
    hub.flush();
    egress.flushNow();
    expect(deliveredPushTypes(frames)).toContain('host/status');
  });

  it('empty interest set blocks session pushes but keeps global ones', async () => {
    const { hub, frames, egress } = createHarness();
    await egress.applySubscriptions({ sessionIds: ['session-a'] }, 1);
    await egress.applySubscriptions({ sessionIds: [] }, 2);

    const baseline = frames.length;
    hub.ingest(transcriptAppendPush('session-a', 'm7'));
    hub.ingest(STATUS_PUSH);
    hub.flush();
    egress.flushNow();
    const live = frames.slice(baseline);
    expect(deliveredSessionItems(live)).toEqual([]);
    expect(deliveredPushTypes(live)).toContain('host/status');
  });
});
