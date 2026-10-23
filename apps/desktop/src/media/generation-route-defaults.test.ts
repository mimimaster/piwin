import { describe, expect, it } from 'vitest';
import {
  buildVideoGenerationRoute,
  patchProviderModelRoute,
  suggestImageGenerationRoute,
  suggestVideoGenerationRoute,
  withImageApiStyle,
  withVideoGenerationEnabled,
} from './generation-route-defaults.js';

describe('generation route defaults', () => {
  it('does not assume the channel protocol is the image wire format', () => {
    expect(suggestImageGenerationRoute('grok-imagine-image-lite', 'anthropic-compatible')).toEqual({
      apiStyle: 'openai',
      path: '/images/generations',
    });
    expect(suggestImageGenerationRoute('imagen-3', 'google-gemini')).toEqual({
      apiStyle: 'imagen',
      path: '/models/imagen-3:predict',
    });
    expect(suggestImageGenerationRoute('gemini-3.1-flash-image', 'openai-compatible')).toEqual({
      apiStyle: 'gemini',
      path: '/models/gemini-3.1-flash-image:generateContent',
    });
  });

  it('looks up video wire format from the model id, not the channel', () => {
    expect(suggestVideoGenerationRoute('grok-imagine-video', 'anthropic-compatible')).toEqual({
      apiStyle: 'xgrok-videos',
      path: '/videos/generations',
    });
    expect(suggestVideoGenerationRoute('sora-2', 'openai-compatible')).toEqual({
      apiStyle: 'openai-videos',
      path: '/videos',
    });
  });

  it('keeps a user-edited video path when enabling the capability again', () => {
    const draft = withVideoGenerationEnabled(
      {
        id: 'custom-async-video',
        supportsImageGeneration: false,
        supportsVideoGeneration: false,
        imageApiStyle: '',
        imagePath: '',
        imageTimeoutSeconds: '',
        videoApiStyle: 'custom',
        videoPath: '/v1/internal/videos',
        videoTimeoutSeconds: '600',
        videoPollIntervalSeconds: '3',
      },
      true,
      'openai-compatible',
    );
    expect(draft.videoApiStyle).toBe('custom');
    expect(draft.videoPath).toBe('/v1/internal/videos');
  });

  it('updates the default path when the image api style changes', () => {
    const next = withImageApiStyle(
      {
        id: 'gemini-image',
        supportsImageGeneration: true,
        supportsVideoGeneration: false,
        imageApiStyle: 'openai',
        imagePath: '/images/generations',
        imageTimeoutSeconds: '',
        videoApiStyle: '',
        videoPath: '',
        videoTimeoutSeconds: '',
        videoPollIntervalSeconds: '',
      },
      'gemini',
    );
    expect(next.imagePath).toBe('/models/gemini-image:generateContent');
  });

  it('patches only the target model route', () => {
    const next = patchProviderModelRoute(
      [
        {
          id: 'cpa',
          name: 'Cpa',
          protocol: 'openai-compatible',
          baseUrl: 'https://cpa.example/v1',
          models: [
            { id: 'grok-imagine-video', capabilities: ['video-generation'] },
            { id: 'chat', capabilities: ['chat'] },
          ],
        },
      ],
      'cpa',
      'grok-imagine-video',
      'video-generation',
      { apiStyle: 'xgrok-videos', path: '/videos/generations' },
    );
    expect(next[0]?.models[0]?.routes).toEqual({
      'video-generation': { apiStyle: 'xgrok-videos', path: '/videos/generations' },
    });
    expect(next[0]?.models[1]?.routes).toBeUndefined();
  });

  it('persists the selected video protocol onto the model route', () => {
    expect(
      buildVideoGenerationRoute({
        videoApiStyle: 'xgrok-videos',
        videoPath: 'videos/generations',
        videoTimeoutSeconds: '900',
        videoPollIntervalSeconds: '5',
      }),
    ).toEqual({
      apiStyle: 'xgrok-videos',
      path: '/videos/generations',
      timeoutMs: 900_000,
      pollIntervalMs: 5_000,
    });
  });
});
