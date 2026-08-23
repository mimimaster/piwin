/**
 * Draft helpers for optional knowledge extras: parsers, reranker, and
 * generation LLMs. Embedding stays in knowledge-embedding-draft.ts.
 */
import type {
  KnowledgeConfig,
  KnowledgeMineruConfig,
  KnowledgeParserHttpConfig,
  NotesKnowledgeExtras,
  PiwinConfig,
} from '@piwin/contracts';
import { isModelEnabled, isProviderEnabled, modelSupportsCapability } from '@piwin/contracts';

export const KNOWLEDGE_RERANKER_SECRET_ID = 'knowledge-reranker';
export const KNOWLEDGE_MINERU_SECRET_ID = 'knowledge-mineru';
export const KNOWLEDGE_UNSTRUCTURED_SECRET_ID = 'knowledge-unstructured';
export const DEFAULT_RERANKER_URL = 'https://api.openai.com/v1';
export const DEFAULT_RERANKER_API_KEY_ENV = 'RERANKER_API_KEY';
export const DEFAULT_MINERU_URL = 'http://127.0.0.1:8000';
export const DEFAULT_UNSTRUCTURED_URL = 'http://127.0.0.1:8000';
export const DEFAULT_MINERU_API_KEY_ENV = 'MINERU_API_KEY';
export const DEFAULT_UNSTRUCTURED_API_KEY_ENV = 'UNSTRUCTURED_API_KEY';

export type KnowledgeChatModelOption = {
  key: string;
  label: string;
};

export type KnowledgeExtrasDraft = {
  mineruEnabled: boolean;
  mineruBaseUrl: string;
  mineruApiKeyEnv: string;
  mineruApiKeyRef: string;
  mineruApiKeyInput?: string;
  unstructuredEnabled: boolean;
  unstructuredBaseUrl: string;
  unstructuredApiKeyEnv: string;
  unstructuredApiKeyRef: string;
  unstructuredApiKeyInput?: string;
  rerankerEnabled: boolean;
  rerankerBaseUrl: string;
  rerankerModel: string;
  rerankerApiKeyEnv: string;
  rerankerApiKeyRef: string;
  rerankerApiKeyInput?: string;
  extractionModelKey: string;
  flashcardModelKey: string;
};

