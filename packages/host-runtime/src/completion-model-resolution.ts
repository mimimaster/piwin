/**
 * Shared model/provider resolution for non-session completions (Walkthrough).
 */
import type { ModelProviderConfig, ModelRef, PiwinConfig } from '@piwin/contracts';
import { findEnabledProvider } from './provider-helpers.js';

export type CompletionProviderResolutionError =
  | 'provider-not-found'
  | 'unsupported-provider'
  | 'model-not-configured';

export type CompletionProviderResolution =
  | { provider: ModelProviderConfig }
  | { error: CompletionProviderResolutionError };

/**
 * Validates that a ModelRef points to a configured, enabled provider and that
 * the provider protocol matches. Walkthrough maps the error codes as-is.
 */
export function resolveProviderForModel(
  model: ModelRef,
  config: PiwinConfig,
): CompletionProviderResolution {
  const provider = findEnabledProvider(config, model.providerId);
  if (!provider) {
    return { error: 'provider-not-found' };
  }
  if (provider.protocol !== model.protocol) {
    return { error: 'unsupported-provider' };
  }
  const modelExists = provider.models.some((entry) => entry.id === model.modelId);
  if (!modelExists) {
    return { error: 'model-not-configured' };
  }
  return { provider };
}
