/**
 * Host composition for the provider-native `web_search` executor (ADR 0043).
 *
 * Executor choice: the fixed `searchDelegateModel` first; otherwise the
 * current chat model when it is tagged `native-web-search` with an adapter
 * that is expressible for its provider transport. Credentials resolve lazily
 * on the first search.
 */

import type { ModelConfigEntry, ModelProviderConfig, ModelRef, PiwinConfig } from '@piwin/contracts';
import { completeNativeModelWebSearch } from '@piwin/agent-host';
import type { WebSearchModelDelegate } from '@piwin/tools-web';
import {
  findConfiguredModel,
  findReadyWebSearchDelegate,
  resolveConfiguredNativeSearchSupport,
} from './capabilities/search-route-resolver.js';
import type { SecretResolver } from './secret-resolver.js';
import { resolveSubscriptionChatTarget } from './subscription-chat-request.js';
import type { SubscriptionMediaAuth } from './subscription-media-request.js';
import { isModelEnabled, modelSupportsCapability, resolveModelEndpoint } from '@piwin/contracts';

export type BuildWebSearchModelDelegateDependencies = {
  complete?: typeof completeNativeModelWebSearch;
  loadSubscriptionAuth?: (providerId: string) => Promise<SubscriptionMediaAuth>;
};

export type BuildWebSearchModelDelegateOptions = {
  /** Current generation's chat model; used when no fixed delegate is configured. */
  chatModel?: ModelRef;
};

/** Resolve which configured model executes native `web_search`, if any. */
export function resolveNativeWebSearchExecutor(
  config: PiwinConfig,
  chatModel?: ModelRef,
): { provider: ModelProviderConfig; model: ModelConfigEntry; ref: ModelRef } | undefined {
  if (config.web?.searchDelegateModel) {
    // A configured delegate is exclusive: stale → fail closed, never the chat model.
    return findReadyWebSearchDelegate(config);
  }
  const configured = findConfiguredModel(config, chatModel);
  if (
    !configured ||
    !isModelEnabled(configured.model) ||
    !modelSupportsCapability(configured.model, 'native-web-search') ||
    !resolveConfiguredNativeSearchSupport(configured).requestSupported
  ) {
    return undefined;
  }
  return {
    ...configured,
    ref: {
      protocol: configured.provider.protocol,
      providerId: configured.provider.id,
      modelId: configured.model.id,
    },
  };
}

/** Build the lazy, credential-safe native executor for this generation. */
export function buildWebSearchModelDelegate(
  config: PiwinConfig,
  secretResolver: Pick<SecretResolver, 'resolveProviderSecret'>,
  dependencies: BuildWebSearchModelDelegateDependencies = {},
  options: BuildWebSearchModelDelegateOptions = {},
): WebSearchModelDelegate | undefined {
  const configured = resolveNativeWebSearchExecutor(config, options.chatModel);
  if (!configured) {
    return undefined;
  }
  const complete = dependencies.complete ?? completeNativeModelWebSearch;
  const timeoutMs = config.web?.searchNativeTimeoutMs;

  return {
    model: configured.ref,
    async search(query, searchOptions) {
      // Subscription chat compiles to `oauth://<id>`, which the native
      // executor cannot POST to; send it to the real HTTPS surface instead.
      // ADR 0079: the model may speak another wire format than its row.
      const endpoint = resolveModelEndpoint(configured.provider, configured.model);
      const subscription = await resolveSubscriptionChatTarget(
        endpoint,
        ...(dependencies.loadSubscriptionAuth ? [dependencies.loadSubscriptionAuth] : []),
      );
      const provider = subscription?.provider ?? endpoint;
      const hasSecretSource = Boolean(
        configured.provider.apiKeyRef?.trim() || configured.provider.apiKeyEnv?.trim(),
      );
      const apiKey =
        subscription?.apiKey ??
        (hasSecretSource ? await secretResolver.resolveProviderSecret(configured.provider) : undefined);
      return complete({
        provider,
        modelId: configured.model.id,
        ...(apiKey ? { apiKey } : {}),
        query,
        maxResults: searchOptions.limit,
        ...(searchOptions.signal ? { signal: searchOptions.signal } : {}),
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      });
    },
  };
}
