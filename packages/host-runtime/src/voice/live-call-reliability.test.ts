import { describe, expect, it, vi } from 'vitest';
import { LiveProviderRegistry, createFakeCodexRegistration } from '@piwin/voice';
import { makeLiveCoordinator, readyLiveSnapshot } from './live-coordinator-test-harness.js';

const STATUS = { capabilities: { microphone: true, mediaDriverIds: ['codex-webrtc-v1' as const] } };
const startInput = (key = 'same') => ({
  sessionId: 's1', providerId: 'openai-codex', settingsRevision: 1,
  idempotencyKey: key, ownerDeviceId: 'd1', signal: new AbortController().signal,
  bootstrap: { mediaDriverId: 'codex-webrtc-v1' as const, offerSdp: 'v=0\n' },
});

describe('Live start isolation and cleanup', () => {
  it('never replays bootstrap to another owner with the same key', async () => {
    const coordinator = makeLiveCoordinator();
    expect((await coordinator.start(startInput())).ok).toBe(true);
    expect(await coordinator.start({ ...startInput(), ownerDeviceId: 'd2' })).toEqual({
      ok: false, errorCode: 'live-call-busy',
    });
    await coordinator.dispose();
  });

  it('does not rebind a replay key to a different session', async () => {
    const coordinator = makeLiveCoordinator();
    await coordinator.start(startInput());
    expect(await coordinator.start({ ...startInput(), sessionId: 's2' })).toEqual({
      ok: false, errorCode: 'live-conflict',
    });
    await coordinator.dispose();
  });

  it('replays the owner response without consuming the start budget', async () => {
    const coordinator = makeLiveCoordinator();
    const original = await coordinator.start(startInput());
    for (let count = 0; count < 8; count += 1) {
      expect(await coordinator.start(startInput())).toEqual(original);
    }
    await coordinator.dispose();
  });

  it('rejects stale settings before creating a call', async () => {
    const coordinator = makeLiveCoordinator({ snapshot: readyLiveSnapshot({ revision: 2 }) });
    expect(await coordinator.start(startInput())).toEqual({ ok: false, errorCode: 'live-conflict' });
    expect(coordinator.status(STATUS).call).toBeNull();
    await coordinator.dispose();
  });

  it('uses distinct call identities even within one millisecond', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const coordinator = makeLiveCoordinator();
    try {
      const first = await coordinator.start(startInput('one'));
      const second = await coordinator.start(startInput('two'));
      expect(first.ok && second.ok && first.call.callId !== second.call.callId).toBe(true);
    } finally {
      clock.mockRestore();
      await coordinator.dispose();
    }
  });

  it('clears a cancelled create even if the provider ignores cancellation', async () => {
    const fake = createFakeCodexRegistration();
    let release: (() => void) | undefined;
    const close = vi.fn(async () => undefined);
    const coordinator = makeLiveCoordinator({
      registry: new LiveProviderRegistry([{
        ...fake,
        async start() {
          await new Promise<void>((resolve) => { release = resolve; });
          return { voiceModelId: 'fake', ownerBootstrap: { mediaDriverId: 'codex-webrtc-v1' as const, answerSdp: 'v=0\n' }, close };
        },
      }]),
    });
    const abort = new AbortController();
    const pending = coordinator.start({ ...startInput(), signal: abort.signal });
    await vi.waitFor(() => expect(release).toBeDefined());
    abort.abort();
    release?.();
    expect(await pending).toEqual({ ok: false, errorCode: 'live-protocol-failed' });
    expect(close).toHaveBeenCalledOnce();
    expect(coordinator.status(STATUS).call).toBeNull();
    await coordinator.dispose();
  });

  it('does not publish stale null after a slow close and replacement start', async () => {
    const fake = createFakeCodexRegistration();
    let release: (() => void) | undefined;
    const updates: Array<string | null> = [];
    let count = 0;
    const coordinator = makeLiveCoordinator({
      registry: new LiveProviderRegistry([{
        ...fake,
        async start(input) {
          const result = await fake.start(input);
          count += 1;
          return count === 1 ? { ...result, close: () => new Promise<void>((resolve) => { release = resolve; }) } : result;
        },
      }]),
      pushUpdated: (call) => updates.push(call?.callId ?? null),
    });
    await coordinator.start(startInput('one'));
    const ending = coordinator.end({ ownerDeviceId: 'd1' });
    await vi.waitFor(() => expect(release).toBeDefined());
    const replacement = await coordinator.start(startInput('two'));
    release?.();
    await ending;
    expect(replacement.ok && updates.at(-1) === replacement.call.callId).toBe(true);
    await coordinator.dispose();
  });
});
