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
  it('defaults generation models to empty string when unspecified and lists options', () => {
    const draft = knowledgeExtrasFromConfig(baseConfig());
    expect(draft.extractionModelKey).toBe('');
    expect(draft.flashcardModelKey).toBe('');
    expect(knowledgeChatModelOptions(baseConfig()).map((option) => option.key)).toEqual([
      'primary/chat',
    ]);
  });

  it('persists parser, reranker, and LLM refs', () => {
    const next = applyKnowledgeExtras(baseConfig(), {
      mineruEnabled: true,
      mineruBaseUrl: 'http://127.0.0.1:8000',
      mineruApiKeyEnv: 'MINERU_API_KEY',
      mineruApiKeyRef: 'keychain:knowledge-mineru',
      unstructuredEnabled: false,
      unstructuredBaseUrl: '',
      unstructuredApiKeyEnv: '',
      unstructuredApiKeyRef: '',
      rerankerEnabled: true,
      rerankerBaseUrl: 'https://router.example/v1',
      rerankerModel: 'rerank-english-v3.0',
      rerankerApiKeyEnv: 'RERANKER_API_KEY',
      rerankerApiKeyRef: 'keychain:knowledge-reranker',
      extractionModelKey: 'primary/chat',
      flashcardModelKey: 'primary/chat',
    });
    expect(next.knowledge?.parser?.mineru).toMatchObject({
      enabled: true,
      mode: 'http',
      baseUrl: 'http://127.0.0.1:8000',
      apiKeyRef: 'keychain:knowledge-mineru',
    });
    expect(next.knowledge?.reranker).toMatchObject({
      enabled: true,
      baseUrl: 'https://router.example/v1',
      model: 'rerank-english-v3.0',
    });
    expect(next.knowledge?.extractionLlm?.modelRef).toBe('primary/chat');
    expect(next.notes?.knowledgeExtras?.reranker).toMatchObject({
      enabled: true,
      model: 'rerank-english-v3.0',
    });
    expect(next.notes?.knowledgeExtras?.extractionLlm?.modelRef).toBe('primary/chat');
  });

  it('reads mineru endpoint extras from knowledge.parser', () => {
    const draft = knowledgeExtrasFromConfig({
      ...baseConfig(),
      knowledge: {
        parser: {
          mineru: {
            enabled: true,
            mode: 'http',
            baseUrl: 'http://127.0.0.1:8900',
            apiKeyRef: 'keychain:knowledge-mineru',
          },
        },
      },
    });
    expect(draft.mineruEnabled).toBe(true);
    expect(draft.mineruBaseUrl).toBe('http://127.0.0.1:8900');
    expect(draft.mineruApiKeyRef).toBe('keychain:knowledge-mineru');
  });

  it('reads reranker extras mirrored on notes when knowledge is absent', () => {
    const draft = knowledgeExtrasFromConfig({
      ...baseConfig(),
      notes: {
        knowledgeExtras: {
          reranker: {
            enabled: true,
            provider: 'openai-compatible',
            baseUrl: 'https://api.example.com/v1',
            model: 'Qwen/Qwen3-Reranker-8B',
          },
        },
      },
    });
    expect(draft.rerankerEnabled).toBe(true);
    expect(draft.rerankerModel).toBe('Qwen/Qwen3-Reranker-8B');
  });

  it('requires reranker url and model only when enabled', () => {
    expect(
      validateKnowledgeExtrasDraft({
        mineruEnabled: false,
        mineruBaseUrl: '',
        mineruApiKeyEnv: '',
        mineruApiKeyRef: '',
        unstructuredEnabled: false,
        unstructuredBaseUrl: '',
        unstructuredApiKeyEnv: '',
        unstructuredApiKeyRef: '',
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
        mineruEnabled: true,
        mineruBaseUrl: '',
        mineruApiKeyEnv: '',
        mineruApiKeyRef: '',
        unstructuredEnabled: false,
        unstructuredBaseUrl: '',
        unstructuredApiKeyEnv: '',
        unstructuredApiKeyRef: '',
        rerankerEnabled: false,
        rerankerBaseUrl: '',
        rerankerModel: '',
        rerankerApiKeyEnv: '',
        rerankerApiKeyRef: '',
        extractionModelKey: '',
        flashcardModelKey: '',
      }),
    ).toBe('mineruBaseUrl');
    expect(
      validateKnowledgeExtrasDraft({
        mineruEnabled: false,
        mineruBaseUrl: '',
        mineruApiKeyEnv: '',
        mineruApiKeyRef: '',
        unstructuredEnabled: false,
        unstructuredBaseUrl: '',
        unstructuredApiKeyEnv: '',
        unstructuredApiKeyRef: '',
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
