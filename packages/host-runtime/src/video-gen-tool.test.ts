import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { PiwinConfig } from '@piwin/contracts';
import { createSecretResolver } from './secret-resolver.js';
import { buildVideoGenTool, resolveVideoProvider } from './video-gen-tool.js';
import { VideoGenConfigError } from './video-generation-types.js';

function responseJson(value: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => value,
    arrayBuffer: async () => new TextEncoder().encode('generated-video').buffer,
    headers: { get: () => 'video/mp4' },
  } as unknown as Response;
}

function createConfig(overrides?: Partial<PiwinConfig>): PiwinConfig {
  return {
    hostMode: 'sdk',
    providers: [
      {
        id: 'openai-video',
        protocol: 'openai-compatible',
        name: 'OpenAI Videos',
        baseUrl: 'https://example.test/v1',
        apiKeyEnv: 'VIDEO_KEY',
        models: [
          {
            id: 'sora-2',
            capabilities: ['video-generation'],
            routes: {
              'video-generation': {
                apiStyle: 'openai-videos',
                path: '/videos',
                pollIntervalMs: 250,
              },
            },
          },
        ],
      },
    ],
    videoGeneration: {
      defaultModel: {
        protocol: 'openai-compatible',
        providerId: 'openai-video',
        modelId: 'sora-2',
      },
    },
    media: { maxPasteBytes: 50_000_000, allowedMimeTypes: ['image/png'] },
    artifact: {
      enabled: true,
      triggerMode: 'automatic',
      decisionPrompt: { mode: 'default', customPrompt: '' },
      maxBytes: 100_000,
    },
    ...overrides,
  };
}

describe('resolveVideoProvider', () => {
  it('only selects a model marked as video-capable', () => {
    const config = createConfig();
    expect(resolveVideoProvider(config).model.id).toBe('sora-2');
    expect(() => resolveVideoProvider(config, 'missing')).toThrow(VideoGenConfigError);
  });
});

describe('buildVideoGenTool', () => {
  it('returns a local video attachment after the provider task completes', async () => {
    const mediaRoot = await mkdtemp(join(tmpdir(), 'piwin-video-gen-'));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(responseJson({ id: 'sora-task', status: 'queued' }))
      .mockResolvedValueOnce(responseJson({ id: 'sora-task', status: 'completed' }))
      .mockResolvedValueOnce(responseJson({}));
    vi.stubGlobal('fetch', fetchMock);

    try {
      const tool = buildVideoGenTool({
        piwinRoot: '/tmp/piwin',
        sessionId: 'session-1',
        config: createConfig(),
        mediaConfig: {
          mediaRoot,
          maxPasteBytes: 50_000_000,
          allowedMimeTypes: ['video/mp4'],
        },
        secretResolver: createSecretResolver({ env: { VIDEO_KEY: 'key' } }),
      });
      expect(tool).not.toBeNull();
      if (!tool) throw new Error('video_gen tool should be available');

      const result = await tool.execute(
        { prompt: 'a paper boat crossing a river' },
        new AbortController().signal,
        {
          sessionId: 'session-1',
          runtimeGenerationId: 'generation-1',
          runId: 'run-1',
          toolName: 'video_gen',
        },
      );

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.message);
      expect(result.details?.attachments).toEqual([
        expect.objectContaining({
          kind: 'media',
          path: expect.stringContaining(`${mediaRoot}/session-1/`),
          mimeType: 'video/mp4',
          source: 'generated',
        }),
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('selects a discovered Sora model and builds the correct video tool route', () => {
    const config = createConfig();
    const resolved = resolveVideoProvider(config, 'sora-2');
    expect(resolved.provider.id).toBe('openai-video');
    expect(resolved.model.id).toBe('sora-2');
    expect(resolved.model.routes?.['video-generation']).toEqual({
      apiStyle: 'openai-videos',
      path: '/videos',
      pollIntervalMs: 250,
    });

    const tool = buildVideoGenTool({
      piwinRoot: '/tmp/piwin',
      sessionId: 'session-1',
      config,
      mediaConfig: {
        mediaRoot: '/tmp/media',
        maxPasteBytes: 50_000_000,
        allowedMimeTypes: ['video/mp4'],
      },
      secretResolver: createSecretResolver({ env: { VIDEO_KEY: 'key' } }),
    });
    expect(tool).not.toBeNull();
    expect(tool?.descriptor.name).toBe('video_gen');
  });

  it('fails closed when the requested video model is missing or disabled', () => {
    const config = createConfig({
      providers: [
        {
          id: 'openai-video',
          protocol: 'openai-compatible',
          name: 'OpenAI Videos',
          baseUrl: 'https://example.test/v1',
          apiKeyEnv: 'VIDEO_KEY',
          models: [{ id: 'gpt-4', capabilities: ['chat'] }],
        },
      ],
      videoGeneration: {},
    });

    expect(() => resolveVideoProvider(config, 'missing')).toThrow(VideoGenConfigError);
    const tool = buildVideoGenTool({
      piwinRoot: '/tmp/piwin',
      sessionId: 'session-1',
      config,
      mediaConfig: {
        mediaRoot: '/tmp/media',
        maxPasteBytes: 50_000_000,
        allowedMimeTypes: ['video/mp4'],
      },
      secretResolver: createSecretResolver({ env: { VIDEO_KEY: 'key' } }),
    });
    expect(tool).toBeNull();
  });
});
