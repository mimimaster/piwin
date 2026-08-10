import type {
  DiscoveredModel,
  ModelProviderConfig,
  VideoGenerationApiStyle,
} from '@piwin/contracts';
import {
  defaultVideoGenerationApiStyle,
  defaultVideoGenerationPath,
} from './video-generation-model-config.js';

/** Return only video discovery suggestions, with recognized models first. */
export function sortVideoDiscoveryModels(models: readonly DiscoveredModel[]): DiscoveredModel[] {
  return [...models]
    .filter((model) => model.videoGenerationSuggestion !== undefined)
    .sort((left, right) => {
      const leftRank = left.capabilities?.includes('video-generation') ? 0 : 1;
      const rightRank = right.capabilities?.includes('video-generation') ? 0 : 1;
      return leftRank - rightRank || left.id.localeCompare(right.id);
    });
}

/**
 * Project one transient discovery suggestion into the existing form fields.
 * This function never mutates config; saving remains an explicit form action.
 */
export function applyVideoDiscoverySuggestion(
  model: DiscoveredModel,
  current: { apiStyle: VideoGenerationApiStyle; path: string; label: string },
  provider?: Pick<ModelProviderConfig, 'protocol'>,
): {
  id: string;
  apiStyle: VideoGenerationApiStyle;
  path: string;
  label: string;
} {
  const suggestion = model.videoGenerationSuggestion;
  const apiStyle =
    suggestion?.apiStyle ??
    current.apiStyle ??
    (provider ? defaultVideoGenerationApiStyle(provider.protocol) : 'custom');
  return {
    id: model.id,
    apiStyle,
    path: (suggestion?.path ?? current.path.trim()) || defaultVideoGenerationPath(apiStyle),
    label: current.label.trim() || suggestion?.label || model.label || '',
  };
}
