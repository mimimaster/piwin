import { describe, expect, it } from 'vitest';
import type { KnowledgeConfig } from './knowledge.js';

describe('KnowledgeConfig', () => {
  it('accepts an empty object (unwired default)', () => {
    const config: KnowledgeConfig = {};
    expect(config.embedding).toBeUndefined();
  });

  it('keeps secrets as refs, not inline keys', () => {
    const config: KnowledgeConfig = {
      embedding: {
        enabled: true,
        provider: 'openai-compatible',
        apiKeyRef: 'keychain:piwin-knowledge-embed',
        apiKeyEnv: 'EMBEDDING_API_KEY',
      },
      parser: {
        mineru: { enabled: false, mode: 'http' },
      },
    };
    expect(config.embedding?.apiKeyRef).toMatch(/^keychain:/);
    expect(JSON.stringify(config)).not.toMatch(/sk-/);
  });
});
