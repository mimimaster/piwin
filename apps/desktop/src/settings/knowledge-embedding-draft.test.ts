import { describe, expect, it } from 'vitest';
import type { PiwinConfig } from '@piwin/contracts';
import {
  applyKnowledgeEmbedding,
  emptyKnowledgeEmbeddingDraft,
  knowledgeEmbeddingDirty,
  knowledgeEmbeddingFromConfig,
  validateKnowledgeEmbeddingDraft,
  type KnowledgeEmbeddingDraft,
} from './knowledge-embedding-draft';

function baseConfig(): PiwinConfig {
  return {
    hostMode: 'sdk',
    providers: [],
    media: { maxPasteBytes: 1024, allowedMimeTypes: [] },
    artifact: {
      enabled: true,
      triggerMode: 'automatic',
      decisionPrompt: { mode: 'default', customPrompt: '' },
      maxBytes: 1024,
    },
  };
}

function enabledDraft(): KnowledgeEmbeddingDraft {
  return {
    enabled: true,
    provider: 'openai-compatible',
    baseUrl: 'https://api.example/v1',
    model: 'text-embedding-3-small',
    apiKeyEnv: 'EMBEDDING_API_KEY',
    apiKeyRef: 'keychain:notes-embedding',
    dimension: '1536',
  };
}

describe('knowledgeEmbeddingFromConfig', () => {
  it('treats notes.embedding as enabled even when knowledge is absent', () => {
    const draft = knowledgeEmbeddingFromConfig({
      ...baseConfig(),
      notes: {
        embedding: {
          provider: 'ollama',
          baseUrl: 'http://127.0.0.1:11434/v1',
          model: 'nomic-embed-text',
        },
      },
    });
    expect(draft.enabled).toBe(true);
    expect(draft.provider).toBe('ollama');
    expect(draft.model).toBe('nomic-embed-text');
  });

  it('reports disabled when knowledge.embedding.enabled is false and notes has no embedding', () => {
    const draft = knowledgeEmbeddingFromConfig({
      ...baseConfig(),
      knowledge: { embedding: { enabled: false, model: 'left-over' } },
    });
    expect(draft.enabled).toBe(false);
    expect(draft.model).toBe('left-over');
  });
});

describe('applyKnowledgeEmbedding', () => {
  it('writes notes.embedding and knowledge.embedding together', () => {
    const next = applyKnowledgeEmbedding(baseConfig(), enabledDraft());
    expect(next.notes?.embedding).toEqual({
      provider: 'openai-compatible',
      baseUrl: 'https://api.example/v1',
      model: 'text-embedding-3-small',
      apiKeyEnv: 'EMBEDDING_API_KEY',
      apiKeyRef: 'keychain:notes-embedding',
      dimensions: 1536,
    });
    expect(next.knowledge?.embedding).toMatchObject({
      enabled: true,
      provider: 'openai-compatible',
      model: 'text-embedding-3-small',
      dimension: 1536,
    });
  });

  it('clears notes.embedding when disabled and remembers the last endpoint', () => {
    const enabled = applyKnowledgeEmbedding(baseConfig(), enabledDraft());
    const disabled = applyKnowledgeEmbedding(enabled, {
      ...enabledDraft(),
      enabled: false,
    });
    expect(disabled.notes?.embedding).toBeUndefined();
    expect(disabled.knowledge?.embedding?.enabled).toBe(false);
    expect(disabled.knowledge?.embedding?.model).toBe('text-embedding-3-small');
  });
});

describe('validateKnowledgeEmbeddingDraft', () => {
  it('requires url and model only when enabled', () => {
    expect(validateKnowledgeEmbeddingDraft(emptyKnowledgeEmbeddingDraft())).toBeNull();
    expect(validateKnowledgeEmbeddingDraft({ ...enabledDraft(), baseUrl: '' })).toBe('baseUrl');
    expect(validateKnowledgeEmbeddingDraft({ ...enabledDraft(), dimension: 'nope' })).toBe(
      'dimension',
    );
    expect(validateKnowledgeEmbeddingDraft(enabledDraft())).toBeNull();
  });
});

describe('knowledgeEmbeddingDirty', () => {
  it('ignores surrounding whitespace', () => {
    const left = enabledDraft();
    const right = { ...enabledDraft(), baseUrl: ' https://api.example/v1 ' };
    expect(knowledgeEmbeddingDirty(left, right)).toBe(false);
    expect(knowledgeEmbeddingDirty(left, { ...right, model: 'other' })).toBe(true);
  });
});
