import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL_MAX_OUTPUT_TOKENS } from '@piwin/contracts';
import type { ModelProviderConfig, ResolvedSearchRoute } from '@piwin/contracts';
import { buildPiProviderRegistration, resolvePiApiForProvider } from './pi-model-runtime.js';
import type { NativeSearchStreamSimple } from './native-web-search.js';

describe('pi-model-runtime', () => {
  it('maps product protocols to Pi provider APIs', () => {
    expect(resolvePiApiForProvider('openai-compatible')).toBe('openai-completions');
    expect(resolvePiApiForProvider('anthropic-compatible')).toBe('anthropic-messages');
    expect(resolvePiApiForProvider('google-gemini')).toBe('google-generative-ai');
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

    const anthropicRegistration = buildPiProviderRegistration({
      ...openAiProvider,
      protocol: 'anthropic-compatible',
    });
    expect(anthropicRegistration.models[0]).not.toHaveProperty('compat');
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
    function route(selected: 'native' | 'external' | null): ResolvedSearchRoute {
      return {
        policy: selected === 'native' ? 'native-first' : 'external-only',
        selected,
        fallback: null,
        readiness: {
          native: { ready: true, reasons: [] },
          external: { ready: true, reasons: [] },
        },
        issues: [],
      };
    }

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

    it('injects native search fields when the route is native', async () => {
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
          },
        ],
      };

      const registration = buildPiProviderRegistration(provider, 'secret', {
        searchRoute: route('native'),
        streamSimple: base.stream,
      });

      const result = await registration.streamSimple?.(
        { id: 'grok-4.5', api: 'openai-completions', provider: 'xai-local' },
        {},
        {},
      );
      expect(result).toBeDefined();
      const record = result as Record<string, unknown>;
      expect(record).toHaveProperty('web_search_options');
      const tools = Array.isArray(record.tools) ? record.tools : [];
      expect(tools).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ type: 'web_search_preview' })]),
      );
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
        searchRoute: route('native'),
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
          models: [{ id: 'search-model', capabilities: ['chat', 'native-web-search'] }],
        };
        const registration = buildPiProviderRegistration(provider, 'test-key', {
          searchRoute: route('native'),
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

    it('strips native search fields when the route is external', async () => {
      const base = baseStreamSimple();
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
          },
        ],
      };

      const registration = buildPiProviderRegistration(provider, 'secret', {
        searchRoute: route('external'),
        streamSimple: base.stream,
      });

      const result = await registration.streamSimple?.(
        { id: 'grok-4.5', api: 'openai-completions', provider: 'xai-local' },
        {},
        {},
      );
      expect(result).toBeDefined();
      const record = result as Record<string, unknown>;
      expect(record).not.toHaveProperty('web_search_options');
      const tools = Array.isArray(record.tools) ? record.tools : [];
      expect(tools).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ type: 'web_search_preview' })]),
      );
    });
  });
});