export function emptyKnowledgeExtrasDraft(): KnowledgeExtrasDraft {
  return {
    mineruEnabled: false,
    mineruBaseUrl: '',
    mineruApiKeyEnv: '',
    mineruApiKeyRef: '',
    mineruApiKeyInput: '',
    unstructuredEnabled: false,
    unstructuredBaseUrl: '',
    unstructuredApiKeyEnv: '',
    unstructuredApiKeyRef: '',
    unstructuredApiKeyInput: '',
    rerankerEnabled: false,
    rerankerBaseUrl: '',
    rerankerModel: '',
    rerankerApiKeyEnv: '',
    rerankerApiKeyRef: '',
    rerankerApiKeyInput: '',
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
  const mirrored = config?.notes?.knowledgeExtras;
  const parser = knowledge?.parser ?? mirrored?.parser;
  const reranker = knowledge?.reranker ?? mirrored?.reranker;
  const extraction = knowledge?.extractionLlm ?? mirrored?.extractionLlm;
  const flashcard = knowledge?.flashcardLlm ?? mirrored?.flashcardLlm;
  return {
    mineruEnabled: parser?.mineru?.enabled === true,
    mineruBaseUrl: parser?.mineru?.baseUrl ?? '',
    mineruApiKeyEnv: parser?.mineru?.apiKeyEnv ?? '',
    mineruApiKeyRef: parser?.mineru?.apiKeyRef ?? '',
    unstructuredEnabled: parser?.unstructured?.enabled === true,
    unstructuredBaseUrl: parser?.unstructured?.baseUrl ?? '',
    unstructuredApiKeyEnv: parser?.unstructured?.apiKeyEnv ?? '',
    unstructuredApiKeyRef: parser?.unstructured?.apiKeyRef ?? '',
    rerankerEnabled: reranker?.enabled === true,
    rerankerBaseUrl: reranker?.baseUrl ?? '',
    rerankerModel: reranker?.model ?? '',
    rerankerApiKeyEnv: reranker?.apiKeyEnv ?? '',
    rerankerApiKeyRef: reranker?.apiKeyRef ?? '',
    extractionModelKey: extraction?.modelRef ?? '',
    flashcardModelKey: flashcard?.modelRef ?? '',
  };
}

export function validateKnowledgeExtrasDraft(draft: KnowledgeExtrasDraft): string | null {
  if (draft.mineruEnabled && !draft.mineruBaseUrl.trim()) return 'mineruBaseUrl';
  if (draft.unstructuredEnabled && !draft.unstructuredBaseUrl.trim()) {
    return 'unstructuredBaseUrl';
  }
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
    left.mineruBaseUrl.trim() !== right.mineruBaseUrl.trim() ||
    left.mineruApiKeyEnv.trim() !== right.mineruApiKeyEnv.trim() ||
    left.mineruApiKeyRef.trim() !== right.mineruApiKeyRef.trim() ||
    (left.mineruApiKeyInput?.trim() ?? '') !== (right.mineruApiKeyInput?.trim() ?? '') ||
    left.unstructuredEnabled !== right.unstructuredEnabled ||
    left.unstructuredBaseUrl.trim() !== right.unstructuredBaseUrl.trim() ||
    left.unstructuredApiKeyEnv.trim() !== right.unstructuredApiKeyEnv.trim() ||
    left.unstructuredApiKeyRef.trim() !== right.unstructuredApiKeyRef.trim() ||
    (left.unstructuredApiKeyInput?.trim() ?? '') !== (right.unstructuredApiKeyInput?.trim() ?? '') ||
    left.rerankerEnabled !== right.rerankerEnabled ||
    left.rerankerBaseUrl.trim() !== right.rerankerBaseUrl.trim() ||
    left.rerankerModel.trim() !== right.rerankerModel.trim() ||
    left.rerankerApiKeyEnv.trim() !== right.rerankerApiKeyEnv.trim() ||
    left.rerankerApiKeyRef.trim() !== right.rerankerApiKeyRef.trim() ||
    (left.rerankerApiKeyInput?.trim() ?? '') !== (right.rerankerApiKeyInput?.trim() ?? '') ||
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
  parser.mineru = applyParserHttpConfig(parser.mineru, {
    enabled: draft.mineruEnabled,
    baseUrl: draft.mineruBaseUrl,
    apiKeyEnv: draft.mineruApiKeyEnv,
    apiKeyRef: draft.mineruApiKeyRef,
  });
  parser.unstructured = applyParserHttpConfig(parser.unstructured, {
    enabled: draft.unstructuredEnabled,
    baseUrl: draft.unstructuredBaseUrl,
    apiKeyEnv: draft.unstructuredApiKeyEnv,
    apiKeyRef: draft.unstructuredApiKeyRef,
  });
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

  const notes = { ...(config.notes ?? {}) };
  const mirrored = notesKnowledgeExtrasFromKnowledge(knowledge);
  if (mirrored) {
    notes.knowledgeExtras = mirrored;
  } else {
    delete notes.knowledgeExtras;
  }

  const next: PiwinConfig = { ...config, knowledge };
  if (Object.keys(notes).length > 0) {
    next.notes = notes;
  } else {
    delete next.notes;
  }
  return next;
}

function applyParserHttpConfig<T extends KnowledgeMineruConfig | KnowledgeParserHttpConfig>(
  existing: T | undefined,
  draft: { enabled: boolean; baseUrl: string; apiKeyEnv: string; apiKeyRef: string },
): T {
  const next: T = { ...(existing ?? ({} as T)), enabled: draft.enabled };
  const baseUrl = draft.baseUrl.trim();
  if (baseUrl) {
    next.mode = 'http';
    next.baseUrl = baseUrl;
  }
  if (draft.apiKeyEnv.trim()) next.apiKeyEnv = draft.apiKeyEnv.trim();
  else delete next.apiKeyEnv;
  if (draft.apiKeyRef.trim()) next.apiKeyRef = draft.apiKeyRef.trim();
  else delete next.apiKeyRef;
  return next;
}

function notesKnowledgeExtrasFromKnowledge(
  knowledge: KnowledgeConfig,
): NotesKnowledgeExtras | undefined {
  const extras: NotesKnowledgeExtras = {};
  if (knowledge.parser) extras.parser = knowledge.parser;
  if (knowledge.reranker) extras.reranker = knowledge.reranker;
  if (knowledge.extractionLlm) extras.extractionLlm = knowledge.extractionLlm;
  if (knowledge.flashcardLlm) extras.flashcardLlm = knowledge.flashcardLlm;
  return Object.keys(extras).length > 0 ? extras : undefined;
}
