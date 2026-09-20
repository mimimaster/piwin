import { afterEach, describe, expect, it, vi } from 'vitest';
import { PIWIN_LIVE_STOP_INSTRUCTION, type LiveDelegationDecision, type LiveDelegationReviewer, type LiveOwnerActionPush } from '@piwin/contracts';
import { makeLiveCoordinator } from './live-coordinator-test-harness.js';
import { reviewLiveDelegation } from './review-live-delegation.js';
import type { LiveDelegationAdmissionPort } from './live-call-types.js';

async function setup(review: LiveDelegationReviewer) {
  const actions: LiveOwnerActionPush[] = [];
  const admit = vi.fn<LiveDelegationAdmissionPort['admit']>(async () => ({ status: 'accepted', queued: false, runId: 'run', messageId: 'message' }));
  const coordinator = makeLiveCoordinator({ review, admission: { admit }, pushOwnerAction: (action) => actions.push(action) });
  const started = await coordinator.start({ sessionId: 's1', providerId: 'openai-codex', settingsRevision: 1,
    idempotencyKey: 'test', ownerDeviceId: 'owner', bootstrap: { mediaDriverId: 'codex-webrtc-v1', offerSdp: 'v=0\n' },
    signal: new AbortController().signal });
  if (!started.ok) throw new Error(started.errorCode);
  const send = (id: string, instruction: string) => coordinator.reportOwnerEvent({
    callId: started.call.callId, ownerDeviceId: 'owner', event: { type: 'delegation', providerDelegationId: id, instruction },
  });
  const settled = (id: string) => vi.waitFor(() => expect(actions.some((action) => action.providerDelegationId === id)).toBe(true));
  return { coordinator, actions, admit, send, settled };
}

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('Host intent admission regressions', () => {
  // These fixtures test enforcement; model-quality evaluation is separate.
  it.each([
    ['不用确认啦', 'conversation'], ['另外,说已经出来了', 'conversation'],
    ['哇,一张醍醐- 骑自行车的...HTML动画', 'clarify'],
  ] as const)('never creates work for %s', async (instruction, kind) => {
    const review = vi.fn(async (): Promise<LiveDelegationDecision> => ({ kind }));
    const fixture = await setup(review);
    fixture.send('candidate', instruction);
    await fixture.settled('candidate');
    fixture.send('candidate', instruction);
    expect(fixture.admit).not.toHaveBeenCalled();
    expect(review).toHaveBeenCalledTimes(1);
    expect(fixture.actions).toMatchObject([
      { action: 'ack-delegation', ok: false },
      { action: 'append-context', channel: kind === 'conversation' ? 'commentary' : 'speakable' },
    ]);
    await fixture.coordinator.dispose();
  });

  it('reuses the result under new event IDs even after completion, but allows explicit repeats and changes', async () => {
    const review = vi.fn<LiveDelegationReviewer>()
      .mockResolvedValueOnce({ kind: 'work', brief: '制作骑车动画' })
      .mockResolvedValueOnce({ kind: 'reuse', delegationId: 'first' })
      .mockResolvedValueOnce({ kind: 'work', brief: '制作骑车动画' })
      .mockResolvedValueOnce({ kind: 'repeat', brief: '制作骑车动画' })
      .mockResolvedValueOnce({ kind: 'work', brief: '背景改成白天，不要日落' });
    const fixture = await setup(review);
    fixture.send('first', '帮我做一个骑车动画'); await fixture.settled('first');
    fixture.coordinator.notifyBoundSessionTurnEnded({ sessionId: 's1', runId: 'run', kind: 'session-turn', status: 'completed', assistantText: '已生成骑车动画代码。' });
    for (const [id, instruction] of [['second', '已经出来了吗'], ['third', '骑车动画'], ['repeat', '再做一版'], ['change', '改成白天']]) {
      if (!id || !instruction) throw new Error('invalid fixture');
      fixture.send(id, instruction); await fixture.settled(id);
    }
    expect(fixture.admit).toHaveBeenCalledTimes(3);
    expect(review.mock.calls[1]?.[0].tasks).toMatchObject([{ delegationId: 'first', status: 'completed', result: expect.stringContaining('已生成骑车动画代码') }]);
    const reusedResult = fixture.actions.find(
      (action) => action.action === 'append-context' && action.providerDelegationId === 'second',
    )?.content;
    expect(reusedResult).toContain('did run');
    expect(reusedResult).toContain('已生成骑车动画代码');
    expect(fixture.admit.mock.calls.at(-1)?.[0]).toMatchObject({ instruction: '背景改成白天，不要日落' });
    await fixture.coordinator.dispose();
  });

  it('serializes concurrent candidates so the next review sees admitted work', async () => {
    let release: ((value: LiveDelegationDecision) => void) | undefined;
    const review = vi.fn<LiveDelegationReviewer>()
      .mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }))
      .mockResolvedValue({ kind: 'reuse', delegationId: 'first' });
    const fixture = await setup(review);
    fixture.send('first', '做动画'); fixture.send('second', '做动画');
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    expect(fixture.admit).not.toHaveBeenCalled(); expect(review).toHaveBeenCalledTimes(1);
    release?.({ kind: 'work', brief: '制作动画' }); await fixture.settled('second');
    expect(fixture.admit).toHaveBeenCalledTimes(1);
    expect(review.mock.calls[1]?.[0].tasks).toMatchObject([{ delegationId: 'first', status: 'working' }]);
    expect(fixture.actions.find(
      (action) => action.action === 'append-context' && action.providerDelegationId === 'second',
    )?.content).toContain('did start');
    await fixture.coordinator.dispose();
  });

  it.each(['hangup', 'stop'] as const)('cancels pending reviews on %s and discards late work', async (action) => {
    let release: ((value: LiveDelegationDecision) => void) | undefined;
    const review = vi.fn<LiveDelegationReviewer>(() => new Promise((resolve) => { release = resolve; }));
    const fixture = await setup(review);
    fixture.send('slow', '做动画'); fixture.send('queued', '改成白天');
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    if (action === 'hangup') await fixture.coordinator.end({ ownerDeviceId: 'owner' });
    else { fixture.send('stop', PIWIN_LIVE_STOP_INSTRUCTION); await fixture.settled('stop'); }
    release?.({ kind: 'work', brief: '迟到的任务' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(review).toHaveBeenCalledTimes(1);
    expect(fixture.admit).toHaveBeenCalledTimes(action === 'stop' ? 1 : 0);
    if (action === 'stop') expect(fixture.admit.mock.calls[0]?.[0]).toMatchObject({ instruction: PIWIN_LIVE_STOP_INSTRUCTION });
    await fixture.coordinator.dispose();
  });

  it('fails closed and does not automatically retry a broken model', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fixture = await setup(async () => { throw new Error('provider unavailable'); });
    fixture.send('broken', '做动画'); await fixture.settled('broken');
    fixture.send('broken', '做动画');
    expect(fixture.admit).not.toHaveBeenCalled();
    expect(fixture.actions).toHaveLength(2);
    expect(fixture.actions[1]?.content).toContain('verification was unavailable');
    await fixture.coordinator.dispose();
  });

  it('counts queue time against the deadline and never admits an expired decision', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(0);
    let release: ((value: LiveDelegationDecision) => void) | undefined;
    const review = vi.fn<LiveDelegationReviewer>(() => new Promise((resolve) => { release = resolve; }));
    const fixture = await setup(review);
    fixture.send('slow', '做动画'); fixture.send('queued', '改成白天');
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    clock.mockReturnValue(20_001);
    release?.({ kind: 'work', brief: '迟到的任务' });
    await fixture.settled('queued');
    expect(review).toHaveBeenCalledTimes(1);
    expect(fixture.admit).not.toHaveBeenCalled();
    await fixture.coordinator.dispose();
  });

  it('times out even when the model ignores AbortSignal', async () => {
    vi.useFakeTimers();
    const pending = reviewLiveDelegation(async () => new Promise(() => undefined), {
      sessionId: 's1', instruction: '做动画', tasks: [], signal: new AbortController().signal,
    });
    const rejected = expect(pending).rejects.toThrow('live-delegation-review-cancelled');
    await vi.advanceTimersByTimeAsync(20_000);
    await rejected;
  });

  it('does not session/prompt a second work decision with the same brief after completion (mtieeuab seq5)', async () => {
    const review = vi.fn<LiveDelegationReviewer>()
      .mockResolvedValueOnce({ kind: 'work', brief: '随便生成一张图片' })
      .mockResolvedValueOnce({ kind: 'work', brief: '随便生成一张图片' });
    const fixture = await setup(review);
    fixture.send('item_EJE2', '随便生成一张图片');
    await fixture.settled('item_EJE2');
    fixture.coordinator.notifyBoundSessionTurnEnded({
      sessionId: 's1',
      runId: 'run',
      kind: 'session-turn',
      status: 'completed',
      assistantText: 'Done — generated an image.',
    });
    fixture.send('item_EJE3', '随便生成一张图片');
    await fixture.settled('item_EJE3');
    expect(fixture.admit).toHaveBeenCalledTimes(1);
    const spoken = fixture.actions.filter((action) => action.action === 'append-context');
    expect(spoken.at(-1)?.content).toContain('generated an image');
    await fixture.coordinator.dispose();
  });

  it('still admits kind repeat on the same bound session after completion', async () => {
    const review = vi.fn<LiveDelegationReviewer>()
      .mockResolvedValueOnce({ kind: 'work', brief: '随便生成一张图片' })
      .mockResolvedValueOnce({ kind: 'repeat', brief: '随便生成一张图片' });
    const fixture = await setup(review);
    fixture.send('first', '随便生成一张图片');
    await fixture.settled('first');
    fixture.coordinator.notifyBoundSessionTurnEnded({
      sessionId: 's1',
      runId: 'run',
      kind: 'session-turn',
      status: 'completed',
      assistantText: '图好了',
    });
    fixture.send('second', '随便生成一张图片');
    await fixture.settled('second');
    expect(fixture.admit).toHaveBeenCalledTimes(2);
    await fixture.coordinator.dispose();
  });

  it('speaks hold-empty when admission rejects with live-delegation-held-empty', async () => {
    const actions: LiveOwnerActionPush[] = [];
    const coordinator = makeLiveCoordinator({
      review: async () => ({ kind: 'repeat', brief: '随便生成一张图片' }),
      admission: {
        admit: async () => ({
          status: 'rejected',
          reason: 'live-delegation-held-empty',
        }),
      },
      pushOwnerAction: (action) => actions.push(action),
    });
    const started = await coordinator.start({
      sessionId: 's1',
      providerId: 'openai-codex',
      settingsRevision: 1,
      idempotencyKey: 'hold',
      ownerDeviceId: 'owner',
      bootstrap: { mediaDriverId: 'codex-webrtc-v1', offerSdp: 'v=0\n' },
      signal: new AbortController().signal,
    });
    if (!started.ok) throw new Error(started.errorCode);
    coordinator.reportOwnerEvent({
      callId: started.call.callId,
      ownerDeviceId: 'owner',
      event: {
        type: 'delegation',
        providerDelegationId: 'd-hold',
        instruction: '随便生成一张图片',
      },
    });
    await vi.waitFor(() =>
      expect(actions.some((action) => action.action === 'append-context')).toBe(true),
    );
    expect(actions.find((action) => action.action === 'append-context')?.content).toContain(
      'not in a work session',
    );
    await coordinator.dispose();
  });
});
