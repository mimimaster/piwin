import {
  LiveProviderRegistry,
  createCodexLiveRegistration,
  createFakeCodexRegistration,
  createGeminiLiveRegistration,
  createOpenaiRealtimeLiveRegistration,
  type FakeRealtimeVoiceAdapter,
} from '@piwin/voice';
import { loadPiwinConfig, savePiwinConfig } from '../config-store.js';
import { createSecretResolver } from '../secret-resolver.js';
import { createLiveSettingsService, type LiveSettingsService } from './live-settings-service.js';
import { listOpenaiRealtimeRoutesFromConfig } from './openai-realtime-routes.js';
import type { LiveCallCoordinator } from './live-call-coordinator.js';

export type ComposedLiveSettings = {
  service: LiveSettingsService;
  registry: LiveProviderRegistry;
  lastFakeAdapter: () => FakeRealtimeVoiceAdapter | null;
};

export function composeLiveSettings(input: {
  piwinRoot?: string;
  mock?: boolean;
  authReady: () => Promise<boolean>;
  resolveAuth: () => Promise<{ accessToken: string; accountId: string } | null>;
  getCoordinator: () => LiveCallCoordinator | null;
}): ComposedLiveSettings {
  const secrets = createSecretResolver(
    input.piwinRoot === undefined ? {} : { piwinRoot: input.piwinRoot },
  );
  const fakeCodex = input.mock === true ? createFakeCodexRegistration() : null;
  const registry = new LiveProviderRegistry([
    fakeCodex ??
      createCodexLiveRegistration({
        authReady: input.authReady,
        resolveAuth: input.resolveAuth,
      }),
    createGeminiLiveRegistration({
      authReady: async () => (await secrets.readProviderSecret('google-gemini')) !== null,
      resolveApiKey: () => secrets.readProviderSecret('google-gemini'),
    }),
    createOpenaiRealtimeLiveRegistration({
      listRoutes: async () =>
        listOpenaiRealtimeRoutesFromConfig(await loadPiwinConfig(input.piwinRoot)),
      resolveApiKey: (providerId) => secrets.readProviderSecret(providerId),
    }),
  ]);
  const service = createLiveSettingsService({
    registry,
    loadConfig: () => loadPiwinConfig(input.piwinRoot),
    saveConfig: (config) => savePiwinConfig(config, input.piwinRoot).then(() => undefined),
    keyConfigured: async (providerId) => (await secrets.readProviderSecret(providerId)) !== null,
    writeKey: async (providerId, key) => {
      await secrets.writeProviderSecret(providerId, key);
    },
    deleteKey: async (providerId) => {
      await secrets.deleteProviderSecret(providerId);
    },
    endCallIfCurrent: async (providerId) => {
      const coordinator = input.getCoordinator();
      const call = coordinator?.status({
        capabilities: {
          microphone: true,
          mediaDriverIds: ['codex-webrtc-v1', 'gemini-live-v1beta', 'openai-realtime-ws-v1'],
        },
      }).call;
      if (call && call.providerId === providerId) {
        await coordinator?.endByHost('settings');
      }
    },
  });
  return {
    service,
    registry,
    lastFakeAdapter: () => fakeCodex?.lastAdapter() ?? null,
  };
}
