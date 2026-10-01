import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL_MAX_OUTPUT_TOKENS } from '@piwin/contracts';
import type { ModelProviderConfig } from '@piwin/contracts';
import { lookupCatalogByModelId } from './model-catalog-reader.js';
import { buildPiProviderRegistration, resolvePiApiForProvider } from './pi-model-runtime.js';
import type { NativeSearchStreamSimple } from './native-web-search.js';

describe('pi-model-runtime', () => {
  it('maps product protocols to Pi provider APIs', () => {
    expect(resolvePiApiForProvider('openai-compatible')).toBe('openai-completions');
    expect(resolvePiApiForProvider('anthropic-compatible')).toBe('anthropic-messages');
    expect(resolvePiApiForProvider('google-gemini')).toBe('google-generative-ai');
  });

  it('honours chatApi openai-responses only on OpenAI-compatible rows', () => {
    expect(resolvePiApiForProvider('openai-compatible', 'openai-responses')).toBe(
      'openai-responses',
    );
    expect(resolvePiApiForProvider(undefined, 'openai-responses')).toBe('openai-responses');
    expect(resolvePiApiForProvider('anthropic-compatible', 'openai-responses')).toBe(
      'anthropic-messages',
    );
    expect(resolvePiApiForProvider('openai-compatible', 'openai-completions')).toBe(
      'openai-completions',
    );
  });

  it('registers Responses providers on the Pi openai-responses API', () => {
    const registration = buildPiProviderRegistration(
      {
        id: 'ark-plan',
        name: 'Ark Agent Plan',
        protocol: 'openai-compatible',
        chatApi: 'openai-responses',
        baseUrl: 'https://ark.cn-beijing.volces.com/api/plan/v3',
        models: [{ id: 'doubao-seed-2.0-pro' }],
      },
      'secret',
    );
    expect(registration.api).toBe('openai-responses');
    expect(registration.models[0]).toMatchObject({
      api: 'openai-responses',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/plan/v3',
    });
    expect(registration.models[0]).not.toHaveProperty('compat');
    expect(registration.streamSimple).toBeTypeOf('function');
  });

  it('adds DeepSeek compat for OpenAI-channel models only', () => {
    const openAiProvider: ModelProviderConfig = {
      id: 'local-gateway',
      protocol: 'openai-compatible',
      name: 'Local gateway',
      baseUrl: 'http://127.0.0.1:8317/v1',
      models: [
        { id: 'deepseek-v4-flash' },
        { id: 'DeepSeek-v4-pro' },
        { id: 'gpt-5.6' },
      ],
    };

    const openAiRegistration = buildPiProviderRegistration(openAiProvider);
    expect(openAiRegistration.models[0]?.compat).toEqual({
      supportsStore: false,
      supportsDeveloperRole: false,
      maxTokensField: 'max_tokens',
      requiresReasoningContentOnAssistantMessages: true,
      thinkingFormat: 'deepseek',
    });
    expect(openAiRegistration.models[1]?.compat).toEqual(
      openAiRegistration.models[0]?.compat,
    );
    expect(openAiRegistration.models[2]).not.toHaveProperty('compat');

    const { chatApi: _chatApi1, ...baseProvider1 } = openAiProvider;
    const anthropicRegistration = buildPiProviderRegistration({
      ...baseProvider1,
      protocol: 'anthropic-compatible',
    });
    expect(anthropicRegistration.models[0]).not.toHaveProperty('compat');
  });

  it('adds Grok xAI wire compat for OpenAI-channel grok models only', () => {
    const openAiProvider: ModelProviderConfig = {
      id: 'local-gateway',
      protocol: 'openai-compatible',
      name: 'Local gateway',
      baseUrl: 'http://127.0.0.1:8317/v1',
      models: [{ id: 'grok-4.6' }, { id: 'x-ai/grok-4.6' }, { id: 'gpt-5.6' }],
    };

    const openAiRegistration = buildPiProviderRegistration(openAiProvider);
    const grokCompat = {
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: true,
    };
    expect(openAiRegistration.models[0]?.compat).toEqual(grokCompat);
    expect(openAiRegistration.models[1]?.compat).toEqual(grokCompat);
    expect(openAiRegistration.models[2]).not.toHaveProperty('compat');

    const { chatApi: _chatApi2, ...baseProvider2 } = openAiProvider;
    const anthropicRegistration = buildPiProviderRegistration({
      ...baseProvider2,
      protocol: 'anthropic-compatible',
    });
    expect(anthropicRegistration.models[0]).not.toHaveProperty('compat');
  });

  describe('system prompt role (ADR 0082)', () => {
    const qwen: ModelProviderConfig = {
      id: 'qwen',
      protocol: 'openai-compatible',
      name: 'Qwen',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      models: [{ id: 'qwen3.8-max' }, { id: 'qwen-plus', systemPromptRole: 'system' }],
    };

    it('leaves the Pi default alone unless the user opts into system', () => {
      const registration = buildPiProviderRegistration(qwen, 'k');
      expect(registration.models[0]).not.toHaveProperty('compat');
      expect(registration.models[1]?.compat).toEqual({ supportsDeveloperRole: false });
      const forced = buildPiProviderRegistration({ ...qwen, systemPromptRole: 'system' }, 'k');
      expect(forced.models[0]?.compat).toEqual({ supportsDeveloperRole: false });
    });

    it('applies to Responses and merges with model-id compat', () => {
      const responses = buildPiProviderRegistration(
        { ...qwen, chatApi: 'openai-responses', systemPromptRole: 'system' },
        'k',
      );
      expect(responses.models[0]).toMatchObject({
        api: 'openai-responses',
        compat: { supportsDeveloperRole: false },
      });
      const deepseek = buildPiProviderRegistration(
        { ...qwen, systemPromptRole: 'system', models: [{ id: 'deepseek-v4-flash' }] },
        'k',
      );
      expect(deepseek.models[0]?.compat).toMatchObject({
        supportsDeveloperRole: false,
        thinkingFormat: 'deepseek',
        maxTokensField: 'max_tokens',
      });
    });

    it('sends developer by default and system once opted in, on the real Pi wire', async () => {
      const bodies: unknown[] = [];
      const server = createServer((request, response) => {
        const chunks: Buffer[] = [];
        request.on('data', (chunk: Buffer) => chunks.push(chunk));
        request.on('end', () => {
          bodies.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          response.writeHead(400, { 'content-type': 'application/json' });
          response.end('{"error":{"message":"stop"}}');
        });
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const firstRole = async (
        port: number,
        systemPromptRole: 'system' | undefined,
      ): Promise<string | undefined> => {
        bodies.length = 0;
        const registration = buildPiProviderRegistration(
          {
            ...qwen,
            baseUrl: `http://127.0.0.1:${port}/v1`,
            ...(systemPromptRole ? { systemPromptRole } : {}),
            models: [{ id: 'qwen3.8-max' }],
          },
          'k',
        );
        const model = registration.models[0];
        const stream = registration.streamSimple;
        if (!model || !stream) throw new Error('registration incomplete');
        const events = stream(
          { ...model, provider: 'qwen' },
          {
            systemPrompt: 'be helpful',
            messages: [{ role: 'user', content: 'hi', timestamp: 1 }],
          },
          { apiKey: 'k' },
        ) as { result?: () => Promise<unknown> };
        if (typeof events.result !== 'function') throw new Error('Pi stream did not expose result()');
        // The 400 ends the turn; only the captured request body matters here.
        await events.result();
        const sent = bodies[0] as { messages?: Array<{ role: string }> } | undefined;
        return sent?.messages?.[0]?.role;
      };
      try {
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('no port');
        expect(await firstRole(address.port, undefined)).toBe('developer');
        expect(await firstRole(address.port, 'system')).toBe('system');
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });
  });

  it('fills omitted grok-4.6 window from the Pi catalog instead of 128K', () => {
    const catalog = lookupCatalogByModelId('grok-4.6');
    expect(catalog?.contextWindow).toBe(500_000);

    const registration = buildPiProviderRegistration({
      id: 'xai-local',
      protocol: 'openai-compatible',
      name: 'xAI local gateway',
      baseUrl: 'https://api.example.test/v1',
      models: [{ id: 'grok-4.6' }],
    });
    expect(registration.models[0]?.contextWindow).toBe(500_000);
    expect(registration.models[0]?.maxTokens).toBe(catalog?.maxTokens);
  });

  it('builds a Pi provider registration with complete model descriptors', () => {
    const provider: ModelProviderConfig = {
      id: 'xai-local',
      protocol: 'openai-compatible',
      name: 'xAI local gateway',
      baseUrl: 'https://api.example.test/v1',
      apiKeyEnv: 'XAI_API_KEY',
      headers: { 'x-client': 'piwin' },
      models: [
        {
          id: 'grok-4.5',
          label: 'Grok 4.5',
          contextWindow: 128_000,
          maxOutputTokens: 8_192,
          thinkingLevels: ['low', 'medium', 'high'],
        },
      ],
    };

    const registration = buildPiProviderRegistration(provider, 'secret-value');
    expect(registration).toMatchObject({
      name: 'xAI local gateway',
      baseUrl: 'https://api.example.test/v1',
      api: 'openai-completions',
      apiKey: 'secret-value',
      authHeader: true,
      headers: { 'x-client': 'piwin' },
    });
    expect(registration.models).toEqual([
      expect.objectContaining({
        id: 'grok-4.5',
        name: 'Grok 4.5',
        api: 'openai-completions',
        baseUrl: 'https://api.example.test/v1',
        reasoning: true,
        input: ['text'],
        contextWindow: 128_000,
        maxTokens: 8_192,
      }),
    ]);
    expect(registration.models[0]?.compat).toEqual({
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: true,
    });
    expect(registration.models[0]).not.toHaveProperty('thinkingLevels');
    expect(registration.models[0]?.thinkingLevelMap).toEqual({
      off: null,
      minimal: null,
      low: 'low',
      medium: 'medium',
      high: 'high',
      xhigh: null,
      max: null,
    });
  });

  it('defaults omitted maxOutputTokens to the shared product default', () => {
    const provider: ModelProviderConfig = {
      id: 'plain',
      protocol: 'openai-compatible',
      name: 'Plain',
      baseUrl: 'https://api.example.test/v1',
      models: [{ id: 'text-only-model' }],
    };
    const registration = buildPiProviderRegistration(provider);
    expect(registration.models[0]?.maxTokens).toBe(DEFAULT_MODEL_MAX_OUTPUT_TOKENS);
  });

  it('passes through model input and reasoning from config', () => {
    const provider: ModelProviderConfig = {
      id: 'vision-proxy',
      protocol: 'anthropic-compatible',
      name: 'Vision proxy',
      baseUrl: 'https://api.example.test',
      models: [
        {
          id: 'claude-vision',
          input: ['text', 'image'],
          reasoning: false,
        },
      ],
    };
    const registration = buildPiProviderRegistration(provider);
    expect(registration.models[0]).toMatchObject({
      id: 'claude-vision',
      input: ['text', 'image'],
      reasoning: false,
    });
  });

  it('registers configured xhigh and max levels in Pi thinkingLevelMap', () => {
    const provider: ModelProviderConfig = {
      id: 'reasoning-provider',
      protocol: 'openai-compatible',
      name: 'Reasoning provider',
      baseUrl: 'https://api.example.test/v1',
      models: [
        {
          id: 'reasoning-model',
          reasoning: true,
          thinkingLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
        },
      ],
    };

    const registration = buildPiProviderRegistration(provider);
    expect(registration.models[0]?.thinkingLevelMap).toEqual({
      off: null,
      minimal: null,
      low: 'low',
      medium: 'medium',
      high: 'high',
      xhigh: 'xhigh',
      max: 'max',
    });
  });

  it('defaults omitted input to text-only and reasoning to true', () => {
    const provider: ModelProviderConfig = {
      id: 'plain',
      protocol: 'openai-compatible',
      name: 'Plain',
      baseUrl: 'https://api.example.test/v1',
      models: [{ id: 'text-only-model' }],
    };
    const registration = buildPiProviderRegistration(provider);
    expect(registration.models[0]?.input).toEqual(['text']);
    expect(registration.models[0]?.reasoning).toBe(true);
  });

  it('does not register ASR-only models in Pi chat runtime', () => {
    const provider: ModelProviderConfig = {
      id: 'speech-provider',
      protocol: 'openai-compatible',
      name: 'Speech provider',
      baseUrl: 'https://api.example.test/v1',
      models: [{ id: 'whisper-1', capabilities: ['speech-to-text'] }, { id: 'chat-1' }],
    };
    const registration = buildPiProviderRegistration(provider);
    expect(registration.models.map((model) => model.id)).toEqual(['chat-1']);
  });

  describe('native search streamSimple', () => {
    function baseStreamSimple(initialPayload?: Record<string, unknown>): {
      stream: NativeSearchStreamSimple;
      payloads: unknown[];
    } {
      const payloads: unknown[] = [];
      const stream: NativeSearchStreamSimple = async (model, _context, options) => {
        const payload: Record<string, unknown> = initialPayload ?? {
          model: 'test-model',
          messages: [],
          tools: [{ type: 'function' }, { type: 'web_search_preview' }],
          web_search_options: { search_context_size: 'medium' },
        };
        const transformed = await options?.onPayload?.(payload, model);
        if (transformed !== undefined) {
          payloads.push(transformed);
          return transformed;
        }
        return payload;
      };
      return { stream, payloads };
    }

    it('never injects hosted search into main-session registrations (ADR 0043)', async () => {
      const base = baseStreamSimple({
        model: 'test-model',
        messages: [],
        tools: [{ type: 'function' }],
      });
      const provider: ModelProviderConfig = {
        id: 'xai-local',
        protocol: 'openai-compatible',
        name: 'xAI local',
        baseUrl: 'https://api.example.test/v1',
        apiKeyEnv: 'XAI_API_KEY',
        models: [
          {
            id: 'grok-4.5',
            capabilities: ['chat', 'native-web-search'],
            nativeSearchAdapter: 'openai-web-search-options',
          },
        ],
      };

      const registration = buildPiProviderRegistration(provider, 'secret', {
        streamSimple: base.stream,
      });

      const result = await registration.streamSimple?.(
        { id: 'grok-4.5', api: 'openai-completions', provider: 'xai-local' },
        {},
        {},
      );
      // Main sessions are not wrapped: the payload reaches Pi untouched.
      expect(result).toEqual({ model: 'test-model', messages: [], tools: [{ type: 'function' }] });
    });

    it('injects hosted search only for the explicit native executor', async () => {
      const base = baseStreamSimple({ model: 'test-model', messages: [] });
      const provider: ModelProviderConfig = {
        id: 'xai-local',
        protocol: 'openai-compatible',
        name: 'xAI local',
        baseUrl: 'https://api.example.test/v1',
        models: [
          { id: 'grok-4.5', capabilities: ['chat', 'native-web-search'], nativeSearchAdapter: 'openai-web-search-options' },
        ],
      };
      const registration = buildPiProviderRegistration(provider, 'secret', {
        streamSimple: base.stream,
        injectNativeSearch: true,
      });
      const result = await registration.streamSimple?.(
        { id: 'grok-4.5', api: 'openai-completions', provider: 'xai-local' },
        {},
        {},
      );
      expect(result).toHaveProperty('web_search_options');
    });

    it('installs a real Pi base stream when production does not inject a test stream', () => {
      const provider: ModelProviderConfig = {
        id: 'native-provider',
        protocol: 'openai-compatible',
        name: 'Native provider',
        baseUrl: 'https://api.example.test/v1',
        models: [{ id: 'search-model', capabilities: ['chat', 'native-web-search'] }],
      };

      const registration = buildPiProviderRegistration(provider, undefined, {
      });

      expect(registration.streamSimple).toBeTypeOf('function');
    });

    it('applies native search to an outbound request through the real Pi stream', async () => {
      let receivedPayload: Record<string, unknown> | undefined;
      const server = createServer(async (request, response) => {
        const chunks: Buffer[] = [];
        for await (const chunk of request) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        receivedPayload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<
          string,
          unknown
        >;
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        response.end(
          [
            `data: ${JSON.stringify({
              id: 'chatcmpl-native-search',
              object: 'chat.completion.chunk',
              created: 1,
              model: 'search-model',
              choices: [
                {
                  index: 0,
                  delta: { role: 'assistant', content: 'ok' },
                  finish_reason: null,
                },
              ],
            })}`,
            `data: ${JSON.stringify({
              id: 'chatcmpl-native-search',
              object: 'chat.completion.chunk',
              created: 1,
              model: 'search-model',
              choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
            })}`,
            'data: [DONE]',
            '',
          ].join('\n\n'),
        );
      });
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });

      try {
        const address = server.address();
        if (!address || typeof address === 'string') {
          throw new Error('test server did not expose a TCP address');
        }
        const provider: ModelProviderConfig = {
          id: 'native-provider',
          protocol: 'openai-compatible',
          name: 'Native provider',
          baseUrl: `http://127.0.0.1:${address.port}/v1`,
          models: [
            {
              id: 'search-model',
              capabilities: ['chat', 'native-web-search'],
              nativeSearchAdapter: 'openai-web-search-options',
            },
          ],
        };
        const registration = buildPiProviderRegistration(provider, 'test-key', {
          injectNativeSearch: true,
        });
        const model = registration.models[0];
        const streamSimple = registration.streamSimple;
        if (!model || !streamSimple) {
          throw new Error('native-search production stream was not registered');
        }

        const stream = streamSimple(
          { ...model, provider: provider.id },
          { messages: [{ role: 'user', content: 'search the web', timestamp: 1 }] },
          { apiKey: 'test-key' },
        ) as { result?: () => Promise<unknown> };
        if (typeof stream.result !== 'function') {
          throw new Error('Pi stream did not expose result()');
        }
        const result = await stream.result();

        expect(result).toMatchObject({ stopReason: 'stop' });
        expect(receivedPayload).toMatchObject({ web_search_options: {} });
      } finally {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        });
      }
    });

    it('isolates Gemini OpenAI-compat turns with a last-user prompt_cache_key', async () => {
      const payloads: unknown[] = [];
      const stream: NativeSearchStreamSimple = async (model, _context, options) => {
        const payload = {
          model: model.id,
          messages: [{ role: 'user', content: '你可以回滚' }],
        };
        const transformed = await options?.onPayload?.(payload, model);
        payloads.push(transformed ?? payload);
        return transformed ?? payload;
      };
      const provider: ModelProviderConfig = {
        id: 'custom-openai',
        protocol: 'openai-compatible',
        name: 'Local gateway',
        baseUrl: 'http://127.0.0.1:8317/v1',
        models: [{ id: 'gemini-3.8-flash-high', capabilities: ['chat'] }],
      };
      const registration = buildPiProviderRegistration(provider, 'secret', {
        streamSimple: stream,
      });
      expect(registration.streamSimple).toBeTypeOf('function');
      const result = (await registration.streamSimple?.(
        { id: 'gemini-3.8-flash-high', api: 'openai-completions', provider: 'custom-openai' },
        {},
        {},
      )) as Record<string, unknown>;
      expect(typeof result.prompt_cache_key).toBe('string');
      expect(result.prompt_cache_key).toHaveLength(16);
      expect(payloads[0]).toMatchObject({ prompt_cache_key: result.prompt_cache_key });
    });
  });

  it('routes each model of one gateway row to its own wire (ADR 0079)', async () => {
    const seen: Array<{ path: string; auth: string | undefined; googKey: string | undefined }> = [];
    const server = createServer((request, response) => {
      seen.push({
        path: request.url ?? '',
        auth: request.headers.authorization,
        googKey: request.headers['x-goog-api-key'] as string | undefined,
      });
      request.resume();
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end('{"error":{"message":"recorded"}}');
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('no TCP address');
      const provider: ModelProviderConfig = {
        id: 'cpa',
        protocol: 'openai-compatible',
        name: 'CPA',
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        models: [{ id: 'grok-4.7' }, { id: 'gemini-3.8-flash-high', protocol: 'google-gemini' }],
      };
      const registration = buildPiProviderRegistration(provider, 'gw-key');
      const byId = new Map(registration.models.map((model) => [model.id, model]));
      expect(byId.get('grok-4.7')).toMatchObject({
        api: 'openai-completions',
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
      });
      expect(byId.get('gemini-3.8-flash-high')).toMatchObject({
        api: 'google-generative-ai',
        baseUrl: `http://127.0.0.1:${address.port}/v1beta`,
      });

      const streamSimple = registration.streamSimple;
      if (!streamSimple) throw new Error('stream missing');
      for (const id of ['grok-4.7', 'gemini-3.8-flash-high']) {
        const model = byId.get(id);
        if (!model) throw new Error(`model ${id} missing`);
        const stream = streamSimple(
          { ...model, provider: provider.id },
          { messages: [{ role: 'user', content: 'hi', timestamp: 1 }] },
          { apiKey: 'gw-key' },
        ) as { result?: () => Promise<unknown> };
        await stream.result?.();
      }

      expect(seen.find((entry) => entry.path.startsWith('/v1/chat/completions'))).toMatchObject({
        auth: 'Bearer gw-key',
      });
      expect(
        seen.find((entry) =>
          entry.path.startsWith('/v1beta/models/gemini-3.8-flash-high:streamGenerateContent'),
        ),
      ).toMatchObject({ googKey: 'gw-key' });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
