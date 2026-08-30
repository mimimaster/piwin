import type { ModelProviderConfig, PiwinConfig } from '@piwin/contracts';
import {
  encodeOpenaiRealtimeRouteId,
  modelLooksRealtimeAudio,
  type OpenaiRealtimeRoute,
} from '@piwin/voice';

export function listOpenaiRealtimeRoutesFromConfig(
  config: PiwinConfig,
): OpenaiRealtimeRoute[] {
  const routes: OpenaiRealtimeRoute[] = [];
  for (const provider of config.providers ?? []) {
    if (!isOpenaiCompatibleProvider(provider)) continue;
    if (provider.enabled === false) continue;
    const baseUrl = provider.baseUrl?.trim();
    if (!baseUrl) continue;
    const providerName = provider.name?.trim() || provider.id;
    for (const model of provider.models ?? []) {
      if (model.enabled === false) continue;
      if (!modelLooksRealtimeAudio(model)) continue;
      routes.push({
        routeId: encodeOpenaiRealtimeRouteId(provider.id, model.id),
        providerId: provider.id,
        providerName,
        modelId: model.id,
        modelLabel: model.label?.trim() || model.id,
        baseUrl,
      });
    }
  }
  return routes;
}

function isOpenaiCompatibleProvider(
  provider: ModelProviderConfig,
): provider is ModelProviderConfig & { protocol: 'openai-compatible'; baseUrl: string } {
  return provider.protocol === 'openai-compatible' && typeof provider.baseUrl === 'string';
}
