import { describe, expect, it } from 'vitest';
import type { ModelConfigEntry } from '@piwin/contracts';
import { modelCaps } from './model-caps.js';

describe('modelCaps', () => {
  it('renders the video chip used to identify video-generation models', () => {
    const model: ModelConfigEntry = {
      id: 'grok-imagine-video',
      capabilities: ['video-generation'],
    };

    expect(modelCaps(model, true)).toContainEqual({
      key: 'video',
      label: '视频',
    });
    expect(modelCaps(model, true).some((cap) => cap.key === 'chat')).toBe(false);
  });

  it('does not label untagged Grok Imagine image/video ids as chat', () => {
    expect(modelCaps({ id: 'grok-imagine-image-lite' }, true).map((cap) => cap.key)).toEqual([
      'image',
    ]);
    expect(modelCaps({ id: 'grok-imagine-video' }, true).map((cap) => cap.key)).toEqual(['video']);
  });

  it('does not treat image/video generators as chat vision', () => {
    expect(
      modelCaps(
        {
          id: 'grok-imagine-image',
          capabilities: ['image-generation'],
          input: ['text', 'image'],
        },
        true,
      ).map((cap) => cap.key),
    ).toEqual(['image']);
    expect(
      modelCaps(
        {
          id: 'grok-imagine-video',
          capabilities: ['video-generation'],
          input: ['text', 'image'],
        },
        true,
      ).map((cap) => cap.key),
    ).toEqual(['video']);
  });

  it('renders the native web search chip with localized labels', () => {
    const model: ModelConfigEntry = {
      id: 'search-model',
      capabilities: ['native-web-search'],
    };

    expect(modelCaps(model, false)).toContainEqual({
      key: 'native-web-search',
      label: 'Native search',
    });
    expect(modelCaps(model, true)).toContainEqual({
      key: 'native-web-search',
      label: '模型内置搜索',
    });
  });
});
