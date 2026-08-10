import { describe, expect, it } from 'vitest';
import type { DiscoveredModel } from '@piwin/contracts';
import {
  applyVideoDiscoverySuggestion,
  sortVideoDiscoveryModels,
} from './video-model-discovery.js';

const recognized: DiscoveredModel = {
  id: 'sora-2',
  capabilities: ['video-generation'],
  videoGenerationSuggestion: {
    reason: 'registry',
    apiStyle: 'openai-videos',
    path: '/videos',
    label: 'Sora 2',
  },
};
const suggested: DiscoveredModel = {
  id: 'kling-v2',
  videoGenerationSuggestion: { reason: 'heuristic' },
};

describe('video-model-discovery', () => {
  it('orders recognized models before heuristic suggestions', () => {
    expect(sortVideoDiscoveryModels([suggested, recognized]).map((model) => model.id)).toEqual([
      'sora-2',
      'kling-v2',
    ]);
  });

  it('filters models without a video suggestion and sorts ties by model id', () => {
    expect(
      sortVideoDiscoveryModels([
        { id: 'chat-only' },
        {
          id: 'veo-3',
          capabilities: ['video-generation'],
          videoGenerationSuggestion: { reason: 'provider' },
        },
        { id: 'alpha-video', videoGenerationSuggestion: { reason: 'heuristic' } },
        { id: 'beta-video', videoGenerationSuggestion: { reason: 'heuristic' } },
      ]).map((model) => model.id),
    ).toEqual(['veo-3', 'alpha-video', 'beta-video']);
  });

  it('prefills a recognized model route without overwriting an explicit label', () => {
    expect(
      applyVideoDiscoverySuggestion(recognized, {
        apiStyle: 'openai-videos',
        path: '/videos',
        label: '',
      }),
    ).toEqual({
      id: 'sora-2',
      apiStyle: 'openai-videos',
      path: '/videos',
      label: 'Sora 2',
    });

    expect(
      applyVideoDiscoverySuggestion(recognized, {
        apiStyle: 'custom',
        path: '/custom/videos',
        label: 'My Sora route',
      }),
    ).toEqual({
      id: 'sora-2',
      apiStyle: 'openai-videos',
      path: '/videos',
      label: 'My Sora route',
    });

    expect(
      applyVideoDiscoverySuggestion(suggested, {
        apiStyle: 'custom',
        path: '/my/video/task',
        label: 'Manual model label',
      }),
    ).toEqual({
      id: 'kling-v2',
      apiStyle: 'custom',
      path: '/my/video/task',
      label: 'Manual model label',
    });
  });
});
