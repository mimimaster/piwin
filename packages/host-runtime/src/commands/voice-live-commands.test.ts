import { describe, expect, it } from 'vitest';
import { makeLiveCoordinator } from '../voice/live-coordinator-test-harness.js';
import { handleVoiceLiveCommand } from './voice-live-commands.js';
import type { VoiceLiveCommandContext } from './voice-live-commands.js';

function makeContext(overrides?: Partial<VoiceLiveCommandContext>): VoiceLiveCommandContext {
  const coordinator = makeLiveCoordinator();
  return {
    push: () => undefined,
    requireSession: () => {
      throw new Error('unused');
    },
    getMcpManager: () => {
      throw new Error('unused');
    },
    getJobController: () => {
      throw new Error('unused');
    },
    todoStore: {} as VoiceLiveCommandContext['todoStore'],
    petStateStore: {} as VoiceLiveCommandContext['petStateStore'],
    runCronJob: async () => ({ ok: true }),
    pendingPermissions: new Map(),
    pendingExtensionUi: new Map(),
    rememberProjectPermission: async () => undefined,
    rememberSessionPermission: () => undefined,
    sessionPermissionOverrides: new Map(),
    setSessionPermissionOverride: () => undefined,
    clearSessionPermissionOverride: () => undefined,
    liveCallCoordinator: coordinator,
    resolveOwnerDeviceId: () => 'local',
    ...overrides,
  };
}

describe('handleVoiceLiveCommand', () => {
  it('starts and reports a delegation event', async () => {
    const context = makeContext();
    const started = await handleVoiceLiveCommand(
      {
        type: 'voice/live/start',
        input: {
          sessionId: 's1',
          providerId: 'openai-codex',
          settingsRevision: 1,
          idempotencyKey: 'k1',
          bootstrap: { mediaDriverId: 'codex-webrtc-v1', offerSdp: 'v=0\n' },
        },
      },
      'req-1',
      context,
    );
    expect(started?.success).toBe(true);
    const data = started && started.success ? (started.data as { call: { callId: string } }) : null;
    expect(data?.call.callId).toBeTruthy();
    const reported = await handleVoiceLiveCommand(
      {
        type: 'voice/live/report-event',
        input: {
          callId: data?.call.callId ?? '',
          expectedRevision: 1,
          event: {
            type: 'delegation',
            providerDelegationId: 'd1',
            instruction: 'do the work',
          },
        },
      },
      'req-2',
      context,
    );
    expect(reported?.success).toBe(true);
    await context.liveCallCoordinator?.dispose();
  });

  it('rebinds an active call to another session', async () => {
    const context = makeContext({
      liveCallCoordinator: makeLiveCoordinator({
        resolveSessionLabel: (sessionId) =>
          sessionId === 's1' ? 'Work' : sessionId === 's2' ? 'Other' : null,
      }),
    });
    const started = await handleVoiceLiveCommand(
      {
        type: 'voice/live/start',
        input: {
          sessionId: 's1',
          providerId: 'openai-codex',
          settingsRevision: 1,
          idempotencyKey: 'k-rebind',
          bootstrap: { mediaDriverId: 'codex-webrtc-v1', offerSdp: 'v=0\n' },
        },
      },
      'req-start',
      context,
    );
    expect(started?.success).toBe(true);
    const data = started && started.success ? (started.data as { call: { callId: string; revision: number } }) : null;
    const rebound = await handleVoiceLiveCommand(
      {
        type: 'voice/live/rebind',
        input: {
          sessionId: 's2',
          callId: data?.call.callId ?? '',
          ...(data?.call.revision !== undefined ? { expectedRevision: data.call.revision } : {}),
        },
      },
      'req-rebind',
      context,
    );
    expect(rebound?.success).toBe(true);
    const call = rebound && rebound.success ? (rebound.data as { call: { boundSessionId: string } }).call : null;
    expect(call?.boundSessionId).toBe('s2');
    await context.liveCallCoordinator?.dispose();
  });

  it('ends an in-flight start without a callId', async () => {
    let releaseCreate: (() => void) | undefined;
    const holdCreate = new Promise<void>((resolve) => {
      releaseCreate = resolve;
    });
    const context = makeContext({
      liveCallCoordinator: makeLiveCoordinator({
        fakeControls: { autoReady: false, holdCreate },
      }),
    });
    const starting = handleVoiceLiveCommand(
      {
        type: 'voice/live/start',
        input: {
          sessionId: 's1',
          providerId: 'openai-codex',
          settingsRevision: 1,
          idempotencyKey: 'k-cancel',
          bootstrap: { mediaDriverId: 'codex-webrtc-v1', offerSdp: 'v=0\n' },
        },
      },
      'req-start',
      context,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const ended = await handleVoiceLiveCommand(
      { type: 'voice/live/end', input: { reason: 'user' } },
      'req-end',
      context,
    );
    expect(ended?.success).toBe(true);
    expect(
      context.liveCallCoordinator?.status({
        sessionId: 's1',
        capabilities: { microphone: true, mediaDriverIds: ['codex-webrtc-v1'] },
      }).call,
    ).toBeNull();
    releaseCreate?.();
    const started = await starting;
    expect(started?.success).toBe(false);
    expect(
      context.liveCallCoordinator?.status({
        sessionId: 's1',
        capabilities: { microphone: true, mediaDriverIds: ['codex-webrtc-v1'] },
      }).call,
    ).toBeNull();
    await context.liveCallCoordinator?.dispose();
  });

  it('fails when coordinator is missing', async () => {
    const context = makeContext();
    delete (context as { liveCallCoordinator?: unknown }).liveCallCoordinator;
    const response = await handleVoiceLiveCommand(
      {
        type: 'voice/live/status',
        input: { capabilities: { microphone: true, mediaDriverIds: ['codex-webrtc-v1'] } },
      },
      'req',
      context,
    );
    expect(response?.success).toBe(false);
  });

  it('set-intended-session empty holds a later repeat on the bound session', async () => {
    const context = makeContext();
    const started = await handleVoiceLiveCommand(
      {
        type: 'voice/live/start',
        input: {
          sessionId: 'session-a',
          providerId: 'openai-codex',
          settingsRevision: 1,
          idempotencyKey: 'k-hold',
          bootstrap: { mediaDriverId: 'codex-webrtc-v1', offerSdp: 'v=0\n' },
        },
      },
      'req-start',
      context,
    );
    expect(started?.success).toBe(true);
    const callId = (started as { data: { call: { callId: string } } }).data.call.callId;

    const set = await handleVoiceLiveCommand(
      {
        type: 'voice/live/set-intended-session',
        input: { callId, intendedSessionId: null },
      },
      'req-set',
      context,
    );
    expect(set?.success).toBe(true);
  });
});
