import { describe, expect, it } from 'vitest';
import { buildMediaGenerationMeta } from './media-generation-card.js';

describe('buildMediaGenerationMeta', () => {
  it('formats running image meta with prompt', () => {
    expect(
      buildMediaGenerationMeta({
        kind: 'image',
        status: 'running',
        locale: 'zh-CN',
        tool: {
          toolCallId: '1',
          toolName: 'image_gen',
          status: 'running',
          output: '',
          presentation: {
            kind: 'image',
            title: 'gpt-image-1',
            inputPreview: '{"prompt":"砚台上的一盏铜灯"}',
          },
        },
      }),
    ).toContain('gpt-image-1');
  });

  it('formats failed video meta with error', () => {
    const meta = buildMediaGenerationMeta({
      kind: 'video',
      status: 'error',
      locale: 'zh-CN',
      tool: {
        toolCallId: '2',
        toolName: 'video_gen',
        status: 'error',
        output: '',
        presentation: {
          kind: 'video',
          title: 'veo-3',
          error: { category: 'execution', message: '429 rate_limited' },
        },
      },
    });
    expect(meta).toContain('veo-3');
    expect(meta).toContain('429');
  });
});
