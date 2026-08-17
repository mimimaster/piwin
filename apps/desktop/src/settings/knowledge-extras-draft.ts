/**
 * Draft helpers for optional knowledge extras: parsers, reranker, and
 * generation LLMs. Embedding stays in knowledge-embedding-draft.ts.
 */
import type { PiwinConfig } from '@piwin/contracts';
import { isModelEnabled, isProviderEnabled, modelSupportsCapability } from '@piwin/contracts';

export const KNOWLEDGE_RERANKER_SECRET_ID = 'knowledge-reranker';
export const DEFAULT_RERANKER_API_KEY_ENV = 'RERANKER_API_KEY';

export type KnowledgeChatModelOption = {
  key: string;
  label: string;
};

export type KnowledgeExtrasDraft = {
  mineruEnabled: boolean;
  unstructuredEnabled: boolean;
  rerankerEnabled: boolean;
  rerankerBaseUrl: string;
  rerankerModel: string;
  rerankerApiKeyEnv: string;
  rerankerApiKeyRef: string;
  extractionModelKey: string;
  flashcardModelKey: string;
};

export function emptyKnowledgeExtrasDraft(): KnowledgeExtrasDraft {
  return {
    mineruEnabled: false,
    unstructuredEnabled: false,
    rerankerEnabled: false,
    rerankerBaseUrl: '',
    rerankerModel: '',
    rerankerApiKeyEnv: '',
    rerankerApiKeyRef: '',
    extractionModelKey: '',
    flashcardModelKey: '',
  };
}

export function knowledgeChatModelOptions(config: PiwinConfig | null | undefined): KnowledgeChatModelOption[] {
  if (!config) return [];
  return config.providers.flatMap((provider) =>
    isProviderEnabled(provider)
      ? provider.models
          .filter((model) => isModelEnabled(model) && modelSupportsCapability(model, 'chat'))
          .map((model) => ({
            key: `${provider.id}/${model.id}`,
            label: `${provider.name || provider.id} · ${model.label || model.id}`,
          }))
      : [],
  );
}

export function knowledgeExtrasFromConfig(
  config: PiwinConfig | null | undefined,
): KnowledgeExtrasDraft {
  const knowledge = config?.knowledge;
  const defaultKey =
    config?.defaultProviderId && config.defaultModelId
      ? `${config.defaultProviderId}/${config.defaultModelId}`
      : '';
  return {
    mineruEnabled: knowledge?.parser?.mineru?.enabled === true,
    unstructuredEnabled: knowledge?.parser?.unstructured?.enabled === true,
    rerankerEnabled: knowledge?.reranker?.enabled === true,
    rerankerBaseUrl: knowledge?.reranker?.baseUrl ?? '',
    rerankerModel: knowledge?.reranker?.model ?? '',
    rerankerApiKeyEnv: knowledge?.reranker?.apiKeyEnv ?? '',
    rerankerApiKeyRef: knowledge?.reranker?.apiKeyRef ?? '',
    extractionModelKey: knowledge?.extractionLlm?.modelRef ?? defaultKey,
    flashcardModelKey: knowledge?.flashcardLlm?.modelRef ?? defaultKey,
  };
}

export function validateKnowledgeExtrasDraft(draft: KnowledgeExtrasDraft): string | null {
  if (!draft.rerankerEnabled) return null;
  if (!draft.rerankerBaseUrl.trim()) return 'rerankerBaseUrl';
  if (!draft.rerankerModel.trim()) return 'rerankerModel';
  return null;
}

export function knowledgeExtrasDirty(
  left: KnowledgeExtrasDraft,
  right: KnowledgeExtrasDraft,
): boolean {
  return (
    left.mineruEnabled !== right.mineruEnabled ||
    left.unstructuredEnabled !== right.unstructuredEnabled ||
    left.rerankerEnabled !== right.rerankerEnabled ||
    left.rerankerBaseUrl.trim() !== right.rerankerBaseUrl.trim() ||
    left.rerankerModel.trim() !== right.rerankerModel.trim() ||
    left.rerankerApiKeyEnv.trim() !== right.rerankerApiKeyEnv.trim() ||
    left.rerankerApiKeyRef.trim() !== right.rerankerApiKeyRef.trim() ||
    left.extractionModelKey !== right.extractionModelKey ||
    left.flashcardModelKey !== right.flashcardModelKey
  );
}

export function applyKnowledgeExtras(
  config: PiwinConfig,
  draft: KnowledgeExtrasDraft,
): PiwinConfig {
  const knowledge = { ...(config.knowledge ?? {}) };
  const parser = { ...(knowledge.parser ?? {}) };
  parser.mineru = {
    ...(parser.mineru ?? {}),
    enabled: draft.mineruEnabled,
  };
  parser.unstructured = {
    ...(parser.unstructured ?? {}),
    enabled: draft.unstructuredEnabled,
    ...(draft.unstructuredEnabled ? { mode: 'http' as const } : {}),
  };
  knowledge.parser = parser;

  if (draft.rerankerEnabled) {
    knowledge.reranker = {
      ...(knowledge.reranker ?? {}),
      enabled: true,
      provider: 'openai-compatible',
      baseUrl: draft.rerankerBaseUrl.trim(),
      model: draft.rerankerModel.trim(),
      ...(draft.rerankerApiKeyEnv.trim() ? { apiKeyEnv: draft.rerankerApiKeyEnv.trim() } : {}),
      ...(draft.rerankerApiKeyRef.trim() ? { apiKeyRef: draft.rerankerApiKeyRef.trim() } : {}),
    };
  } else if (knowledge.reranker) {
    knowledge.reranker = { ...knowledge.reranker, enabled: false };
  } else {
    delete knowledge.reranker;
  }

  if (draft.extractionModelKey.trim()) {
    knowledge.extractionLlm = {
      ...(knowledge.extractionLlm ?? {}),
      modelRef: draft.extractionModelKey.trim(),
    };
  } else {
    delete knowledge.extractionLlm;
  }
  if (draft.flashcardModelKey.trim()) {
    knowledge.flashcardLlm = {
      ...(knowledge.flashcardLlm ?? {}),
      modelRef: draft.flashcardModelKey.trim(),
    };
  } else {
    delete knowledge.flashcardLlm;
  }

  return { ...config, knowledge };
}
