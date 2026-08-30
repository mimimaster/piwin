import type { LiveGeminiThinkingLevel, LiveProviderDescriptor } from '@piwin/contracts';
import { isLiveCallErrorCode } from '@piwin/contracts';
import {
  GEMINI_LIVE_PROVIDER_ID,
  geminiLiveSettingFields,
  validateGeminiLiveSettings,
} from './gemini-live-schema.js';
import { geminiOwnerBootstrap, mintGeminiLiveToken } from './gemini-live-adapter.js';
import type { LiveProviderRegistration } from './live-provider-registration.js';

export function createGeminiLiveRegistration(deps: {
  authReady: () => Promise<boolean>;
  resolveApiKey: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
}): LiveProviderRegistration {
  return {
    descriptor(): LiveProviderDescriptor {
      return {
        providerId: GEMINI_LIVE_PROVIDER_ID,
        title: 'Gemini',
        mediaKind: 'pcm-websocket',
        mediaDriverId: 'gemini-live-v1beta',
        auth: { kind: 'api-key', providerId: GEMINI_LIVE_PROVIDER_ID, keyConfigured: false },
        settings: geminiLiveSettingFields(),
      };
    },
    authReady: () => deps.authReady(),
    validateSettings: (values) => validateGeminiLiveSettings(values),
    async start(input) {
      if (input.clientBootstrap.mediaDriverId !== 'gemini-live-v1beta') {
        throw new Error('live-media-unsupported');
      }
      const settings = validateGeminiLiveSettings(input.settings);
      if (!settings.ok) throw new Error(settings.message);
      const apiKey = await deps.resolveApiKey();
      if (!apiKey) throw new Error('live-provider-auth');
      const thinkingLevel = settings.normalized.thinkingLevel as LiveGeminiThinkingLevel;
      try {
        const token = await mintGeminiLiveToken(
          {
            apiKey,
            modelId: settings.normalized.model ?? '',
            voice: settings.normalized.voice ?? '',
            thinkingLevel,
            signal: input.signal,
          },
          deps.fetchImpl,
        );
        return {
          voiceModelId: settings.normalized.model ?? '',
          ownerBootstrap: geminiOwnerBootstrap({
            tokenName: token.name,
            modelId: settings.normalized.model ?? '',
            voice: settings.normalized.voice ?? '',
            thinkingLevel,
          }),
          close: async () => undefined,
        };
      } catch (error: unknown) {
        if (error instanceof Error && isLiveCallErrorCode(error.message)) throw error;
        throw new Error('live-protocol-failed');
      }
    },
  };
}
