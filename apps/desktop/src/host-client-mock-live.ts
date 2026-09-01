/**
 * In-memory Live commands for the browser mock host.
 */

import type {
  HostCommand,
  HostPush,
  HostResponse,
  LiveCallView,
  LiveReadyMissing,
  LiveStatusData,
  PiwinConfig,
} from '@piwin/contracts';

export type MockLiveSlot = {
  call: LiveCallView;
  answerSdp: string;
};

export function handleMockLiveCommand(input: {
  command: HostCommand;
  id: string | undefined;
  config: PiwinConfig;
  emitPush: (message: HostPush) => void;
  slot: MockLiveSlot | null;
  setSlot: (slot: MockLiveSlot | null) => void;
}): HostResponse | null {
  const { command, id } = input;
  if (
    command.type !== 'voice/live/status' &&
    command.type !== 'voice/live/settings-schema' &&
    command.type !== 'voice/live/apply-settings' &&
    command.type !== 'voice/live/set-provider-key' &&
    command.type !== 'voice/live/start' &&
    command.type !== 'voice/live/rebind' &&
    command.type !== 'voice/live/media-state' &&
    command.type !== 'voice/live/set-muted' &&
    command.type !== 'voice/live/end' &&
    command.type !== 'voice/live/report-event' &&
    command.type !== 'voice/live/set-intended-session'
  ) {
    return null;
  }

  if (command.type === 'voice/live/status') {
    const missing: LiveReadyMissing[] = [];
    if (input.slot) missing.push('call-busy');
    if (!command.input.sessionId) missing.push('session');
    const data: LiveStatusData = {
      ready: missing.length === 0,
      selectedProviderId: 'openai-codex',
      settingsRevision: 1,
      mediaKind: 'webrtc-sdp',
      mediaDriverId: 'codex-webrtc-v1',
      missing,
      call: input.slot?.call ?? null,
    };
    return ok(id, command.type, data);
  }

  if (command.type === 'voice/live/settings-schema') {
    return ok(id, command.type, {
      revision: 1,
      selectedProviderId: 'openai-codex',
      providers: [
        {
          providerId: 'openai-codex',
          title: 'Codex',
          mediaKind: 'webrtc-sdp',
          mediaDriverId: 'codex-webrtc-v1',
          auth: { kind: 'subscription-oauth', providerId: 'openai-codex', ready: true },
          settings: [
            {
              key: 'voice',
              control: 'select',
              label: 'Voice',
              required: true,
              defaultValue: 'cove',
              options: [{ value: 'cove', label: 'Cove' }],
            },
          ],
        },
      ],
    });
  }

  if (command.type === 'voice/live/start') {
    if (input.slot) return fail(id, command.type, 'live-call-busy');
    if (command.input.bootstrap.mediaDriverId !== 'codex-webrtc-v1') {
      return fail(id, command.type, 'live-media-unsupported');
    }
    const call: LiveCallView = {
      callId: `mock-live-${Date.now().toString(36)}`,
      revision: 1,
      phase: 'active',
      activity: 'listening',
      boundSessionId: command.input.sessionId,
      boundSessionLabel: command.input.sessionId,
      ownerDeviceId: 'local',
      providerId: command.input.providerId,
      mediaDriverId: 'codex-webrtc-v1',
      voiceModelId: 'gpt-live-1-codex',
      startedAt: new Date().toISOString(),
    };
    const answerSdp = 'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n';
    input.setSlot({ call, answerSdp });
    input.emitPush({ type: 'voice/live-updated', call });
    return ok(id, command.type, {
      call,
      bootstrap: { mediaDriverId: 'codex-webrtc-v1', answerSdp },
    });
  }

  if (command.type === 'voice/live/rebind') {
    if (!input.slot || input.slot.call.callId !== command.input.callId) {
      return fail(id, command.type, 'live-session-unavailable');
    }
    const nextActivity =
      input.slot.call.activity === 'agent-working' ? 'listening' : input.slot.call.activity;
    const call: LiveCallView = {
      ...input.slot.call,
      revision: input.slot.call.revision + 1,
      boundSessionId: command.input.sessionId,
      boundSessionLabel: command.input.sessionId,
      ...(nextActivity ? { activity: nextActivity } : {}),
    };
    input.setSlot({ ...input.slot, call });
    input.emitPush({ type: 'voice/live-updated', call });
    return ok(id, command.type, { call });
  }

  if (command.type === 'voice/live/set-muted') {
    if (!input.slot || input.slot.call.callId !== command.input.callId) {
      return fail(id, command.type, 'live-session-unavailable');
    }
    const call: LiveCallView = {
      ...input.slot.call,
      revision: input.slot.call.revision + 1,
      activity: command.input.muted ? 'muted' : 'listening',
    };
    input.setSlot({ ...input.slot, call });
    input.emitPush({ type: 'voice/live-updated', call });
    return ok(id, command.type, { muted: command.input.muted });
  }

  if (command.type === 'voice/live/end') {
    input.setSlot(null);
    input.emitPush({ type: 'voice/live-updated', call: null });
    return ok(id, command.type, { ended: true });
  }

  if (command.type === 'voice/live/report-event') {
    if (!input.slot || input.slot.call.callId !== command.input.callId) {
      return fail(id, command.type, 'live-session-unavailable');
    }
    const event = command.input.event;
    if (event.type === 'activity') {
      const call: LiveCallView = {
        ...input.slot.call,
        revision: input.slot.call.revision + 1,
        activity: event.activity,
      };
      input.setSlot({ ...input.slot, call });
      input.emitPush({ type: 'voice/live-updated', call });
    }
    if (event.type === 'media-failed' || event.type === 'media-closed') {
      input.setSlot(null);
      input.emitPush({ type: 'voice/live-updated', call: null });
    }
    return ok(id, command.type, { accepted: true });
  }

  if (command.type === 'voice/live/set-intended-session') {
    return ok(id, command.type, { accepted: true });
  }

  return ok(id, command.type, { accepted: true });
}

function ok(id: string | undefined, command: string, data: unknown): HostResponse {
  return id === undefined
    ? { type: 'response', command, success: true, data }
    : { id, type: 'response', command, success: true, data };
}

function fail(id: string | undefined, command: string, error: string): HostResponse {
  return id === undefined
    ? { type: 'response', command, success: false, error }
    : { id, type: 'response', command, success: false, error };
}
