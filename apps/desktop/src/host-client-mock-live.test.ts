import { describe, expect, it } from 'vitest';
import type { HostPush, PiwinConfig } from '@piwin/contracts';
import { handleMockLiveCommand } from './host-client-mock-live.js';

const config: PiwinConfig = {
  hostMode: 'sdk',
  providers: [],
  media: { maxPasteBytes: 1, allowedMimeTypes: [] },
  artifact: {
    enabled: true,
    triggerMode: 'automatic',
    decisionPrompt: { mode: 'default', customPrompt: '' },
    maxBytes: 1,
  },
  speech: { live: { enabled: true } },
};

describe('handleMockLiveCommand', () => {
  it('starts and ends a mock Live call', () => {
    const pushes: HostPush[] = [];
    let slot = null as ReturnType<typeof handleMockLiveCommand> extends never ? never : import('./host-client-mock-live.js').MockLiveSlot | null;
    const started = handleMockLiveCommand({
      command: {
        type: 'voice/live/start',
        input: {
          sessionId: 's1',
          providerId: 'openai-codex',
          settingsRevision: 1,
          idempotencyKey: 'k1',
          bootstrap: { mediaDriverId: 'codex-webrtc-v1', offerSdp: 'v=0' },
        },
      },
      id: '1',
      config,
      emitPush: (push) => pushes.push(push),
      slot,
      setSlot: (next) => {
        slot = next;
      },
    });
    expect(started?.success).toBe(true);
    expect(slot?.call.callId).toBeTruthy();
    const ended = handleMockLiveCommand({
      command: {
        type: 'voice/live/end',
        input: { callId: slot?.call.callId ?? '', expectedRevision: 1, reason: 'user' },
      },
      id: '2',
      config,
      emitPush: (push) => pushes.push(push),
      slot,
      setSlot: (next) => {
        slot = next;
      },
    });
    expect(ended?.success).toBe(true);
    expect(slot).toBeNull();
    expect(pushes.some((push) => push.type === 'voice/live-updated' && push.call === null)).toBe(
      true,
    );
  });

  it('ends a mock Live call without a callId', () => {
    let slot: import('./host-client-mock-live.js').MockLiveSlot | null = {
      call: {
        callId: 'mock-1',
        revision: 1,
        phase: 'active',
        boundSessionId: 's1',
        boundSessionLabel: 's1',
        ownerDeviceId: 'local',
        providerId: 'openai-codex',
        mediaDriverId: 'codex-webrtc-v1',
        voiceModelId: 'gpt-live-1-codex',
        startedAt: '2026-08-29T00:00:00.000Z',
      },
      answerSdp: 'v=0',
    };
    const ended = handleMockLiveCommand({
      command: { type: 'voice/live/end', input: { reason: 'user' } },
      id: '3',
      config,
      emitPush: () => undefined,
      slot,
      setSlot: (next) => {
        slot = next;
      },
    });
    expect(ended?.success).toBe(true);
    expect(slot).toBeNull();
  });
});
