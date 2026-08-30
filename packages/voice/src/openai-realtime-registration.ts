import type { LiveProviderDescriptor } from '@piwin/contracts';
import { isLiveCallErrorCode } from '@piwin/contracts';
import {
  openaiRealtimeOwnerBootstrap,
  tryMintOpenaiRealtimeClientSecret,
} from './openai-realtime-adapter.js';
import type { LiveProviderRegistration } from './live-provider-registration.js';
import {
  OPENAI_REALTIME_LIVE_PROVIDER_ID,
  OPENAI_REALTIME_MEDIA_DRIVER_ID,
  type OpenaiRealtimeRoute,
  openaiRealtimeLiveSettingFields,
  validateOpenaiRealtimeLiveSettings,
} from './openai-realtime-schema.js';

export function createOpenaiRealtimeLiveRegistration(deps: {
  listRoutes: () => Promise<readonly OpenaiRealtimeRoute[]> | readonly OpenaiRealtimeRoute[];
  resolveApiKey: (providerId: string) => Promise<string | null>;
  fetchImpl?: typeof fetch;
}): LiveProviderRegistration {
  async function routes(): Promise<readonly OpenaiRealtimeRoute[]> {
    return await Promise.resolve(deps.listRoutes());
  }

  let cachedRoutes: readonly OpenaiRealtimeRoute[] = [];

  function describe(): LiveProviderDescriptor {
    const defaultRoute = cachedRoutes[0];
    return {
      providerId: OPENAI_REALTIME_LIVE_PROVIDER_ID,
      title: 'OpenAI Realtime',
      mediaKind: 'pcm-websocket',
      mediaDriverId: OPENAI_REALTIME_MEDIA_DRIVER_ID,
      auth: {
        kind: 'api-key',
        providerId: defaultRoute?.providerId ?? OPENAI_REALTIME_LIVE_PROVIDER_ID,
        keyConfigured: false,
      },
      settings: openaiRealtimeLiveSettingFields(cachedRoutes),
    };
  }

  return {
    descriptor: describe,
    async refresh() {
      cachedRoutes = await routes();
    },
    async authReady() {
      const available = cachedRoutes.length > 0 ? cachedRoutes : await routes();
      cachedRoutes = available;
      for (const route of available) {
        if ((await deps.resolveApiKey(route.providerId)) !== null) return true;
      }
      return false;
    },
    validateSettings(values) {
      const result = validateOpenaiRealtimeLiveSettings(values, cachedRoutes);
      if (!result.ok) return result;
      return { ok: true, normalized: result.normalized };
    },
    async start(input) {
      if (input.clientBootstrap.mediaDriverId !== OPENAI_REALTIME_MEDIA_DRIVER_ID) {
        throw new Error('live-media-unsupported');
      }
      const available = await routes();
      cachedRoutes = available;
      const settings = validateOpenaiRealtimeLiveSettings(input.settings, available);
      if (!settings.ok) throw new Error(settings.message);
      const apiKey = await deps.resolveApiKey(settings.route.providerId);
      if (!apiKey) throw new Error('live-provider-auth');
      const voice = settings.normalized.voice ?? 'eve';
      try {
        const minted = await tryMintOpenaiRealtimeClientSecret(
          {
            baseUrl: settings.route.baseUrl,
            apiKey,
            modelId: settings.route.modelId,
            signal: input.signal,
          },
          deps.fetchImpl,
        );
        return {
          voiceModelId: settings.route.modelId,
          ownerBootstrap: openaiRealtimeOwnerBootstrap({
            baseUrl: settings.route.baseUrl,
            bearerToken: minted ?? apiKey,
            modelId: settings.route.modelId,
            voice,
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
