import { describe, expect, it } from 'vitest';
import {
  normalizeKnowledgeConfig,
  normalizeNotesKnowledgeExtras,
} from './config-store-knowledge.js';

describe('normalizeNotesKnowledgeExtras', () => {
  it('keeps reranker, parsers, and llm refs', () => {
    expect(
      normalizeNotesKnowledgeExtras({
        reranker: {
          enabled: true,
          provider: 'openai-compatible',
          baseUrl: 'https://api.example.com/v1',
          model: 'Qwen/Qwen3-Reranker-8B',
        },
        parser: { mineru: { enabled: true } },
        extractionLlm: { modelRef: 'primary/chat' },
        embedding: { enabled: true, model: 'should-not-copy' },
      }),
    ).toEqual({
      reranker: {
        enabled: true,
        provider: 'openai-compatible',
        baseUrl: 'https://api.example.com/v1',
        model: 'Qwen/Qwen3-Reranker-8B',
      },
      parser: { mineru: { enabled: true } },
      extractionLlm: { modelRef: 'primary/chat' },
    });
  });
});

describe('normalizeKnowledgeConfig', () => {
  it('lifts notes.knowledgeExtras when the knowledge domain is empty', () => {
    const knowledge = normalizeKnowledgeConfig(undefined, {
      knowledgeExtras: {
        reranker: {
          enabled: true,
          provider: 'openai-compatible',
          baseUrl: 'https://api.example.com/v1',
          model: 'Qwen/Qwen3-Reranker-8B',
        },
      },
    });
    expect(knowledge?.reranker).toMatchObject({
      enabled: true,
      model: 'Qwen/Qwen3-Reranker-8B',
    });
  });
});
