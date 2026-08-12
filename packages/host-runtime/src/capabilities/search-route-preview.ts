import type {
  ModelRef,
  PiwinConfig,
  SearchRoutePreviewData,
  SearchRoutePreviewInput,
} from '@piwin/contracts';
import {
  findReadyWebSearchDelegate,
  findConfiguredModel,
  resolveNativeSearchAdapterSupport,
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
      ...(input.searchDelegateModel ? { searchDelegateModel: input.searchDelegateModel } : {}),
    },
    adapter: resolveNativeSearchAdapterSupport(configured?.provider.protocol),
    externalDelegateReady: Boolean(findReadyWebSearchDelegate(config, input.searchDelegateModel)),
  });

  return {
    route,
    ...(model ? { model } : {}),
    ...(configured?.model.label ? { modelLabel: configured.model.label } : {}),
  };
}
