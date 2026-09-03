import {
  PIWIN_LIVE_INSTRUCTIONS,
  renderLiveStartupContext,
  type LiveProviderDescriptor,
} from '@piwin/contracts';
import { CodexLiveAdapter } from './codex-live-adapter.js';
import type { LiveProviderRegistration } from './live-provider-registration.js';
import { codexLiveSettingFields, validateCodexLiveSettings } from './live-settings-schema.js';

export function createCodexLiveRegistration(deps: {
  authReady: () => Promise<boolean>;
  resolveAuth: () => Promise<{ accessToken: string; accountId: string } | null>;
  createAdapter?: () => CodexLiveAdapter;
}): LiveProviderRegistration {
  return {
    descriptor(): LiveProviderDescriptor {
      return {
        providerId: 'openai-codex',
        title: 'Codex',
        mediaKind: 'webrtc-sdp',
        mediaDriverId: 'codex-webrtc-v1',
        auth: { kind: 'subscription-oauth', providerId: 'openai-codex', ready: false },
        settings: codexLiveSettingFields(),
      };
    },
    authReady: () => deps.authReady(),
    validateSettings: (values) => validateCodexLiveSettings(values),
    async start(input) {
      if (input.clientBootstrap.mediaDriverId !== 'codex-webrtc-v1') {
        throw new Error('live-media-unsupported');
      }
      const auth = await deps.resolveAuth();
      if (!auth) throw new Error('live-provider-auth');
      const settings = validateCodexLiveSettings(input.settings);
      if (!settings.ok) throw new Error(settings.message);
      const adapter = deps.createAdapter?.() ?? new CodexLiveAdapter();
      const voice = settings.normalized.voice;
      const created = await adapter.createCall({
        sessionId: input.sessionId,
        sdpOffer: input.clientBootstrap.offerSdp,
        accessToken: auth.accessToken,
        accountId: auth.accountId,
        instructions: PIWIN_LIVE_INSTRUCTIONS,
        signal: input.signal,
        ...(voice ? { voice } : {}),
        ...(input.startupContext
          ? { startupContext: renderLiveStartupContext(input.startupContext) }
          : {}),
      });
      return {
        voiceModelId: 'gpt-live-1-codex',
        ownerBootstrap: { mediaDriverId: 'codex-webrtc-v1', answerSdp: created.sdpAnswer },
        close: () => adapter.close(),
      };
    },
  };
}
