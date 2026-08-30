import type { LiveProviderDescriptor } from '@piwin/contracts';
import {
  FakeRealtimeVoiceAdapter,
  type FakeRealtimeVoiceAdapterControls,
} from './fake-realtime-voice-adapter.js';
import type { LiveProviderRegistration } from './live-provider-registration.js';
import { codexLiveSettingFields, validateCodexLiveSettings } from './live-settings-schema.js';

export function createFakeCodexRegistration(
  controls: FakeRealtimeVoiceAdapterControls = {},
): LiveProviderRegistration & { lastAdapter: () => FakeRealtimeVoiceAdapter | null } {
  let last: FakeRealtimeVoiceAdapter | null = null;
  return {
    lastAdapter: () => last,
    descriptor(): LiveProviderDescriptor {
      return {
        providerId: 'openai-codex',
        title: 'Codex',
        mediaKind: 'webrtc-sdp',
        mediaDriverId: 'codex-webrtc-v1',
        auth: { kind: 'subscription-oauth', providerId: 'openai-codex', ready: true },
        settings: codexLiveSettingFields(),
      };
    },
    authReady: async () => true,
    validateSettings: (values) => validateCodexLiveSettings(values),
    async start(input) {
      if (input.clientBootstrap.mediaDriverId !== 'codex-webrtc-v1') {
        throw new Error('live-media-unsupported');
      }
      const settings = validateCodexLiveSettings(input.settings);
      if (!settings.ok) throw new Error(settings.message);
      const adapter = new FakeRealtimeVoiceAdapter(controls);
      last = adapter;
      const created = await adapter.createCall({
        sessionId: input.sessionId,
        sdpOffer: input.clientBootstrap.offerSdp,
        accessToken: 'fake',
        accountId: 'fake',
        instructions: 'piwin Live work-session voice assistant.',
        signal: input.signal,
      });
      return {
        voiceModelId: 'gpt-live-1-codex',
        ownerBootstrap: { mediaDriverId: 'codex-webrtc-v1', answerSdp: created.sdpAnswer },
        close: () => adapter.close(),
      };
    },
  };
}
