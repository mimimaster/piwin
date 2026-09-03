import { describe, expect, it, vi } from 'vitest';
import { LiveProviderRegistry, createFakeCodexRegistration } from '@piwin/voice';
import { LiveCallCoordinator } from './live-call-coordinator.js';
import { makeLiveCoordinator, readyLiveSnapshot } from './live-coordinator-test-harness.js';
import { createVoiceDelegationAdmission } from './voice-delegation-admission.js';

const STATUS = {
  sessionId: 's1',
  capabilities: { microphone: true, mediaDriverIds: ['codex-webrtc-v1' as const] },
};

function startArgs(input: {
  idempotencyKey: string;
  ownerDeviceId?: string;
  sessionId?: string;
}) {
  return {
    sessionId: input.sessionId ?? 's1',
    providerId: 'openai-codex',
    settingsRevision: 1,
    idempotencyKey: input.idempotencyKey,
    bootstrap: { mediaDriverId: 'codex-webrtc-v1' as const, offerSdp: 'v=0\n' },
    ownerDeviceId: input.ownerDeviceId ?? 'd1',
    signal: new AbortController().signal,
  };
}

describe('LiveCallCoordinator', () => {
  it('status reports missing auth and unavailable provider', () => {
    const coordinator = makeLiveCoordinator({
      snapshot: readyLiveSnapshot({
        registered: false,
        authReady: false,
        settingsValid: false,
      }),
    });
    const status = coordinator.status(STATUS);
    expect(status.ready).toBe(false);
    expect(status.selectedProviderId).toBe('openai-codex');
    expect(status.missing).toEqual(
      expect.arrayContaining(['provider-unavailable', 'provider-auth']),
    );
  });

  it('starts once, admits delegation idempotently, and ends', async () => {
    let promptCalls = 0;
    const coordinator = makeLiveCoordinator({
      admission: createVoiceDelegationAdmission({
        busy: { isSessionBusy: () => true },
        prompt: {
          admitVoiceDelegation: async () => {
            promptCalls += 1;
            return { queued: true, queuedTurnId: 'qt1', messageId: 'm1' };
          },
        },
      }),
    });

    const first = await coordinator.start(startArgs({ idempotencyKey: 'k1' }));
    expect(first.ok).toBe(true);

    const otherOwner = await coordinator.start(
      startArgs({ idempotencyKey: 'k-other', ownerDeviceId: 'd2' }),
    );
    expect(otherOwner).toEqual({ ok: false, errorCode: 'live-call-busy' });

    const reclaimed = await coordinator.start(startArgs({ idempotencyKey: 'k2' }));
    expect(reclaimed.ok).toBe(true);
    if (reclaimed.ok && first.ok) {
      expect(reclaimed.call.callId).not.toBe(first.call.callId);
    }

    if (!reclaimed.ok) return;
    coordinator.reportOwnerEvent({
      callId: reclaimed.call.callId,
      ownerDeviceId: 'd1',
      event: { type: 'delegation', providerDelegationId: 'del-1', instruction: 'fix' },
    });
    coordinator.reportOwnerEvent({
      callId: reclaimed.call.callId,
      ownerDeviceId: 'd1',
      event: { type: 'delegation', providerDelegationId: 'del-1', instruction: 'fix again' },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(promptCalls).toBe(1);

    const view = coordinator.status(STATUS).call;
    expect(view).not.toBeNull();
    const ended = await coordinator.end({
      callId: reclaimed.call.callId,
      expectedRevision: view!.revision,
      ownerDeviceId: 'd1',
    });
    expect(ended.ok).toBe(true);
    await coordinator.dispose();
  });

  it('admits owner-reported delegation without revision', async () => {
    let promptCalls = 0;
    const coordinator = makeLiveCoordinator({
      admission: createVoiceDelegationAdmission({
        busy: { isSessionBusy: () => false },
        prompt: {
          admitVoiceDelegation: async () => {
            promptCalls += 1;
            return { queued: false, runId: 'r3', messageId: 'm3' };
          },
        },
      }),
    });
    const started = await coordinator.start(startArgs({ idempotencyKey: 'k3' }));
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const reported = coordinator.reportOwnerEvent({
      callId: started.call.callId,
      ownerDeviceId: 'd1',
      event: {
        type: 'delegation',
        providerDelegationId: 'del-owner',
        instruction: 'summarize',
      },
    });
    expect(reported.ok).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(promptCalls).toBe(1);
    const outsider = coordinator.reportOwnerEvent({
      callId: started.call.callId,
      ownerDeviceId: 'other',
      event: { type: 'media-closed' },
    });
    expect(outsider.ok).toBe(false);
    await coordinator.dispose();
  });

  it('rejects start when the session is not in the durable index', async () => {
    const coordinator = makeLiveCoordinator({
      resolveSessionLabel: () => null,
    });
    const started = await coordinator.start(
      startArgs({ idempotencyKey: 'k-missing', sessionId: 'missing' }),
    );
    expect(started).toEqual({ ok: false, errorCode: 'live-session-unavailable' });
    await coordinator.dispose();
  });

  it('preserves the provider error code from a failed create', async () => {
    const ownerActions: string[] = [];
    const coordinator = makeLiveCoordinator({
      fakeControls: { failCreateWith: 'live-provider-access-denied' },
      pushOwnerAction: (action) => {
        ownerActions.push(action.action);
      },
    });
    const started = await coordinator.start(startArgs({ idempotencyKey: 'k-denied' }));
    expect(started).toEqual({ ok: false, errorCode: 'live-provider-access-denied' });
    expect(ownerActions).not.toContain('release-media');
    await coordinator.dispose();
  });

  it('serializes concurrent starts and ignores stale mute/end revisions', async () => {
    let createCalls = 0;
    const fake = createFakeCodexRegistration({ autoReady: false });
    const coordinator = new LiveCallCoordinator({
      review: async (request) => ({ kind: 'work', brief: request.instruction }),
      registry: new LiveProviderRegistry([
        {
          ...fake,
          async start(input) {
            createCalls += 1;
            return fake.start(input);
          },
        },
      ]),
      resolveSnapshot: async () => readyLiveSnapshot(),
      resolveSessionLabel: () => 'Named session',
      admission: createVoiceDelegationAdmission({
        busy: { isSessionBusy: () => false },
        prompt: {
          admitVoiceDelegation: async () => ({
            queued: false,
            runId: 'r1',
            messageId: 'm1',
          }),
        },
      }),
      getFakeAdapter: () => fake.lastAdapter(),
    });
    const [first, second] = await Promise.all([
      coordinator.start(startArgs({ idempotencyKey: 'same' })),
      coordinator.start(startArgs({ idempotencyKey: 'other' })),
    ]);
    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: false, errorCode: 'live-call-busy' });
    expect(createCalls).toBe(1);

    if (!first.ok) return;
    coordinator.reportOwnerEvent({
      callId: first.call.callId,
      ownerDeviceId: 'd1',
      event: { type: 'activity', activity: 'user-speaking' },
    });
    const muted = coordinator.setMuted({
      callId: first.call.callId,
      expectedRevision: first.call.revision,
      muted: true,
      ownerDeviceId: 'd1',
    });
    expect(muted).toEqual({ ok: false, errorCode: 'live-conflict' });
    const ended = await coordinator.end({
      callId: first.call.callId,
      expectedRevision: first.call.revision,
      ownerDeviceId: 'd1',
    });
    expect(ended.ok).toBe(true);
    await coordinator.dispose();
  });

  it('aborts start before a slot exists when the owner hangs up during session lookup', async () => {
    let releaseLabel: ((label: string | null) => void) | undefined;
    const coordinator = makeLiveCoordinator({
      resolveSessionLabel: () =>
        new Promise((resolve) => {
          releaseLabel = resolve;
        }),
    });
    const starting = coordinator.start(startArgs({ idempotencyKey: 'k-lookup' }));
    const ended = await coordinator.end({ ownerDeviceId: 'd1' });
    expect(ended.ok).toBe(true);
    releaseLabel?.('Work');
    await expect(starting).resolves.toEqual({ ok: false, errorCode: 'live-protocol-failed' });
    expect(coordinator.status(STATUS).call).toBeNull();
    await coordinator.dispose();
  });

  it('cancels an in-flight createCall when the owner hangs up without a callId', async () => {
    let releaseCreate: (() => void) | undefined;
    const holdCreate = new Promise<void>((resolve) => {
      releaseCreate = resolve;
    });
    const coordinator = makeLiveCoordinator({
      fakeControls: { autoReady: false, holdCreate },
    });
    const starting = coordinator.start(startArgs({ idempotencyKey: 'k-hangup' }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(coordinator.status(STATUS).call).not.toBeNull();
    const ended = await coordinator.end({ ownerDeviceId: 'd1' });
    expect(ended.ok).toBe(true);
    expect(coordinator.status(STATUS).call).toBeNull();
    releaseCreate?.();
    const started = await starting;
    expect(started).toEqual({ ok: false, errorCode: 'live-protocol-failed' });
    expect(coordinator.status(STATUS).call).toBeNull();
    await coordinator.dispose();
  });

  it('hands a sanitized session result back to Live after a delegated turn', async () => {
    const ownerActions: Array<{ action: string; content?: string }> = [];
    const coordinator = makeLiveCoordinator({
      admission: createVoiceDelegationAdmission({
        busy: { isSessionBusy: () => false },
        prompt: {
          admitVoiceDelegation: async () => ({
            queued: false,
            runId: 'r-weather',
            messageId: 'm-weather',
          }),
        },
      }),
      pushOwnerAction: (action) => {
        ownerActions.push({
          action: action.action,
          ...(action.content ? { content: action.content } : {}),
        });
      },
    });
    const started = await coordinator.start(startArgs({ idempotencyKey: 'k-result' }));
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    coordinator.reportOwnerEvent({
      callId: started.call.callId,
      ownerDeviceId: 'd1',
      event: {
        type: 'delegation',
        providerDelegationId: 'del-weather',
        instruction: '加州天气',
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    coordinator.notifyBoundSessionTurnEnded({
      sessionId: 's1',
      runId: 'r-weather',
      kind: 'session-turn',
      status: 'completed',
      assistantText: '洛杉矶今天晴，大约 24 度。',
    });
    const spoken = ownerActions.find((action) => action.action === 'append-context');
    expect(spoken?.content).toContain('洛杉矶今天晴');
    expect(spoken?.content).toContain('Continue from your last spoken line');
    expect(spoken?.content).not.toMatch(/The work session finished/i);
    expect(spoken?.content).not.toMatch(/token|sdp/i);
    expect(coordinator.status(STATUS).call?.activity).toBe('listening');
    await coordinator.dispose();
  });

  it('rebinds work to another session without ending the call', async () => {
    const admitted: string[] = [];
    const ownerActions: Array<{
      action: string;
      channel?: string;
      target?: string;
      content?: string;
    }> = [];
    const coordinator = makeLiveCoordinator({
      resolveSessionLabel: (sessionId) =>
        sessionId === 's1' ? 'Work' : sessionId === 's2' ? 'Other' : null,
      review: async (request) => ({ kind: 'work', brief: request.instruction }),
      admission: createVoiceDelegationAdmission({
        busy: { isSessionBusy: () => false },
        prompt: {
          admitVoiceDelegation: async (input) => {
            admitted.push(input.sessionId);
            return { queued: false, runId: `r-${admitted.length}`, messageId: `m-${admitted.length}` };
          },
        },
      }),
      pushOwnerAction: (action) => {
        ownerActions.push({
          action: action.action,
          ...(action.channel ? { channel: action.channel } : {}),
          ...(action.target ? { target: action.target } : {}),
          ...(action.content ? { content: action.content } : {}),
        });
      },
    });
    const started = await coordinator.start(startArgs({ idempotencyKey: 'k-rebind' }));
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const outsider = await coordinator.rebind({
      sessionId: 's2',
      callId: started.call.callId,
      ownerDeviceId: 'other',
    });
    expect(outsider).toEqual({ ok: false, errorCode: 'live-not-owner' });
    const missing = await coordinator.rebind({
      sessionId: 'missing',
      callId: started.call.callId,
      ownerDeviceId: 'd1',
    });
    expect(missing).toEqual({ ok: false, errorCode: 'live-session-unavailable' });
    const conflict = await coordinator.rebind({
      sessionId: 's2',
      callId: started.call.callId,
      ownerDeviceId: 'd1',
      expectedRevision: started.call.revision - 1,
    });
    expect(conflict).toEqual({ ok: false, errorCode: 'live-conflict' });
    expect(ownerActions.filter((action) => action.action === 'append-context')).toHaveLength(0);
    const same = await coordinator.rebind({
      sessionId: 's1',
      callId: started.call.callId,
      ownerDeviceId: 'd1',
    });
    expect(same.ok).toBe(true);
    expect(ownerActions.filter((action) => action.action === 'append-context')).toHaveLength(0);
    const rebound = await coordinator.rebind({
      sessionId: 's2',
      callId: started.call.callId,
      ownerDeviceId: 'd1',
    });
    expect(rebound.ok).toBe(true);
    if (rebound.ok) {
      expect(rebound.call.boundSessionId).toBe('s2');
      expect(rebound.call.boundSessionLabel).toBe('Other');
      expect(rebound.call.callId).toBe(started.call.callId);
    }
    const retarget = ownerActions.filter((action) => action.action === 'append-context');
    expect(retarget).toHaveLength(1);
    expect(retarget[0]).toMatchObject({
      channel: 'commentary',
      target: 'session',
    });
    expect(retarget[0]?.content).toContain('Other');
    coordinator.reportOwnerEvent({
      callId: started.call.callId,
      ownerDeviceId: 'd1',
      event: { type: 'delegation', providerDelegationId: 'del-s2', instruction: 'fix other' },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(admitted).toEqual(['s2']);
    await coordinator.dispose();
  });

  it('keeps an in-flight admission on the session that heard it', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const admitted: string[] = [];
    const coordinator = makeLiveCoordinator({
      resolveSessionLabel: (sessionId) =>
        sessionId === 's1' ? 'Work' : sessionId === 's2' ? 'Other' : null,
      review: async (request) => {
        await held;
        return { kind: 'work', brief: request.instruction };
      },
      admission: createVoiceDelegationAdmission({
        busy: { isSessionBusy: () => false },
        prompt: {
          admitVoiceDelegation: async (input) => {
            admitted.push(input.sessionId);
            return { queued: false, runId: 'r-held', messageId: 'm-held' };
          },
        },
      }),
    });
    const started = await coordinator.start(startArgs({ idempotencyKey: 'k-held' }));
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    coordinator.reportOwnerEvent({
      callId: started.call.callId,
      ownerDeviceId: 'd1',
      event: { type: 'delegation', providerDelegationId: 'del-held', instruction: 'fix first' },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const rebound = await coordinator.rebind({
      sessionId: 's2',
      callId: started.call.callId,
      ownerDeviceId: 'd1',
    });
    expect(rebound.ok).toBe(true);
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(admitted).toEqual(['s1']);
    await coordinator.dispose();
  });

  it('rejects a sixth start inside the burst window', async () => {
    const coordinator = makeLiveCoordinator();
    for (let index = 0; index < 5; index += 1) {
      const started = await coordinator.start(startArgs({ idempotencyKey: `burst-${index}` }));
      expect(started.ok).toBe(true);
    }
    await expect(coordinator.start(startArgs({ idempotencyKey: 'burst-6' }))).resolves.toEqual({
      ok: false,
      errorCode: 'live-start-throttled',
    });
    await coordinator.dispose();
  });
});

describe('LiveCallCoordinator session context', () => {
  it('passes startup context to the provider registration', async () => {
    const received: Array<string | undefined> = [];
    const fake = createFakeCodexRegistration();
    const originalStart = fake.start.bind(fake);
    fake.start = async (input) => {
      received.push(input.startupContext);
      return originalStart(input);
    };
    const coordinator = new LiveCallCoordinator({
      registry: new LiveProviderRegistry([fake]),
      resolveSnapshot: async () => readyLiveSnapshot(),
      resolveSessionLabel: () => 'Work',
      review: async (request) => ({ kind: 'work', brief: request.instruction }),
      admission: createVoiceDelegationAdmission({
        busy: { isSessionBusy: () => false },
        prompt: { admitVoiceDelegation: async () => ({ queued: false, runId: 'r1', messageId: 'm1' }) },
      }),
      resolveStartupContext: async () => 'User is fixing Live voice.',
    });
    const started = await coordinator.start(startArgs({ idempotencyKey: 'ctx-1' }));
    expect(started.ok).toBe(true);
    expect(received).toEqual(['User is fixing Live voice.']);
    await coordinator.dispose();
  });

  it('still starts when summarization throws', async () => {
    const coordinator = makeLiveCoordinator({
      resolveStartupContext: async () => {
        throw new Error('model-down');
      },
    });
    await expect(coordinator.start(startArgs({ idempotencyKey: 'ctx-fail' }))).resolves.toMatchObject({
      ok: true,
    });
    await coordinator.dispose();
  });

  it('fails start when summarization is aborted', async () => {
    const abort = new AbortController();
    const coordinator = makeLiveCoordinator({
      resolveStartupContext: async (_sessionId, signal) => {
        abort.abort();
        signal.throwIfAborted();
        return 'late';
      },
    });
    await expect(
      coordinator.start({ ...startArgs({ idempotencyKey: 'ctx-abort' }), signal: abort.signal }),
    ).resolves.toEqual({ ok: false, errorCode: 'live-protocol-failed' });
    await coordinator.dispose();
  });

  it('announces a rebind immediately and delivers the new summary afterwards', async () => {
    const ownerActions: Array<{ content?: string }> = [];
    let releaseSummary: (() => void) | undefined;
    const coordinator = makeLiveCoordinator({
      resolveSessionLabel: (sessionId) => (sessionId === 's2' ? 'Other' : 'Work'),
      resolveStartupContext: async (sessionId) => {
        if (sessionId !== 's2') return 'User is fixing Live voice.';
        await new Promise<void>((resolve) => { releaseSummary = resolve; });
        return 'Docs rewrite in progress.';
      },
      pushOwnerAction: (action) => ownerActions.push(action),
    });
    const started = await coordinator.start(startArgs({ idempotencyKey: 'ctx-rebind' }));
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    ownerActions.length = 0;
    const rebound = await coordinator.rebind({
      sessionId: 's2',
      callId: started.call.callId,
      ownerDeviceId: 'd1',
    });
    // The shell is unblocked before the summary model answers.
    expect(rebound.ok).toBe(true);
    expect(ownerActions).toHaveLength(1);
    expect(ownerActions[0]?.content).toContain('Other');
    await vi.waitFor(() => expect(releaseSummary).toBeTypeOf('function'));
    releaseSummary?.();
    await vi.waitFor(() => {
      expect(ownerActions).toHaveLength(2);
      expect(ownerActions[1]?.content).toContain('Docs rewrite in progress.');
    });
    await coordinator.dispose();
  });

  it('drops a rebind summary that resolves after the call ended', async () => {
    const ownerActions: Array<{ content?: string }> = [];
    let releaseSummary: (() => void) | undefined;
    const coordinator = makeLiveCoordinator({
      resolveSessionLabel: (sessionId) => (sessionId === 's2' ? 'Other' : 'Work'),
      resolveStartupContext: async (sessionId) => {
        if (sessionId !== 's2') return 'User is fixing Live voice.';
        await new Promise<void>((resolve) => { releaseSummary = resolve; });
        return 'Docs rewrite in progress.';
      },
      pushOwnerAction: (action) => ownerActions.push(action),
    });
    const started = await coordinator.start(startArgs({ idempotencyKey: 'ctx-rebind-end' }));
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const rebound = await coordinator.rebind({
      sessionId: 's2',
      callId: started.call.callId,
      ownerDeviceId: 'd1',
    });
    expect(rebound.ok).toBe(true);
    await coordinator.end({ ownerDeviceId: 'd1' });
    ownerActions.length = 0;
    await vi.waitFor(() => expect(releaseSummary).toBeTypeOf('function'));
    releaseSummary?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ownerActions.some((action) => action.content?.includes('Docs rewrite'))).toBe(false);
    await coordinator.dispose();
  });
});

describe('LiveCallCoordinator typed input relay', () => {
  it('relays typed and queued turns on the bound session only', async () => {
    const ownerActions: Array<{ action: string; content?: string }> = [];
    const coordinator = makeLiveCoordinator({
      pushOwnerAction: (action) => ownerActions.push(action),
    });
    const started = await coordinator.start(startArgs({ idempotencyKey: 'typed' }));
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    ownerActions.length = 0;

    coordinator.notifyBoundSessionUserInput({ sessionId: 's1', text: '把标题改大' });
    coordinator.notifyBoundSessionUserInput({ sessionId: 's1', text: '排队的活', source: 'queued-turn' });
    // Another session, this call's own handover, Host-authored resume, and blank
    // text must never reach the speaking surface.
    coordinator.notifyBoundSessionUserInput({ sessionId: 's2', text: '别的会话' });
    coordinator.notifyBoundSessionUserInput({ sessionId: 's1', text: '语音派的活', source: 'voice-delegation' });
    coordinator.notifyBoundSessionUserInput({ sessionId: 's1', text: '继续', source: 'resume' });
    coordinator.notifyBoundSessionUserInput({ sessionId: 's1', text: '   ' });

    const relayed = ownerActions.filter((action) => action.action === 'append-context');
    expect(relayed).toHaveLength(2);
    expect(relayed[0]?.content).toContain('把标题改大');
    expect(relayed[0]?.content).toContain('do not delegate it');
    expect(relayed[1]?.content).toContain('排队的活');
    await coordinator.dispose();
  });
});
