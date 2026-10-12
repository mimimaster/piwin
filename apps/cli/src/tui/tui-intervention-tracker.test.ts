import type { HostCommand, HostResponse } from '@piwin/contracts';
import { describe, expect, it, vi } from 'vitest';
import { steer } from './queue-strip.fixture.js';
import { TuiInterventionTracker, applyIntervention } from './tui-intervention-tracker.js';
import type { TuiHostLink } from './tui-host-link.js';

function tracker(response: Record<string, unknown> = {}) {
  const sent: HostCommand[] = [];
  const request = async (command: HostCommand): Promise<HostResponse> => {
    sent.push(command);
    return { type: 'response', command: command.type, success: true, data: response } as HostResponse;
  };
  const options = {
    link: { request } as unknown as TuiHostLink,
    getSessionId: () => 's1',
    getRunId: () => 'r1' as string | undefined,
    onChanged: vi.fn(),
    onHint: vi.fn(),
    onError: vi.fn(),
    onApplied: vi.fn(),
    requeue: vi.fn(async () => 2),
  };
  return { tracker: new TuiInterventionTracker(options), options, sent };
}

describe('applyIntervention', () => {
  it('keeps the newest revision and drops finished records', () => {
    const newer = { ...steer('i1', 'applying'), revision: 3 };
    expect(applyIntervention([newer], steer('i1', 'pending'))).toEqual([newer]);
    expect(applyIntervention([newer], { ...steer('i1', 'applied'), revision: 4 })).toEqual([]);
  });
});

describe('TuiInterventionTracker', () => {
  it('submits a steer into the running turn and keeps it out of the transcript until applied', async () => {
    const { tracker: t, options, sent } = tracker({ intervention: steer('i1', 'pending') });
    expect(await t.submit({ text: '先看测试' })).toBe(true);
    expect(sent[0]).toMatchObject({ type: 'run/intervention-submit', sessionId: 's1', runId: 'r1', input: { text: '先看测试' } });
    expect(t.list()).toHaveLength(1);
    expect(options.onApplied).not.toHaveBeenCalled();
    t.handlePush({ type: 'run/intervention-updated', intervention: { ...steer('i1', 'applied'), revision: 2 } } as never);
    t.handlePush({ type: 'run/intervention-updated', intervention: { ...steer('i1', 'applied'), revision: 3 } } as never);
    expect(t.list()).toHaveLength(0);
    expect(options.onApplied).toHaveBeenCalledTimes(1);
    expect(options.onApplied.mock.calls[0]?.[1]).toEqual(['已插入']);
  });

  it('refuses without a running turn', async () => {
    const { tracker: t, options } = tracker();
    options.getRunId = () => undefined;
    expect(await t.submit({ text: 'x' })).toBe(false);
    expect(options.onHint).toHaveBeenCalled();
  });

  it('ignores other sessions, keeps a failed steer and re-queues it', async () => {
    const { tracker: t, options } = tracker();
    expect(t.handlePush({ type: 'run/intervention-updated', intervention: { ...steer('i9', 'pending'), sessionId: 's2' } } as never)).toBe(true);
    expect(t.list()).toHaveLength(0);
    const failed = steer('i1', 'expired');
    t.handlePush({ type: 'run/intervention-updated', intervention: failed } as never);
    expect(t.list()).toEqual([failed]);
    await t.requeue(failed);
    expect(options.requeue).toHaveBeenCalledWith('s1', failed.input);
    expect(t.list()).toHaveLength(0);
    expect(options.onHint).toHaveBeenCalledWith('已改为排队（第 2 条）');
  });

  it('cancels a pending steer on the Host and simply removes a finished one', async () => {
    const { tracker: t, sent } = tracker({ intervention: { ...steer('i1', 'cancelled'), revision: 2 } });
    t.adopt(steer('i1', 'pending'));
    await t.cancel(steer('i1', 'pending'));
    expect(sent[0]).toMatchObject({ type: 'run/intervention-cancel', interventionId: 'i1', expectedRevision: 1 });
    expect(t.list()).toHaveLength(0);
    t.adopt(steer('i2', 'failed'));
    await t.cancel(steer('i2', 'failed'));
    expect(sent).toHaveLength(1);
    expect(t.list()).toHaveLength(0);
  });
});
