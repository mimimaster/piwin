import { beforeEach, describe, expect, it, vi } from 'vitest';
import { completeModelTools, isHttpBaseUrl, ModelToolsCompletionError } from './model-tools-completion.js';

const runtime = vi.hoisted(() => ({
  create: vi.fn(),
  getModel: vi.fn(),
  registerProvider: vi.fn(),
  completeSimple: vi.fn(),
}));
vi.mock('@earendil-works/pi-coding-agent', () => ({ ModelRuntime: { create: runtime.create } }));

const tools = [
  { name: 'restricted_exec', description: 'exec', parameters: { type: 'object', properties: {} } },
];

beforeEach(() => {
  vi.resetAllMocks();
  runtime.create.mockResolvedValue(runtime);
  runtime.getModel.mockReturnValue({
    id: 'grok-4.5',
    maxTokens: 8192,
    api: 'openai-completions',
    provider: 'xai',
  });
  runtime.completeSimple.mockResolvedValue({
    stopReason: 'toolUse',
    content: [
      {
        type: 'toolCall',
        id: 'c1',
        name: 'restricted_exec',
        arguments: { command1: { type: 'rg', pattern: 'x' } },
      },
    ],
  });
});

describe('completeModelTools', () => {
  it('uses native auth for subscription models without registering a channel', async () => {
    const result = await completeModelTools({
      model: { providerId: 'xai', modelId: 'grok-4.5' },
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'find handler' }],
      tools,
      signal: new AbortController().signal,
      maxOutputTokens: 4096,
    }, { agentDir: '/test/pi-agent' });
    expect(result.toolCalls[0]?.name).toBe('restricted_exec');
    expect(runtime.registerProvider).not.toHaveBeenCalled();
    expect(runtime.create).toHaveBeenCalledWith(
      expect.objectContaining({ authPath: '/test/pi-agent/auth.json' }),
    );
  });

  it('registers CPA/custom HTTP channels from config', async () => {
    runtime.getModel.mockReturnValue({
      id: 'gpt-5-mini',
      maxTokens: 8192,
      api: 'openai-completions',
      provider: 'custom-openai',
    });
    runtime.completeSimple.mockResolvedValue({
      stopReason: 'stop',
      content: [{ type: 'text', text: 'done' }],
    });
    const provider = {
      id: 'custom-openai',
      name: 'Cpa',
      protocol: 'openai-compatible' as const,
      baseUrl: 'http://127.0.0.1:8317/v1',
      models: [{ id: 'gpt-5-mini' }],
    };
    const result = await completeModelTools(
      {
        model: { providerId: 'custom-openai', modelId: 'gpt-5-mini' },
        systemPrompt: 'sys',
        messages: [{ role: 'user', content: 'q' }],
        tools,
        signal: new AbortController().signal,
        maxOutputTokens: 4096,
      },
      { provider, apiKey: 'sk-cpa' },
    );
    expect(result.text).toBe('done');
    expect(runtime.registerProvider).toHaveBeenCalledWith(
      'custom-openai',
      expect.objectContaining({ baseUrl: provider.baseUrl, apiKey: 'sk-cpa' }),
    );
  });
});

describe('isHttpBaseUrl', () => {
  it('accepts CPA and rejects oauth origins', () => {
    expect(isHttpBaseUrl('http://127.0.0.1:8317/v1')).toBe(true);
    expect(isHttpBaseUrl('https://xgrok.planora.chat/v1')).toBe(true);
    expect(isHttpBaseUrl('oauth://xai')).toBe(false);
  });
});

describe('ModelToolsCompletionError', () => {
  it('wraps missing models', async () => {
    runtime.getModel.mockReturnValue(undefined);
    await expect(
      completeModelTools({
        model: { providerId: 'xai', modelId: 'missing' },
        systemPrompt: 's',
        messages: [{ role: 'user', content: 'q' }],
        tools,
        signal: new AbortController().signal,
        maxOutputTokens: 16,
      }),
    ).rejects.toBeInstanceOf(ModelToolsCompletionError);
  });
});
