import { describe, expect, it } from 'vitest';
import type { PiwinConfig } from '@piwin/contracts';
import {
  applyKnowledgeExtras,
  knowledgeChatModelOptions,
  knowledgeExtrasFromConfig,
  validateKnowledgeExtrasDraft,
} from './knowledge-extras-draft';

function baseConfig(): PiwinConfig {
  return {
    hostMode: 'sdk',
    defaultProviderId: 'primary',
    defaultModelId: 'chat',
    providers: [
      {
        id: 'primary',
        protocol: 'openai-compatible',
        name: 'Primary',
        baseUrl: 'https://example.test/v1',
        models: [{ id: 'chat', label: 'Chat', capabilities: ['chat'] }],
      },
    ],
    media: { maxPasteBytes: 1024, allowedMimeTypes: [] },
    artifact: {
      enabled: true,
      triggerMode: 'automatic',
      decisionPrompt: { mode: 'default', customPrompt: '' },
      maxBytes: 1024,
    },
  };
}

describe('knowledge extras draft', () => {
  it('defaults generation models to the configured chat default', () => {
    const draft = knowledgeExtrasFromConfig(baseConfig());
    expect(draft.extractionModelKey).toBe('primary/chat');
    expect(draft.flashcardModelKey).toBe('primary/chat');
    expect(knowledgeChatModelOptions(baseConfig()).map((option) => option.key)).toEqual([
      'primary/chat',
    ]);
  });

  it('persists parser, reranker, and LLM refs', () => {
    const next = applyKnowledgeExtras(baseConfig(), {
      mineruEnabled: true,
      unstructuredEnabled: false,
      rerankerEnabled: true,
      rerankerBaseUrl: 'https://router.example/v1',
      rerankerModel: 'rerank-english-v3.0',
      rerankerApiKeyEnv: 'RERANKER_API_KEY',
      rerankerApiKeyRef: 'keychain:knowledge-reranker',
      extractionModelKey: 'primary/chat',
      flashcardModelKey: 'primary/chat',
    });
    expect(next.knowledge?.parser?.mineru?.enabled).toBe(true);
    expect(next.knowledge?.reranker).toMatchObject({
      enabled: true,
      baseUrl: 'https://router.example/v1',
      model: 'rerank-english-v3.0',
    });
    expect(next.knowledge?.extractionLlm?.modelRef).toBe('primary/chat');
  });

  it('requires reranker url and model only when enabled', () => {
    expect(
      validateKnowledgeExtrasDraft({
        mineruEnabled: false,
        unstructuredEnabled: false,
        rerankerEnabled: false,
        rerankerBaseUrl: '',
        rerankerModel: '',
        rerankerApiKeyEnv: '',
        rerankerApiKeyRef: '',
        extractionModelKey: '',
        flashcardModelKey: '',
      }),
    ).toBeNull();
    expect(
      validateKnowledgeExtrasDraft({
        mineruEnabled: false,
        unstructuredEnabled: false,
        rerankerEnabled: true,
        rerankerBaseUrl: '',
        rerankerModel: 'rerank',
        rerankerApiKeyEnv: '',
        rerankerApiKeyRef: '',
        extractionModelKey: '',
        flashcardModelKey: '',
      }),
    ).toBe('rerankerBaseUrl');
  });
});
