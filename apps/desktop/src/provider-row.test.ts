import { describe, expect, it } from 'vitest';
import type { ModelConfigEntry } from '@piwin/contracts';
import { modelCaps } from './provider-row.js';

describe('modelCaps', () => {
  it('renders the video chip used to identify video-generation models', () => {
    const model: ModelConfigEntry = {
      id: 'grok-imagine-video',
      capabilities: ['video-generation'],
    };

    expect(modelCaps(model, true)).toContainEqual({
      key: 'video',
      label: '视频',
      bg: '#dcefff',
      fg: '#0066cc',
    });
  });

  it('renders the native web search chip with localized labels', () => {
    const model: ModelConfigEntry = {
      id: 'search-model',
      capabilities: ['native-web-search'],
    };

    expect(modelCaps(model, false)).toContainEqual({
      key: 'native-web-search',
      label: 'Native search',
      bg: '#e5ecfd',
      fg: '#3558b8',
    });
    expect(modelCaps(model, true)).toContainEqual({
      key: 'native-web-search',
      label: '模型内置搜索',
      bg: '#e5ecfd',
      fg: '#3558b8',
    });
  });
});
