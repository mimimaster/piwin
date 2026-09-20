import { describe, expect, it, vi } from 'vitest';
import type { LiveOwnerActionPush } from '@piwin/contracts';
import { makeLiveCoordinator } from './live-coordinator-test-harness.js';

const result = { sessionId: 's1', runId: 'r1', kind: 'session-turn', status: 'completed', assistantText: '已完成修改。' };
async function setup(queued = false) {
  const actions: LiveOwnerActionPush[] = [];
  const coordinator = makeLiveCoordinator({
    admission: { admit: async () => queued
      ? { status: 'accepted', queued: true, queuedTurnId: 'q1', messageId: 'm1' }
      : { status: 'accepted', queued: false, runId: 'r1', messageId: 'm1' } },
    pushOwnerAction: (action) => actions.push(action),
  });
  const start = await coordinator.start({ sessionId: 's1', providerId: 'openai-codex',
    settingsRevision: 1, idempotencyKey: 'key', ownerDeviceId: 'd1',
    bootstrap: { mediaDriverId: 'codex-webrtc-v1', offerSdp: 'v=0\n' }, signal: new AbortController().signal });
  if (!start.ok) throw new Error(start.errorCode);
  const delegate = async (id: string) => {
    coordinator.reportOwnerEvent({ callId: start.call.callId, ownerDeviceId: 'd1',
      event: { type: 'delegation', providerDelegationId: id, instruction: '修复问题' } });
    await vi.waitFor(() => expect(actions.some((action) => action.providerDelegationId === id)).toBe(true));
  };
  return { coordinator, actions, delegate, callId: start.call.callId };
}

