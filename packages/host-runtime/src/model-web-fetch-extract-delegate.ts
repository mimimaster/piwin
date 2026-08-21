/** Host composition for a configured model-backed `web_fetch` extract. */

import type {
  ModelConfigEntry,
  ModelProviderConfig,
  ModelRef,
  PiwinConfig,
  WebConfig,
  WebFetchExtractDelegate,
} from '@piwin/contracts';
import { isModelEnabled, modelSupportsCapability } from '@piwin/contracts';
import {
  FETCH_EXTRACT_SYSTEM_PROMPT,
  buildFetchExtractUserPrompt,
  clampFetchExtractOutput,
  sliceFetchExtractInput,
} from '@piwin/tools-web';
import { findConfiguredModel } from './capabilities/search-route-resolver.js';
import {
  completeStructuredText,
  type StructuredCompletionRequest,
  type StructuredCompletionResult,
} from './structured-completion.js';
import type { SecretResolver } from './secret-resolver.js';

const EXTRACT_TEMPERATURE = 0;
const EXTRACT_MAX_OUTPUT_TOKENS = 2_048;
const EXTRACT_TIMEOUT_MS = 60_000;

export type ReadyFetchExtractDelegate = {
  provider: ModelProviderConfig;
  model: ModelConfigEntry;
  ref: ModelRef;
};

export type BuildWebFetchExtractDelegateDependencies = {
  complete?: (request: StructuredCompletionRequest) => Promise<StructuredCompletionResult>;
};

/** Resolve a chat-capable model selected for focused `web_fetch` extraction. */
export function findReadyFetchExtractDelegate(
  config: Pick<PiwinConfig, 'providers'> & { web?: Pick<WebConfig, 'fetchDelegateModel'> },
  modelRef: ModelRef | undefined = config.web?.fetchDelegateModel,
): ReadyFetchExtractDelegate | undefined {
  if (!modelRef) {
    return undefined;
  }
  const configured = findConfiguredModel(config, modelRef);
  if (
    !configured ||
    configured.provider.protocol !== modelRef.protocol ||
    !isModelEnabled(configured.model) ||
    !modelSupportsCapability(configured.model, 'chat')
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

/** Build the lazy extract delegate selected in Web config. */
export function buildWebFetchExtractDelegate(
  config: PiwinConfig,
  secretResolver: Pick<SecretResolver, 'resolveProviderSecret'>,
  dependencies: BuildWebFetchExtractDelegateDependencies = {},
): WebFetchExtractDelegate | undefined {
  const configured = findReadyFetchExtractDelegate(config);
  if (!configured) {
    return undefined;
  }
  const complete =
    dependencies.complete ??
    ((request: StructuredCompletionRequest) =>
      completeStructuredText(request, {
        resolveSecret: async (provider) => {
          const hasSecretSource = Boolean(
            provider.apiKeyRef?.trim() || provider.apiKeyEnv?.trim(),
          );
          if (!hasSecretSource) {
            return null;
          }
          return secretResolver.resolveProviderSecret(provider);
        },
      }));

  return {
    model: configured.ref,
    async extract(input, options) {
      const signal = options?.signal ?? new AbortController().signal;
      const result = await complete({
        provider: configured.provider,
        modelId: configured.model.id,
        systemPrompt: FETCH_EXTRACT_SYSTEM_PROMPT,
        userPrompt: buildFetchExtractUserPrompt({
          ...input,
          text: sliceFetchExtractInput(input.text),
        }),
        temperature: EXTRACT_TEMPERATURE,
        maxOutputTokens: EXTRACT_MAX_OUTPUT_TOKENS,
        signal,
        timeoutMs: EXTRACT_TIMEOUT_MS,
        label: 'web_fetch extract',
      });
      const extracted = clampFetchExtractOutput(result.text);
      if (!extracted) {
        throw new Error('web_fetch extract returned no text');
      }
      return extracted;
    },
  };
}
