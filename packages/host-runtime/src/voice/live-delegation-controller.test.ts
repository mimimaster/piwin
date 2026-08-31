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
    expect(actions.filter((action) => action.action === 'append-context')).toHaveLength(0);
    coordinator.bindQueuedDelegationRun({ callId, sessionId: 's1', messageId: 'm1', runId: 'queued-run' });
    coordinator.notifyBoundSessionTurnEnded({ ...result, runId: 'queued-run' });
    expect(actions.filter((action) => action.action === 'append-context')).toHaveLength(1);
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
    release?.();
    await vi.waitFor(() => expect(actions.filter((action) => action.action === 'append-context')).toHaveLength(1));
    expect(actions.map((action) => action.action)).toEqual(['ack-delegation', 'append-context']);
    const spoken = actions.find((action) => action.action === 'append-context')?.content ?? '';
    expect(spoken.match(/Continue from your last spoken line/g)).toHaveLength(1);
    await coordinator.dispose();
  });
});
