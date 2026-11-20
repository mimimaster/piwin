import { describe, expect, it } from 'vitest';
import type { ModelProviderConfig } from '@piwin/contracts';
import {
  createMistralSseFetch,
  isMistralBaseUrl,
  isMistralModelId,
  isMistralOpenAiTarget,
  normalizeMistralSseDataLine,
  sanitizeMistralOpenAiPayload,
} from './mistral-openai-stream.js';
import { buildPiProviderRegistration } from './pi-model-runtime.js';
import type { SerializableWorkerProviderRuntime } from './rpc/serializable-blueprint.js';
import { buildWorkerProviderRegistration } from './rpc/worker-pi-session-factory.js';

type FetchLike = typeof globalThis.fetch;

describe('mistral-openai-stream helpers', () => {
  it('detects Mistral base URLs, model prefixes, and targets', () => {
    expect(isMistralBaseUrl('https://api.mistral.ai/v1')).toBe(true);
    expect(isMistralBaseUrl('https://API.MISTRAL.AI/v1')).toBe(true);
    expect(isMistralBaseUrl('https://api.openai.com/v1')).toBe(false);
    expect(isMistralBaseUrl(undefined)).toBe(false);

    expect(isMistralModelId('devstral-2512')).toBe(true);
    expect(isMistralModelId('mistralai/codestral-latest')).toBe(true);
    expect(isMistralModelId('deepseek-v4-1-flash-1017')).toBe(false);

    expect(isMistralOpenAiTarget('deepseek-v4-1-flash-1017', 'https://api.mistral.ai/v1')).toBe(
      true,
    );
    expect(isMistralOpenAiTarget('devstral-2512', 'http://127.0.0.1:8317/v1')).toBe(true);
    expect(isMistralOpenAiTarget('gpt-5.6', 'http://127.0.0.1:8317/v1')).toBe(false);
  });

  it('strips historical assistant reasoning fields without mutating input', () => {
    const input = {
      model: 'deepseek-v4-1-flash-1017',
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi', reasoning_content: 'keep-non-assistant' },
        {
          role: 'assistant',
          content: 'done',
          reasoning_content: 'secret thought',
          reasoning: 'alt',
          reasoning_text: 'alt2',
          tool_calls: [{ id: 'tc_1', type: 'function', function: { name: 'read', arguments: '{}' } }],
        },
        { role: 'tool', tool_call_id: 'tc_1', name: 'read', content: 'ok' },
      ],
    };
    const snapshot = structuredClone(input);
    const sanitized = sanitizeMistralOpenAiPayload(input) as {
      messages: Array<Record<string, unknown>>;
    };

    expect(input).toEqual(snapshot);
    expect(sanitized.messages[1]).toHaveProperty('reasoning_content', 'keep-non-assistant');
    expect(sanitized.messages[2]).toEqual({
      role: 'assistant',
      content: 'done',
      tool_calls: [{ id: 'tc_1', type: 'function', function: { name: 'read', arguments: '{}' } }],
    });
    expect(sanitized.messages[2]).not.toHaveProperty('reasoning_content');
    expect(sanitized.messages[2]).not.toHaveProperty('reasoning');
    expect(sanitized.messages[2]).not.toHaveProperty('reasoning_text');
  });

  it('normalizes array delta.content chunks and passes plain strings through', () => {
    const plainChunk = JSON.stringify({
      id: 'c1',
      choices: [{ index: 0, delta: { content: 'plain text' }, finish_reason: null }],
    });
    expect(normalizeMistralSseDataLine(plainChunk)).toBeUndefined();
    expect(normalizeMistralSseDataLine('[DONE]')).toBeUndefined();

    const thinkingOnly = normalizeMistralSseDataLine(
      JSON.stringify({
        id: 'c2',
        choices: [
          {
            index: 0,
            delta: {
              content: [{ type: 'thinking', thinking: [{ type: 'text', text: '思考' }], closed: false }],
            },
            finish_reason: null,
          },
        ],
      }),
    );
    expect(thinkingOnly).toHaveLength(1);
    expect(JSON.parse(thinkingOnly?.[0] ?? '{}')).toMatchObject({
      choices: [{ index: 0, delta: { content: null, reasoning_content: '思考' } }],
    });

    const textOnly = normalizeMistralSseDataLine(
      JSON.stringify({
        id: 'c3',
        choices: [
          {
            index: 0,
            delta: { content: [{ type: 'text', text: '回答' }] },
            finish_reason: null,
          },
        ],
      }),
    );
    expect(textOnly).toHaveLength(1);
    expect(JSON.parse(textOnly?.[0] ?? '{}')).toMatchObject({
      choices: [{ index: 0, delta: { content: '回答' } }],
    });

    const mixed = normalizeMistralSseDataLine(
      JSON.stringify({
        id: 'c4',
        choices: [
          {
            index: 0,
            delta: {
              content: [
                { type: 'thinking', thinking: [{ type: 'text', text: '先想' }], closed: true },
                { type: 'text', text: '再答' },
              ],
            },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 20 },
      }),
    );
    expect(mixed).toHaveLength(2);
    const first = JSON.parse(mixed?.[0] ?? '{}') as Record<string, unknown>;
    const second = JSON.parse(mixed?.[1] ?? '{}') as Record<string, unknown>;
    expect(first).not.toHaveProperty('usage');
    expect(first).toMatchObject({
      choices: [
        { index: 0, delta: { content: null, reasoning_content: '先想' }, finish_reason: null },
      ],
    });
    expect(second).toMatchObject({
      choices: [{ index: 0, delta: { content: '再答' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 20 },
    });

    const closedEmpty = normalizeMistralSseDataLine(
      JSON.stringify({
        id: 'c5',
        choices: [
          {
            index: 0,
            delta: { content: [{ type: 'thinking', thinking: [], closed: true }] },
            finish_reason: null,
          },
        ],
      }),
    );
    expect(closedEmpty).toHaveLength(1);
    expect(JSON.parse(closedEmpty?.[0] ?? '{}')).toMatchObject({
      choices: [{ index: 0, delta: { content: null } }],
    });
  });

  it('decodes split UTF-8 Chinese characters and split SSE lines in createMistralSseFetch', async () => {
    const fullSse = [
      `data: ${JSON.stringify({
        id: 'c1',
        choices: [
          {
            index: 0,
            delta: {
              content: [{ type: 'thinking', thinking: [{ type: 'text', text: '中文深度思考过程' }] }],
            },
            finish_reason: null,
          },
        ],
      })}`,
      '',
      `data: ${JSON.stringify({
        id: 'c1',
        choices: [
          {
            index: 0,
            delta: { content: [{ type: 'text', text: '最终中文回答' }] },
            finish_reason: 'stop',
          },
        ],
      })}`,
      '',
      'data: [DONE]',
      '',
    ].join('\n');

    const rawBytes = new TextEncoder().encode(fullSse);
    // Cut into 7-byte slices so multi-byte UTF-8 codepoints and SSE lines split across chunks.
    const body = new ReadableStream<Uint8Array>({
      start(controller): void {
        for (let offset = 0; offset < rawBytes.length; offset += 7) {
          controller.enqueue(rawBytes.slice(offset, offset + 7));
        }
        controller.close();
      },
    });
    const baseFetch: FetchLike = async () =>
      new Response(body, {
        status: 200,
        headers: {
          'content-type': 'text/event-stream; charset=utf-8',
          'content-length': String(rawBytes.length),
        },
      });

    const wrappedFetch = createMistralSseFetch(baseFetch);
    const response = await wrappedFetch('https://api.mistral.ai/v1/chat/completions');
    expect(response.headers.has('content-length')).toBe(false);
    const normalizedText = await response.text();
    expect(normalizedText).toContain('"reasoning_content":"中文深度思考过程"');
    expect(normalizedText).toContain('"content":"最终中文回答"');
    expect(normalizedText).toContain('data: [DONE]');

    // Non-SSE and error responses pass through untouched.
    const errorFetch: FetchLike = async () =>
      new Response('{"error":"bad"}', {
        status: 422,
        headers: { 'content-type': 'application/json', 'content-length': '15' },
      });
    const errorResponse = await createMistralSseFetch(errorFetch)(
      'https://api.mistral.ai/v1/chat/completions',
    );
    expect(errorResponse.status).toBe(422);
    expect(errorResponse.headers.get('content-length')).toBe('15');
    expect(await errorResponse.text()).toBe('{"error":"bad"}');
  });
});

describe('Mistral OpenAI-compat end-to-end Pi wire', () => {
  it('sends reasoning_effort, normalizes SSE array thinking+text, and strips turn-2 assistant reasoning', async () => {
    const capturedBodies: Array<Record<string, unknown>> = [];
    const mockFetch: FetchLike = async (_input, init) => {
      const bodyText = typeof init?.body === 'string' ? init.body : '';
      capturedBodies.push(JSON.parse(bodyText) as Record<string, unknown>);
      await new Promise((resolve) => setTimeout(resolve, 5));

      const sse = [
        `data: ${JSON.stringify({
          id: 'chatcmpl-mistral-1',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'deepseek-v4-1-flash-1017',
          choices: [
            {
              index: 0,
              delta: {
                role: 'assistant',
                content: [{ type: 'thinking', thinking: [{ type: 'text', text: '第一步思考' }] }],
              },
              finish_reason: null,
            },
          ],
        })}`,
        '',
        `data: ${JSON.stringify({
          id: 'chatcmpl-mistral-1',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'deepseek-v4-1-flash-1017',
          choices: [
            {
              index: 0,
              delta: {
                content: [
                  { type: 'thinking', thinking: [{ type: 'text', text: '收尾' }], closed: true },
                  { type: 'text', text: '你好' },
                ],
              },
              finish_reason: null,
            },
          ],
        })}`,
        '',
        `data: ${JSON.stringify({
          id: 'chatcmpl-mistral-1',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'deepseek-v4-1-flash-1017',
          choices: [
            {
              index: 0,
              delta: { content: [{ type: 'text', text: '世界' }] },
              finish_reason: 'stop',
            },
          ],
        })}`,
        '',
        'data: [DONE]',
        '',
      ].join('\n');

      return new Response(sse, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    };

    const provider: ModelProviderConfig = {
      id: 'custom-openai',
      protocol: 'openai-compatible',
      name: 'mistral',
      baseUrl: 'https://api.mistral.ai/v1',
      models: [
        {
          id: 'deepseek-v4-1-flash-1017',
          reasoning: true,
          thinkingLevels: ['high', 'xhigh', 'max'],
        },
        {
          id: 'codestral-latest',
          reasoning: false,
        },
      ],
    };

    const registration = buildPiProviderRegistration(provider, 'test-key');
    const dsModel = registration.models[0];
    const codestralModel = registration.models[1];
    const streamSimple = registration.streamSimple;
    if (!dsModel || !codestralModel || !streamSimple) {
      throw new Error('Mistral registration incomplete');
    }

    const turn1Stream = streamSimple(
      { ...dsModel, provider: provider.id },
      { messages: [{ role: 'user', content: 'Turn 1', timestamp: 1 }] },
      { apiKey: 'test-key', reasoning: 'max', fetch: mockFetch },
    ) as { result?: () => Promise<Record<string, unknown>> };
    const turn1Message = await turn1Stream.result?.();

    expect(capturedBodies[0]?.reasoning_effort).toBe('max');
    expect(capturedBodies[0]).toHaveProperty('max_tokens');
    expect(capturedBodies[0]).not.toHaveProperty('thinking');
    expect(capturedBodies[0]).not.toHaveProperty('store');
    expect(capturedBodies[0]).not.toHaveProperty('max_completion_tokens');
    expect(capturedBodies[0]).not.toHaveProperty('stream_options');

    expect(turn1Message).toMatchObject({
      stopReason: 'stop',
      firstTokenKind: 'reasoning',
    });
    const contentBlocks = turn1Message?.content as Array<Record<string, unknown>>;
    expect(contentBlocks).toEqual([
      {
        type: 'thinking',
        thinking: '第一步思考收尾',
        thinkingSignature: 'reasoning_content',
      },
      {
        type: 'text',
        text: '你好世界',
      },
    ]);

    // Turn 2 replays Turn 1 assistant message; sanitizeMistralOpenAiPayload must strip reasoning_content.
    const turn2Stream = streamSimple(
      { ...dsModel, provider: provider.id },
      {
        messages: [
          { role: 'user', content: 'Turn 1', timestamp: 1 },
          turn1Message,
          { role: 'user', content: 'Turn 2', timestamp: 2 },
        ],
      },
      { apiKey: 'test-key', reasoning: 'max', fetch: mockFetch },
    ) as { result?: () => Promise<Record<string, unknown>> };
    await turn2Stream.result?.();

    const turn2Messages = capturedBodies[1]?.messages as Array<Record<string, unknown>>;
    const replayedAssistant = turn2Messages.find((msg) => msg.role === 'assistant');
    expect(replayedAssistant).toBeDefined();
    expect(replayedAssistant).toMatchObject({ role: 'assistant', content: '你好世界' });
    expect(replayedAssistant).not.toHaveProperty('reasoning_content');

    // Non-reasoning model on Mistral omits reasoning_effort even if caller passes reasoning.
    const nonReasoningStream = streamSimple(
      { ...codestralModel, provider: provider.id },
      { messages: [{ role: 'user', content: 'Complete code', timestamp: 3 }] },
      { apiKey: 'test-key', reasoning: 'high', fetch: mockFetch },
    ) as { result?: () => Promise<Record<string, unknown>> };
    await nonReasoningStream.result?.();

    expect(capturedBodies[2]).not.toHaveProperty('reasoning_effort');
  });

  it('preserves Mistral reasoning_effort and SSE normalization in RPC worker registrations', async () => {
    const capturedBodies: Array<Record<string, unknown>> = [];
    const mockFetch: FetchLike = async (_input, init) => {
      const bodyText = typeof init?.body === 'string' ? init.body : '';
      capturedBodies.push(JSON.parse(bodyText) as Record<string, unknown>);

      const sse = [
        `data: ${JSON.stringify({
          id: 'chatcmpl-worker-1',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'deepseek-v4-1-flash-1017',
          choices: [
            {
              index: 0,
              delta: {
                content: [{ type: 'thinking', thinking: [{ type: 'text', text: 'worker思考' }] }],
              },
              finish_reason: null,
            },
          ],
        })}`,
        '',
        `data: ${JSON.stringify({
          id: 'chatcmpl-worker-1',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'deepseek-v4-1-flash-1017',
          choices: [
            {
              index: 0,
              delta: { content: [{ type: 'text', text: 'worker完成' }] },
              finish_reason: 'stop',
            },
          ],
        })}`,
        '',
        'data: [DONE]',
        '',
      ].join('\n');

      return new Response(sse, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    };

    const envelope: SerializableWorkerProviderRuntime = {
      providerId: 'custom-openai',
      protocol: 'openai-compatible',
      baseUrl: 'https://api.mistral.ai/v1',
      models: [
        {
          id: 'deepseek-v4-1-flash-1017',
          reasoning: true,
          thinkingLevels: ['high', 'xhigh', 'max'],
        },
      ],
      auth: { kind: 'env', envName: 'MISTRAL_API_KEY' },
    };

    const registration = buildWorkerProviderRegistration(envelope, 'worker-key');
    const model = registration.models[0];
    const streamSimple = registration.streamSimple;
    if (!model || !streamSimple) {
      throw new Error('Worker Mistral registration incomplete');
    }

    expect(model.compat?.supportsReasoningEffort).toBe(true);

    const stream = streamSimple(
      { ...model, provider: envelope.providerId },
      { messages: [{ role: 'user', content: 'hi', timestamp: 1 }] },
      { apiKey: 'worker-key', reasoning: 'xhigh', fetch: mockFetch },
    ) as { result?: () => Promise<Record<string, unknown>> };
    const result = await stream.result?.();

    expect(capturedBodies[0]?.reasoning_effort).toBe('xhigh');
    expect(result?.content).toEqual([
      {
        type: 'thinking',
        thinking: 'worker思考',
        thinkingSignature: 'reasoning_content',
      },
      {
        type: 'text',
        text: 'worker完成',
      },
    ]);
  });
});
