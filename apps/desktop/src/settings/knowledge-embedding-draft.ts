/**
 * Draft + persist helpers for the shared notes / Doc Cards embedding config.
 *
 * Host maps `notes.embedding` onto `knowledge.embedding` when the latter is
 * absent. The settings page writes both so notes search and Doc Cards ingest
 * stay on the same provider without a second form.
 */
import type {
  KnowledgeEmbeddingConfig,
  NotesEmbeddingConfig,
  PiwinConfig,
} from '@piwin/contracts';

export type KnowledgeEmbeddingProviderKind = 'openai-compatible' | 'ollama';

export type KnowledgeEmbeddingDraft = {
  enabled: boolean;
  provider: KnowledgeEmbeddingProviderKind;
  baseUrl: string;
  model: string;
  apiKeyEnv: string;
  apiKeyRef: string;
  apiKeyInput?: string;
  dimension: string;
};

const ENVIRONMENT_VARIABLE_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const DEFAULT_OLLAMA_EMBEDDING_URL = 'http://127.0.0.1:11434/v1';
export const DEFAULT_OPENAI_EMBEDDING_URL = 'https://api.openai.com/v1';
export const NOTES_EMBEDDING_SECRET_ID = 'notes-embedding';
export const DEFAULT_EMBEDDING_API_KEY_ENV = 'EMBEDDING_API_KEY';

export function emptyKnowledgeEmbeddingDraft(): KnowledgeEmbeddingDraft {
  return {
    enabled: false,
    provider: 'openai-compatible',
    baseUrl: '',
    model: '',
    apiKeyEnv: '',
    apiKeyRef: '',
    apiKeyInput: '',
    dimension: '',
  };
}

export function knowledgeEmbeddingFromConfig(
  config: PiwinConfig | null | undefined,
): KnowledgeEmbeddingDraft {
  const notes = config?.notes?.embedding;
  const knowledge = config?.knowledge?.embedding;
  const source = notes ?? knowledgeToNotes(knowledge);
  const enabled = knowledge?.enabled === true || Boolean(notes);
  if (!source) {
    return {
      ...emptyKnowledgeEmbeddingDraft(),
      enabled,
      ...(knowledge?.provider === 'ollama' || knowledge?.provider === 'openai-compatible'
        ? { provider: knowledge.provider }
        : {}),
      ...(typeof knowledge?.baseUrl === 'string' ? { baseUrl: knowledge.baseUrl } : {}),
      ...(typeof knowledge?.model === 'string' ? { model: knowledge.model } : {}),
      ...(typeof knowledge?.apiKeyEnv === 'string' ? { apiKeyEnv: knowledge.apiKeyEnv } : {}),
      ...(typeof knowledge?.apiKeyRef === 'string' ? { apiKeyRef: knowledge.apiKeyRef } : {}),
      ...(typeof knowledge?.dimension === 'number' ? { dimension: String(knowledge.dimension) } : {}),
    };
  }
  return {
    enabled,
    provider: source.provider,
    baseUrl: source.baseUrl,
    model: source.model,
    apiKeyEnv: source.apiKeyEnv ?? '',
    apiKeyRef: source.apiKeyRef ?? '',
    dimension:
      typeof source.dimensions === 'number'
        ? String(source.dimensions)
        : typeof knowledge?.dimension === 'number'
          ? String(knowledge.dimension)
          : '',
  };
}

export function parseEmbeddingDimension(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    return undefined;
  }
  return value;
}

export function validateKnowledgeEmbeddingDraft(
  draft: KnowledgeEmbeddingDraft,
): string | null {
  if (!draft.enabled) {
    return null;
  }
  if (draft.baseUrl.trim().length === 0) {
    return 'baseUrl';
  }
  if (draft.model.trim().length === 0) {
    return 'model';
  }
  if (draft.dimension.trim().length > 0 && parseEmbeddingDimension(draft.dimension) === undefined) {
    return 'dimension';
  }
  if (
    draft.apiKeyEnv.trim().length > 0 &&
    !ENVIRONMENT_VARIABLE_PATTERN.test(draft.apiKeyEnv.trim())
  ) {
    return 'apiKeyEnv';
  }
  return null;
}

