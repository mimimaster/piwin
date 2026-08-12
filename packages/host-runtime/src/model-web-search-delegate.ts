/** Host composition for a configured model-backed `web_search` executor. */

import type { PiwinConfig } from '@piwin/contracts';
import { completeNativeModelWebSearch } from '@piwin/agent-host';
import { parseWebSearchModelResponse, type WebSearchModelDelegate } from '@piwin/tools-web';
import { findReadyWebSearchDelegate } from './capabilities/search-route-resolver.js';
import type { SecretResolver } from './secret-resolver.js';

export type BuildWebSearchModelDelegateDependencies = {
  complete?: typeof completeNativeModelWebSearch;
};

/** Build the lazy, credential-safe delegate selected in Web config. */
export function buildWebSearchModelDelegate(
  config: PiwinConfig,
  secretResolver: Pick<SecretResolver, 'resolveProviderSecret'>,
  dependencies: BuildWebSearchModelDelegateDependencies = {},
): WebSearchModelDelegate | undefined {
  const configured = findReadyWebSearchDelegate(config);
  if (!configured) {
    return undefined;
  }
  const complete = dependencies.complete ?? completeNativeModelWebSearch;

  return {
    model: configured.ref,
    async search(query, options) {
      const hasSecretSource = Boolean(
        configured.provider.apiKeyRef?.trim() || configured.provider.apiKeyEnv?.trim(),
      );
      const apiKey = hasSecretSource
        ? await secretResolver.resolveProviderSecret(configured.provider)
        : undefined;
      const text = await complete({
        provider: configured.provider,
        modelId: configured.model.id,
        ...(apiKey ? { apiKey } : {}),
        query,
        maxResults: options.limit,
        ...(options.signal ? { signal: options.signal } : {}),
      });
      return parseWebSearchModelResponse(text, options.limit);
    },
  };
}
