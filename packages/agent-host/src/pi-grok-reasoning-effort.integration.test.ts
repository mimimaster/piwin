import { createServer, type IncomingMessage, type Server } from 'node:http';
import { describe, expect, it } from 'vitest';
import type { ModelConfigEntry, ModelProviderConfig, ThinkingLevel } from '@piwin/contracts';
import { buildPiProviderRegistration } from './pi-model-runtime.js';
import { resolvePiNativeSearchStream } from './pi-native-search-stream.js';

const OPENAI_THINKING_LEVELS = ['low', 'medium', 'high', 'xhigh'] as const;

describe('Grok OpenAI-compat reasoning_effort (local SSE)', () => {
  it('sends the UI thinking level as reasoning_effort for grok-4.6', async () => {
    const payload = await captureChatCompletionPayload({
      modelId: 'grok-4.6',
      thinkingLevels: OPENAI_THINKING_LEVELS,
      reasoning: 'xhigh',
    });

    expect(payload.reasoning_effort).toBe('xhigh');
    expect(payload).not.toHaveProperty('store');
    expect(payload.reasoning).toBeUndefined();
  });

  it('sends mapped high/medium effort values for grok OpenAI-compat', async () => {
    const highPayload = await captureChatCompletionPayload({
      modelId: 'x-ai/grok-4.6',
      thinkingLevels: OPENAI_THINKING_LEVELS,
      reasoning: 'high',
    });
    const mediumPayload = await captureChatCompletionPayload({
      modelId: 'grok-4.6',
      thinkingLevels: OPENAI_THINKING_LEVELS,
      reasoning: 'medium',
    });

    expect(highPayload.reasoning_effort).toBe('high');
    expect(mediumPayload.reasoning_effort).toBe('medium');
  });

  it('still sends reasoning_effort for non-Grok OpenAI-compat models', async () => {
    const payload = await captureChatCompletionPayload({
      modelId: 'gpt-5.6',
      thinkingLevels: OPENAI_THINKING_LEVELS,
      reasoning: 'xhigh',
    });

    expect(payload.reasoning_effort).toBe('xhigh');
  });
});

async function captureChatCompletionPayload(input: {
  modelId: string;
  thinkingLevels: readonly ThinkingLevel[];
  reasoning: 'medium' | 'high' | 'xhigh';
}): Promise<Record<string, unknown>> {
  const captured = await withOpenAiChatFixture(async (baseUrl) => {
    const modelEntry: ModelConfigEntry = {
      id: input.modelId,
      reasoning: true,
      thinkingLevels: [...input.thinkingLevels],
    };
    const provider: ModelProviderConfig = {
      id: 'local-gateway',
      protocol: 'openai-compatible',
      name: 'Local gateway',
      baseUrl,
      models: [modelEntry],
    };
    const registration = buildPiProviderRegistration(provider, 'test-key');
    const model = registration.models[0];
    if (!model) {
      throw new Error(`model registration failed for ${input.modelId}`);
    }

    const streamSimple = resolvePiNativeSearchStream('openai-completions');
    const stream = streamSimple(
      { ...model, provider: provider.id },
      { messages: [{ role: 'user', content: 'fixture', timestamp: 1 }] },
      { apiKey: 'test-key', reasoning: input.reasoning },
    ) as { result?: () => Promise<unknown> };
    if (typeof stream.result !== 'function') {
      throw new Error('Pi stream did not expose result()');
    }
    await stream.result();
  });

  return captured;
}

async function withOpenAiChatFixture(
  run: (baseUrl: string) => Promise<void>,
): Promise<Record<string, unknown>> {
  let receivedPayload: Record<string, unknown> | undefined;
  const server = createServer((request, response) => {
    void readJsonObject(request)
      .then((payload) => {
        receivedPayload = payload;
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        response.end(
          [
            `data: ${JSON.stringify({
              id: 'chatcmpl-reasoning-effort',
              object: 'chat.completion.chunk',
              created: 1,
              model: 'fixture-model',
              choices: [
                {
                  index: 0,
                  delta: { role: 'assistant', content: 'ok' },
                  finish_reason: null,
                },
              ],
            })}`,
            `data: ${JSON.stringify({
              id: 'chatcmpl-reasoning-effort',
              object: 'chat.completion.chunk',
              created: 1,
              model: 'fixture-model',
              choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
            })}`,
            'data: [DONE]',
            '',
          ].join('\n\n'),
        );
      })
      .catch((error: unknown) => {
        response.writeHead(400, { 'content-type': 'text/plain' });
        response.end(error instanceof Error ? error.message : 'bad request');
      });
  });

  await listen(server);
  try {
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('test server did not expose a TCP address');
    }
    await run(`http://127.0.0.1:${address.port}/v1`);
  } finally {
    await closeServer(server);
  }

  if (!receivedPayload) {
    throw new Error('OpenAI-compat fixture did not capture a chat completion body');
  }
  return receivedPayload;
}

async function readJsonObject(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('chat completion body was not a JSON object');
  }
  return parsed as Record<string, unknown>;
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
