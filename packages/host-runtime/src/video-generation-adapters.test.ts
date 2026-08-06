import { describe, expect, it, vi } from 'vitest';
import type { ModelProviderConfig, VideoGenerationApiStyle } from '@piwin/contracts';
import { callVideoEndpoint } from './video-generation-adapters.js';
import type { VideoGenerationAdapterOptions } from './video-generation-types.js';

function responseJson(value: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => value,
    arrayBuffer: async () => new TextEncoder().encode('video-bytes').buffer,
    headers: { get: () => 'video/mp4' },
  } as unknown as Response;
}

function provider(style: VideoGenerationApiStyle, path: string): ModelProviderConfig {
  return {
    id: style,
    protocol: style === 'google-veo' ? 'google-gemini' : 'openai-compatible',
    name: style,
    baseUrl: `https://example.test/${style}`,
    apiKeyEnv: 'VIDEO_TEST_KEY',
    models: [
      {
        id: 'video-model',
        capabilities: ['video-generation'],
        routes: {
          'video-generation': { apiStyle: style, path, pollIntervalMs: 250 },
        },
      },
    ],
  };
}

function options(
  configuredProvider: ModelProviderConfig,
  fetchImpl: typeof fetch,
): VideoGenerationAdapterOptions {
  const model = configuredProvider.models[0];
  if (!model) throw new Error('test provider has no model');
  return {
    provider: configuredProvider,
    model,
    apiKey: 'test-key',
    input: { prompt: 'a cinematic paper boat on a river' },
    signal: new AbortController().signal,
    fetchImpl,
  };
}

describe('callVideoEndpoint', () => {
  it('creates, polls, and downloads an OpenAI Videos task', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(responseJson({ id: 'sora-task', status: 'queued' }))
      .mockResolvedValueOnce(responseJson({ id: 'sora-task', status: 'completed' }))
      .mockResolvedValueOnce(responseJson({}));
    const result = await callVideoEndpoint(
      options(provider('openai-videos', '/videos'), fetchMock as unknown as typeof fetch),
    );
    expect(result.providerTaskId).toBe('sora-task');
    expect(new TextDecoder().decode(result.bytes)).toBe('video-bytes');
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://example.test/openai-videos/videos');
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ method: 'POST' }));
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ body: expect.any(FormData) }),
    );
  });

  it('polls a Google Veo long-running operation and downloads its URI', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(responseJson({ name: 'operations/veo-task', done: false }))
      .mockResolvedValueOnce(
        responseJson({
          name: 'operations/veo-task',
          done: true,
          response: {
            generateVideoResponse: {
              generatedSamples: [{ video: { uri: 'https://cdn.example.test/veo.mp4' } }],
            },
          },
        }),
      )
      .mockResolvedValueOnce(responseJson({}));
    const result = await callVideoEndpoint(
      options(
        provider('google-veo', '/models/{model}:predictLongRunning'),
        fetchMock as unknown as typeof fetch,
      ),
    );
    expect(result.providerTaskId).toBe('operations/veo-task');
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      'https://example.test/google-veo/operations/veo-task',
    );
    expect(fetchMock.mock.calls[2]?.[0]).toBe('https://cdn.example.test/veo.mp4');
  });

  it('polls a Runway task and downloads its output URL', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(responseJson({ id: 'runway-task' }))
      .mockResolvedValueOnce(
        responseJson({ status: 'SUCCEEDED', output: ['https://cdn.test/runway.mp4'] }),
      )
      .mockResolvedValueOnce(responseJson({}));
    const result = await callVideoEndpoint(
      options(provider('runway-tasks', '/v1/text_to_video'), fetchMock as unknown as typeof fetch),
    );
    expect(result.providerTaskId).toBe('runway-task');
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      'https://example.test/runway-tasks/v1/tasks/runway-task',
    );
  });

  it('polls a Luma generation and downloads assets.video', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(responseJson({ id: 'luma-task' }))
      .mockResolvedValueOnce(
        responseJson({ state: 'completed', assets: { video: 'https://cdn.test/luma.mp4' } }),
      )
      .mockResolvedValueOnce(responseJson({}));
    const result = await callVideoEndpoint(
      options(
        provider('luma-generations', '/dream-machine/v1/generations/video'),
        fetchMock as unknown as typeof fetch,
      ),
    );
    expect(result.providerTaskId).toBe('luma-task');
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      'https://example.test/luma-generations/dream-machine/v1/generations/luma-task',
    );
  });

  it('polls a MiniMax H3 task and downloads task.content.url', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(responseJson({ task_id: 'minimax-task' }))
      .mockResolvedValueOnce(
        responseJson({
          task: { status: 'succeeded', content: { url: 'https://cdn.test/minimax.mp4' } },
        }),
      )
      .mockResolvedValueOnce(responseJson({}));
    const result = await callVideoEndpoint(
      options(
        provider('minimax-tasks', '/v2/video_generation'),
        fetchMock as unknown as typeof fetch,
      ),
    );
    expect(result.providerTaskId).toBe('minimax-task');
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      'https://example.test/minimax-tasks/v2/query/video_generation/minimax-task',
    );
  });
});
