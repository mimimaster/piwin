import type { KnowledgeLlmConfig, ModelProviderConfig, PiwinConfig } from '@piwin/contracts';
import type { CompleteJsonFn } from '@piwin/doc-rag';
import { findEnabledProvider, resolveConfiguredDefaultModelRef } from './provider-helpers.js';
import { completeStructured } from './structured-completion.js';

export function createDoccardsCompleteJson(
  loadConfig: () => Promise<PiwinConfig>,
  stage: 'extraction' | 'flashcard' = 'flashcard',
): CompleteJsonFn {
  return async (request) => {
    const config = await loadConfig();
    const llm = stage === 'extraction' ? config.knowledge?.extractionLlm : config.knowledge?.flashcardLlm;
    const resolved = resolveKnowledgeModel(config, llm);
    if (!resolved) {
      throw new Error('GENERATION_MODEL_NOT_CONFIGURED');
    }
    return completeStructured(
      {
        provider: resolved.provider,
        modelId: resolved.modelId,
        systemPrompt: request.systemPrompt,
        userPrompt: request.userPrompt,
        jsonSchema: request.jsonSchema,
        schemaName: request.schemaName,
        maxOutputTokens: llm?.maxOutputTokens ?? 4000,
        temperature: llm?.temperature ?? 0.2,
        signal: request.signal ?? new AbortController().signal,
        // Two-stage generate plus a repair pass needs more than the
        // walkthrough default; local proxies often queue past 60s.
        timeoutMs: 180_000,
        label: 'Doc Cards',
      },
      (value) => value,
    );
  };
}

/** One CompleteJsonFn that picks extraction vs flashcard model from schemaName. */
export function createTwoStageCompleteJson(loadConfig: () => Promise<PiwinConfig>): CompleteJsonFn {
  const extract = createDoccardsCompleteJson(loadConfig, 'extraction');
  const cards = createDoccardsCompleteJson(loadConfig, 'flashcard');
  return async (request) =>
    request.schemaName === 'knowledge_points' ? extract(request) : cards(request);
}

function resolveKnowledgeModel(
  config: PiwinConfig,
  llm: KnowledgeLlmConfig | undefined,
): { provider: ModelProviderConfig; modelId: string } | undefined {
  const ref = llm?.modelRef?.trim();
  if (ref) {
    const slash = ref.indexOf('/');
    if (slash > 0) {
      const provider = findEnabledProvider(config, ref.slice(0, slash));
      const modelId = ref.slice(slash + 1);
      if (provider && modelId) return { provider, modelId };
    }
    const fallbackProvider = config.defaultProviderId
      ? findEnabledProvider(config, config.defaultProviderId)
      : undefined;
    if (fallbackProvider) return { provider: fallbackProvider, modelId: ref };
  }
  const resolved = resolveConfiguredDefaultModelRef(config);
  if (!resolved) return undefined;
  const provider = findEnabledProvider(config, resolved.providerId);
  return provider ? { provider, modelId: resolved.modelId } : undefined;
}
