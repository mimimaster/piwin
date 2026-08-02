/**
 * Build the LLM rerank provider from product config (ADR 0018 §5, S8).
 * Uses the default (or first) openai-compatible chat provider — rerank rides
 * the user's existing session model, no separate rerank endpoint in v1.
 * Returns null when rerank is disabled or no usable provider exists.
 */
import type { PiwinConfig, RerankProvider } from '@piwin/contracts';
import { createLlmRerank } from '@piwin/notes';
import { createSecretResolver } from './secret-resolver.js';
import { getEnabledProviders } from './provider-helpers.js';

export async function buildNotesRerankProvider(
  config: PiwinConfig,
): Promise<RerankProvider | null> {
  if (config.notes?.rerank?.enabled !== true) {
    return null;
  }
  const enabled = getEnabledProviders(config);
  const provider =
    enabled.find(
      (candidate) =>
        candidate.id === config.defaultProviderId && candidate.protocol === 'openai-compatible',
    ) ?? enabled.find((candidate) => candidate.protocol === 'openai-compatible');
  if (!provider || provider.models.length === 0) {
    return null;
  }
  const modelId =
    provider.models.find((model) => model.id === config.defaultModelId)?.id ??
    provider.models[0]?.id;
  if (!modelId) {
    return null;
  }

  let apiKey: string | undefined;
  try {
    apiKey = await createSecretResolver().resolveProviderSecret(provider);
  } catch {
    // Endpoint may be local/keyless (LM Studio, vLLM); proceed without auth.
    apiKey = undefined;
  }
  return createLlmRerank({
    baseUrl: provider.baseUrl,
    model: modelId,
    ...(apiKey ? { apiKey } : {}),
  });
}
