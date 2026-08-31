import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelTextCompletionInput } from '@piwin/contracts';
import { completeModelText, ModelTextCompletionError } from './model-text-completion.js';

const runtime = vi.hoisted(() => ({ create: vi.fn(), getModel: vi.fn(), registerProvider: vi.fn(), completeSimple: vi.fn() }));
vi.mock('@earendil-works/pi-coding-agent', () => ({ ModelRuntime: { create: runtime.create } }));
const request: ModelTextCompletionInput = {
  model: { providerId: 'xai', modelId: 'grok-4.6', source: 'subscription' },
  systemPrompt: 'classify only', userPrompt: '{"instruction":"不用确认啦"}', maxOutputTokens: 512,
  signal: new AbortController().signal,
};
beforeEach(() => {
  vi.resetAllMocks();
  runtime.create.mockResolvedValue(runtime);
  runtime.getModel.mockReturnValue({ id: 'grok-4.6', maxTokens: 1000 });
  runtime.completeSimple.mockResolvedValue({ stopReason: 'stop', content: [{ type: 'text', text: '{"kind":"conversation"}' }] });
});

describe('Pi tool-free model completion', () => {
  it('uses native auth without creating a Session, messages store or tools', async () => {
    expect(await completeModelText(request, { agentDir: '/test/pi-agent' })).toBe('{"kind":"conversation"}');
    expect(runtime.create).toHaveBeenCalledWith(expect.objectContaining({ authPath: '/test/pi-agent/auth.json', modelsPath: null, allowModelNetwork: false, refreshOnCreate: false }));
    expect(runtime.registerProvider).not.toHaveBeenCalled();
    const context = runtime.completeSimple.mock.calls[0]?.[1];
    expect(context).not.toHaveProperty('tools');
    expect(context.messages).toHaveLength(1);
    expect(runtime.completeSimple.mock.calls[0]?.[2]).toMatchObject({ maxTokens: 512, signal: request.signal });
  });

  it('registers configured no-auth channels separately from subscription credentials', async () => {
    const provider = { id: 'local', name: 'Local', protocol: 'openai-compatible' as const, baseUrl: 'http://localhost/v1', models: [{ id: 'model', reasoning: false }] };
    await completeModelText({ ...request, model: { providerId: 'local', modelId: 'model', source: 'channel' } }, { provider });
    expect(runtime.registerProvider).toHaveBeenCalledWith('local', expect.objectContaining({ authHeader: false, baseUrl: provider.baseUrl }));
    expect(runtime.registerProvider.mock.calls[0]?.[1]).not.toHaveProperty('streamSimple');
  });

  it.each([
    { stopReason: 'length', content: [{ type: 'text', text: 'partial' }] },
    { stopReason: 'stop', content: [{ type: 'toolCall', name: 'shell' }] },
    { stopReason: 'stop', content: [] },
    { stopReason: 'error', content: [{ type: 'text', text: 'secret error' }] },
  ])('rejects incomplete, tool or error outputs', async (result) => {
    runtime.completeSimple.mockResolvedValue(result);
    await expect(completeModelText(request)).rejects.toBeInstanceOf(ModelTextCompletionError);
  });

  it('does not expose provider errors and respects caller abort', async () => {
    runtime.completeSimple.mockRejectedValue(new Error('sensitive credentials'));
    await expect(completeModelText(request)).rejects.toThrow('Model text completion failed');
    await expect(completeModelText({ ...request, signal: AbortSignal.abort() })).rejects.toBeDefined();
    expect(runtime.create).toHaveBeenCalledTimes(1);
  });
});