describe('Host-only Live results', () => {
  it('delivers once for a Run with multiple steers and never for another session', async () => {
    const { coordinator, actions, delegate } = await setup();
    await delegate('d1'); await delegate('d2');
    coordinator.notifyBoundSessionTurnEnded({ ...result, sessionId: 'another' });
    coordinator.notifyBoundSessionTurnEnded({ ...result, kind: 'subagent-task' });
    expect(actions.filter((action) => action.action === 'append-context')).toHaveLength(0);
    coordinator.notifyBoundSessionTurnEnded(result);
    coordinator.notifyBoundSessionTurnEnded(result);
    const spoken = actions.filter((action) => action.action === 'append-context');
    expect(spoken).toHaveLength(1);
    expect(spoken[0]?.providerDelegationId).toBe('d2');
    await coordinator.dispose();
  });

  it('does not assign an unrelated completed Run to a waiting queued delegation', async () => {
    const { coordinator, actions, delegate, callId } = await setup(true);
    await delegate('d1');
    coordinator.notifyBoundSessionTurnEnded(result);
    const first = actions.filter((action) => action.action === 'append-context');
    expect(first).toHaveLength(1);
    expect(first[0]?.target).toBe('session');
    coordinator.bindQueuedDelegationRun({ callId, sessionId: 's1', messageId: 'm1', runId: 'queued-run' });
    coordinator.notifyBoundSessionTurnEnded({ ...result, runId: 'queued-run' });
    expect(actions.filter((action) => action.action === 'append-context')).toHaveLength(2);
    await coordinator.dispose();
  });

  it('does not speak late results after hangup', async () => {
    const { coordinator, actions, delegate } = await setup();
    await delegate('d1');
    await coordinator.end({ ownerDeviceId: 'd1' });
    coordinator.notifyBoundSessionTurnEnded(result);
    expect(actions.filter((action) => action.action === 'append-context')).toHaveLength(0);
    await coordinator.dispose();
  });

  it('retains an early terminal result until admission supplies its exact Run identity', async () => {
    const actions: LiveOwnerActionPush[] = [];
    let release: (() => void) | undefined;
    const coordinator = makeLiveCoordinator({
      admission: { admit: async () => {
        await new Promise<void>((resolve) => { release = resolve; });
        return { status: 'accepted', queued: false, runId: 'r1', messageId: 'm1' };
      } },
      pushOwnerAction: (action) => actions.push(action),
    });
    const started = await coordinator.start({ sessionId: 's1', providerId: 'openai-codex',
      settingsRevision: 1, idempotencyKey: 'early', ownerDeviceId: 'd1',
      bootstrap: { mediaDriverId: 'codex-webrtc-v1', offerSdp: 'v=0\n' }, signal: new AbortController().signal });
    if (!started.ok) throw new Error(started.errorCode);
    coordinator.reportOwnerEvent({ callId: started.call.callId, ownerDeviceId: 'd1',
      event: { type: 'delegation', providerDelegationId: 'd1', instruction: '修复' } });
    coordinator.notifyBoundSessionTurnEnded(result);
    expect(actions).toHaveLength(0);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    release?.();
    await vi.waitFor(() => expect(actions.filter((action) => action.action === 'append-context')).toHaveLength(1));
    expect(actions.map((action) => action.action)).toEqual(['ack-delegation', 'append-context']);
    const spoken = actions.find((action) => action.action === 'append-context')?.content ?? '';
    expect(spoken.match(/Continue from your last spoken line/g)).toHaveLength(1);
    await coordinator.dispose();
  });

  it('speaks a typed-prompt Run on the bound session once', async () => {
    const { coordinator, actions } = await setup();
    coordinator.notifyBoundSessionTurnEnded(result);
    coordinator.notifyBoundSessionTurnEnded(result);
    const spoken = actions.filter((action) => action.action === 'append-context');
    expect(spoken).toHaveLength(1);
    expect(spoken[0]?.target).toBe('session');
    expect(spoken[0]?.content).toContain('已完成修改');
    await coordinator.dispose();
  });

  it('still speaks a typed-prompt Run held while a review decided against work', async () => {
    const actions: LiveOwnerActionPush[] = [];
    let release: (() => void) | undefined;
    const coordinator = makeLiveCoordinator({
      // The spoken utterance turns out to be conversation, so no ledger record
      // will ever claim the typed Run that finished while review was pending.
      review: async () => {
        await new Promise<void>((resolve) => { release = resolve; });
        return { kind: 'conversation' };
      },
      pushOwnerAction: (action) => actions.push(action),
    });
    const started = await coordinator.start({ sessionId: 's1', providerId: 'openai-codex',
      settingsRevision: 1, idempotencyKey: 'held-typed', ownerDeviceId: 'd1',
      bootstrap: { mediaDriverId: 'codex-webrtc-v1', offerSdp: 'v=0\n' }, signal: new AbortController().signal });
    if (!started.ok) throw new Error(started.errorCode);
    coordinator.reportOwnerEvent({ callId: started.call.callId, ownerDeviceId: 'd1',
      event: { type: 'delegation', providerDelegationId: 'chatty', instruction: '你好' } });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    coordinator.notifyBoundSessionTurnEnded({ ...result, runId: 'typed-run' });
    expect(actions.filter((action) => action.action === 'append-context')).toHaveLength(0);
    release?.();
    await vi.waitFor(() => {
      const spoken = actions.filter(
        (action) => action.action === 'append-context' && action.target === 'session',
      );
      expect(spoken).toHaveLength(1);
      expect(spoken[0]?.content).toContain('已完成修改');
    });
    await coordinator.dispose();
  });

  it('stays quiet when the user cancels their own typed Run', async () => {
    const { coordinator, actions } = await setup();
    coordinator.notifyBoundSessionTurnEnded({ ...result, status: 'cancelled', assistantText: '' });
    coordinator.notifyBoundSessionTurnEnded({
      ...result,
      runId: 'r2',
      status: 'interrupted',
      assistantText: '',
    });
    expect(actions.filter((action) => action.action === 'append-context')).toHaveLength(0);
    await coordinator.dispose();
  });

  it('resynchronizes authoritative task state when a new user turn starts', async () => {
    const { coordinator, actions, delegate, callId } = await setup();
    await delegate('d1');

    coordinator.reportOwnerEvent({
      callId,
      ownerDeviceId: 'd1',
      event: { type: 'activity', activity: 'user-speaking' },
    });
    const runningRefreshes = actions.filter(
      (action) =>
        action.action === 'append-context' &&
        action.target === 'session' &&
        action.channel === 'commentary',
    );
    expect(runningRefreshes).toHaveLength(1);
    expect(runningRefreshes[0]?.content).toContain('did start');
    expect(runningRefreshes[0]?.content).toContain('currently running');
    expect(runningRefreshes[0]?.content).not.toContain('No work started');

    // Providers can report several transcript/audio events for one user turn.
    coordinator.reportOwnerEvent({
      callId,
      ownerDeviceId: 'd1',
      event: { type: 'activity', activity: 'user-speaking' },
    });
    expect(actions.filter(
      (action) =>
        action.action === 'append-context' &&
        action.target === 'session' &&
        action.channel === 'commentary',
    )).toHaveLength(1);

    coordinator.notifyBoundSessionTurnEnded(result);
    coordinator.reportOwnerEvent({
      callId,
      ownerDeviceId: 'd1',
      event: { type: 'activity', activity: 'user-speaking' },
    });
    const completedRefreshes = actions.filter(
      (action) =>
        action.action === 'append-context' &&
        action.target === 'session' &&
        action.channel === 'commentary',
    );
    expect(completedRefreshes).toHaveLength(2);
    expect(completedRefreshes[1]?.content).toContain('did run');
    expect(completedRefreshes[1]?.content).toContain('已完成修改');
    await coordinator.dispose();
  });
});
