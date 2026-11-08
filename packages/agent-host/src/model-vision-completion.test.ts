import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelProviderConfig } from '@piwin/contracts';
import { completeModelVision } from './model-vision-completion.js';

const runtime = vi.hoisted(() => ({
  create: vi.fn(),
  getModel: vi.fn(),
  registerProvider: vi.fn(),
  listCredentials: vi.fn(),
  completeSimple: vi.fn(),
}));
const registerClaude = vi.hoisted(() => vi.fn());
vi.mock('@earendil-works/pi-coding-agent', () => ({
  ModelRuntime: { create: runtime.create },
  DefaultResourceLoader: class {},
}));
vi.mock('./anthropic-oauth/register-claude-code-provider.js', () => ({
  registerClaudeCodeOauthProvider: registerClaude,
}));

const provider: ModelProviderConfig = {
  id: 'xai',
  name: 'Grok',
  source: 'subscription',
  protocol: 'openai-compatible',
  baseUrl: 'oauth://xai',
  models: [{ id: 'grok-4.6', input: ['text', 'image'] }],
};
const request = {
  model: { providerId: 'xai', modelId: 'grok-4.6' },
  systemPrompt: 'Describe accurately',
  imageBase64: 'aW1hZ2U=',
  mimeType: 'image/png',
  signal: new AbortController().signal,
};

beforeEach(() => {
  vi.resetAllMocks();
  runtime.create.mockResolvedValue(runtime);
  runtime.getModel.mockReturnValue({ id: 'grok-4.6', maxTokens: 2048 });
  runtime.listCredentials.mockResolvedValue([
    { providerId: 'xai', type: 'oauth' },
    { providerId: 'anthropic-claude-code', type: 'api_key' },
  ]);
  runtime.completeSimple.mockResolvedValue({
    stopReason: 'stop',
    content: [{ type: 'text', text: ' A screenshot ' }],
  });
});

describe('Pi subscription vision completion', () => {
  it('uses the Host auth and catalog with a native image and no tools', async () => {
    const headers = { 'X-XAI-Token-Auth': 'xai-grok-cli' };
    await expect(
      completeModelVision(request, { provider, agentDir: '/test/pi-agent', headers }),
    ).resolves.toBe('A screenshot');
    expect(runtime.create).toHaveBeenCalledWith(
      expect.objectContaining({
        authPath: '/test/pi-agent/auth.json',
        modelsPath: '/test/pi-agent/models.json',
        allowModelNetwork: false,
        signal: request.signal,
      }),
    );
    expect(runtime.registerProvider).not.toHaveBeenCalled();
    expect(runtime.completeSimple).toHaveBeenCalledWith(
      expect.anything(),
      {
        systemPrompt: 'Describe accurately',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Describe this image.' },
              { type: 'image', data: 'aW1hZ2U=', mimeType: 'image/png' },
            ],
            timestamp: expect.any(Number),
          },
        ],
      },
      expect.objectContaining({ signal: request.signal, maxTokens: 1024, headers }),
    );
  });

  it('registers the Claude Code OAuth transport using configured models', async () => {
    const claude = {
      ...provider,
      id: 'anthropic-claude-code',
      baseUrl: 'https://api.anthropic.com',
    };
    await completeModelVision(
      { ...request, model: { providerId: claude.id, modelId: 'grok-4.6' } },
      { provider: claude, agentDir: '/test/pi-agent' },
    );
    expect(registerClaude).toHaveBeenCalledWith(
      runtime,
      '/test/pi-agent',
      expect.objectContaining({
        providerId: claude.id,
        models: [{ id: 'grok-4.6', input: ['text', 'image'] }],
        auth: { kind: 'oauth', providerId: claude.id },
      }),
    );
  });

  it('reports unavailable models and hides provider errors', async () => {
    runtime.getModel.mockReturnValueOnce(undefined);
    await expect(completeModelVision(request, { provider })).rejects.toThrow(
      'Vision model xai/grok-4.6 is unavailable',
    );
    runtime.completeSimple.mockRejectedValueOnce(new Error('private token'));
    await expect(completeModelVision(request, { provider })).rejects.toThrow(
      'Vision model request failed',
    );
  });

  it.each([
    { stopReason: 'error', content: [{ type: 'text', text: 'partial' }] },
    { stopReason: 'length', content: [{ type: 'text', text: 'partial' }] },
    { stopReason: 'stop', content: [] },
    { stopReason: 'stop', content: [{ type: 'toolCall' }] },
  ])('rejects unsuccessful or incomplete descriptions', async (result) => {
    runtime.completeSimple.mockResolvedValueOnce(result);
    await expect(completeModelVision(request, { provider })).rejects.toThrow(
      'Vision model request failed',
    );
  });

  it('honors cancellation before initializing Pi', async () => {
    await expect(
      completeModelVision({ ...request, signal: AbortSignal.abort() }, { provider }),
    ).rejects.toBeDefined();
    expect(runtime.create).not.toHaveBeenCalled();
  });

  it('rejects Devin while its adapter cannot send image content', async () => {
    const devin = { ...provider, id: 'devin', baseUrl: 'oauth://devin' };
    await expect(
      completeModelVision(
        { ...request, model: { providerId: 'devin', modelId: 'vision' } },
        { provider: devin },
      ),
    ).rejects.toThrow('transport does not support images');
    expect(runtime.completeSimple).not.toHaveBeenCalled();
  });

  it('refuses an API-key fallback when the subscription is logged out', async () => {
    runtime.listCredentials.mockResolvedValueOnce([{ providerId: 'xai', type: 'api_key' }]);
    await expect(completeModelVision(request, { provider })).rejects.toThrow(
      'OAuth account xai is not logged in',
    );
    expect(runtime.completeSimple).not.toHaveBeenCalled();
  });
});