export function applyKnowledgeEmbedding(
  config: PiwinConfig,
  draft: KnowledgeEmbeddingDraft,
): PiwinConfig {
  const notes = { ...(config.notes ?? {}) };
  const knowledge = { ...(config.knowledge ?? {}) };
  const next: PiwinConfig = { ...config };

  if (!draft.enabled) {
    delete notes.embedding;
    if (Object.keys(notes).length === 0) {
      delete next.notes;
    } else {
      next.notes = notes;
    }
    const remembered = rememberDisabledEmbedding(draft, knowledge.embedding);
    if (remembered) {
      knowledge.embedding = remembered;
      next.knowledge = knowledge;
    } else if (knowledge.embedding) {
      knowledge.embedding = { ...knowledge.embedding, enabled: false };
      next.knowledge = knowledge;
    } else if (Object.keys(knowledge).length > 0) {
      next.knowledge = knowledge;
    } else {
      delete next.knowledge;
    }
    return next;
  }

  const notesEmbedding = toNotesEmbedding(draft);
  notes.embedding = notesEmbedding;
  next.notes = notes;
  knowledge.embedding = {
    enabled: true,
    provider: notesEmbedding.provider,
    baseUrl: notesEmbedding.baseUrl,
    model: notesEmbedding.model,
    ...(notesEmbedding.apiKeyEnv ? { apiKeyEnv: notesEmbedding.apiKeyEnv } : {}),
    ...(notesEmbedding.apiKeyRef ? { apiKeyRef: notesEmbedding.apiKeyRef } : {}),
    ...(typeof notesEmbedding.dimensions === 'number'
      ? { dimension: notesEmbedding.dimensions }
      : {}),
  };
  next.knowledge = knowledge;
  return next;
}

export function knowledgeEmbeddingDirty(
  left: KnowledgeEmbeddingDraft,
  right: KnowledgeEmbeddingDraft,
): boolean {
  return (
    left.enabled !== right.enabled ||
    left.provider !== right.provider ||
    left.baseUrl.trim() !== right.baseUrl.trim() ||
    left.model.trim() !== right.model.trim() ||
    left.apiKeyEnv.trim() !== right.apiKeyEnv.trim() ||
    left.apiKeyRef.trim() !== right.apiKeyRef.trim() ||
    left.dimension.trim() !== right.dimension.trim() ||
    (left.apiKeyInput?.trim() ?? '') !== (right.apiKeyInput?.trim() ?? '')
  );
}

function toNotesEmbedding(draft: KnowledgeEmbeddingDraft): NotesEmbeddingConfig {
  const embedding: NotesEmbeddingConfig = {
    provider: draft.provider,
    baseUrl: draft.baseUrl.trim(),
    model: draft.model.trim(),
  };
  if (draft.apiKeyEnv.trim()) {
    embedding.apiKeyEnv = draft.apiKeyEnv.trim();
  }
  if (draft.apiKeyRef.trim()) {
    embedding.apiKeyRef = draft.apiKeyRef.trim();
  }
  const dimension = parseEmbeddingDimension(draft.dimension);
  if (dimension !== undefined) {
    embedding.dimensions = dimension;
  }
  return embedding;
}

function knowledgeToNotes(
  knowledge: KnowledgeEmbeddingConfig | undefined,
): NotesEmbeddingConfig | undefined {
  if (
    !knowledge ||
    (knowledge.provider !== 'openai-compatible' && knowledge.provider !== 'ollama') ||
    typeof knowledge.baseUrl !== 'string' ||
    typeof knowledge.model !== 'string'
  ) {
    return undefined;
  }
  return {
    provider: knowledge.provider,
    baseUrl: knowledge.baseUrl,
    model: knowledge.model,
    ...(knowledge.apiKeyEnv ? { apiKeyEnv: knowledge.apiKeyEnv } : {}),
    ...(knowledge.apiKeyRef ? { apiKeyRef: knowledge.apiKeyRef } : {}),
    ...(typeof knowledge.dimension === 'number' ? { dimensions: knowledge.dimension } : {}),
  };
}

function rememberDisabledEmbedding(
  draft: KnowledgeEmbeddingDraft,
  previous: KnowledgeEmbeddingConfig | undefined,
): KnowledgeEmbeddingConfig | undefined {
  const remembered: KnowledgeEmbeddingConfig = {
    ...(previous ?? {}),
    enabled: false,
    provider: draft.provider,
  };
  if (draft.baseUrl.trim()) remembered.baseUrl = draft.baseUrl.trim();
  if (draft.model.trim()) remembered.model = draft.model.trim();
  if (draft.apiKeyEnv.trim()) remembered.apiKeyEnv = draft.apiKeyEnv.trim();
  else delete remembered.apiKeyEnv;
  if (draft.apiKeyRef.trim()) remembered.apiKeyRef = draft.apiKeyRef.trim();
  else delete remembered.apiKeyRef;
  const dimension = parseEmbeddingDimension(draft.dimension);
  if (dimension !== undefined) remembered.dimension = dimension;
  else delete remembered.dimension;
  return Object.keys(remembered).length > 1 ? remembered : { enabled: false };
}
