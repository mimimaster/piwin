import { describe, expect, it, vi } from 'vitest';
import type { ModelProviderConfig } from '@piwin/contracts';
import {
  createModelCompletionPort,
  describeCodeSearchModelProviderIssue,
} from './model-backend.js';
import type { CodeSearchCompletionRequest } from '../completion-port.js';
import { buildCodeSearchToolSchemas } from '../tool-schema.js';

const CPA_PROVIDER: ModelProviderConfig = {
  id: 'custom-openai',
  protocol: 'openai-compatible',
  name: 'Cpa',
  baseUrl: 'http://127.0.0.1:8317/v1',
  models: [{ id: 'gpt-5-mini' }],
};

const XAI_PROVIDER: ModelProviderConfig = {
  id: 'xai',
  protocol: 'openai-compatible',
  name: 'Grok',
  baseUrl: 'oauth://xai',
  source: 'subscription',
  models: [{ id: 'grok-4.5' }],
};

function request(overrides: Partial<CodeSearchCompletionRequest> = {}): CodeSearchCompletionRequest {
  return {
    systemPrompt: 'SYSTEM',
    messages: [{ role: 'user', content: 'Problem Statement: find the handler' }],
    tools: buildCodeSearchToolSchemas(2),
    timeoutMs: 5_000,
    signal: new AbortController().signal,
    ...overrides,
  };
}

describe('describeCodeSearchModelProviderIssue', () => {
  it('allows every Models-page row that has a Base URL', () => {
    expect(describeCodeSearchModelProviderIssue(CPA_PROVIDER)).toBeUndefined();
    expect(describeCodeSearchModelProviderIssue(XAI_PROVIDER)).toBeUndefined();
    expect(
      describeCodeSearchModelProviderIssue({
        id: 'openai-codex',
        protocol: 'openai-compatible',
        name: 'Codex',
        baseUrl: 'oauth://openai-codex',
        source: 'subscription',
        models: [{ id: 'gpt-5.4' }],
      }),
    ).toBeUndefined();
  });

  it('rejects a provider with no Base URL', () => {
    expect(
      describeCodeSearchModelProviderIssue({
        id: 'broken',
        protocol: 'openai-compatible',
        name: 'Broken',
        baseUrl: '',
        models: [{ id: 'x' }],
      }),
    ).toMatch(/no Base URL/);
  });
});

describe('createModelCompletionPort', () => {
  it('sends CPA/custom channels through the shared Pi completion with the stored key', async () => {
    const complete = vi.fn(async (input: { apiKey?: string; provider: ModelProviderConfig }) => {
      expect(input.provider.baseUrl).toBe('http://127.0.0.1:8317/v1');
      expect(input.apiKey).toBe('sk-cpa');
      return {
        text: '',
        toolCalls: [{ id: 'c1', name: 'restricted_exec', arguments: { command1: { type: 'rg' } } }],
      };
    });
    const port = createModelCompletionPort(
      { provider: CPA_PROVIDER, modelId: 'gpt-5-mini' },
      { complete, resolveSecret: async () => 'sk-cpa' },
    );
    const result = await port(request());
    expect(result.toolCalls[0]?.name).toBe('restricted_exec');
    expect(complete).toHaveBeenCalledOnce();
  });

  it('sends subscription OAuth models without a channel API key', async () => {
    const complete = vi.fn(async (input: { apiKey?: string; provider: ModelProviderConfig }) => {
      expect(input.provider.id).toBe('xai');
      expect(input.apiKey).toBeUndefined();
      return { text: 'ok', toolCalls: [] };
    });
    const port = createModelCompletionPort(
      { provider: XAI_PROVIDER, modelId: 'grok-4.5' },
      { complete },
    );
    const result = await port(request());
    expect(result.text).toBe('ok');
  });
});
