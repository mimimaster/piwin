import type {
  ModelRef,
  PiwinConfig,
  SearchRoutePreviewData,
  SearchRoutePreviewInput,
} from '@piwin/contracts';
import {
  defaultNativeSearchAdapterSupport,
  findConfiguredModel,
  resolveSearchRoute,
} from './search-route-resolver.js';

export function buildSearchRoutePreview(
  config: Pick<PiwinConfig, 'providers' | 'defaultProviderId' | 'defaultModelId'>,
  input: SearchRoutePreviewInput,
): SearchRoutePreviewData {
  const configured = findConfiguredModel(config);
  const model: ModelRef | undefined = configured
    ? {
        protocol: configured.provider.protocol,
        providerId: configured.provider.id,
        modelId: configured.model.id,
      }
    : undefined;
  const route = resolveSearchRoute({
    ...(configured?.model ? { model: configured.model } : {}),
    web: {
      searchSources: input.searchSources,
      searchRoutePolicy: input.policy,
    },
    adapter: defaultNativeSearchAdapterSupport(),
  });

  return {
    route,
    ...(model ? { model } : {}),
    ...(configured?.model.label ? { modelLabel: configured.model.label } : {}),
  };
}
