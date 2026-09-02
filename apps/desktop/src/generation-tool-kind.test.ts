import { describe, expect, it } from 'vitest';
import type { ToolCardUi } from './chat-reducer';
import {
  getGenerationStatus,
  resolveGenerationToolKind,
  shouldRenderGenerationProgress,
} from './generation-tool-kind.js';

function tool(input: Partial<ToolCardUi> = {}): ToolCardUi {
  return {
    toolCallId: 'call-1',
    toolName: 'piwin_toolbox',
    status: 'running',
    output: '',
    ...input,
  };
}

describe('resolveGenerationToolKind', () => {
  it('prefers normalized presentation kind', () => {
    expect(
      resolveGenerationToolKind(
        tool({ presentation: { kind: 'image', title: 'image_gen', routedToolName: 'image_gen' } }),
      ),
    ).toBe('image');
    expect(
      resolveGenerationToolKind(
        tool({ presentation: { kind: 'video', title: 'video_gen', routedToolName: 'video_gen' } }),
      ),
    ).toBe('video');
  });

  it('uses routed name for partially upgraded records', () => {
    expect(
      resolveGenerationToolKind(
        tool({ presentation: { kind: 'other', title: 'image_gen', routedToolName: 'image_gen' } }),
      ),
    ).toBe('image');
  });

  it('treats toolbox title image_gen as generation when routed name is missing', () => {
    expect(
      resolveGenerationToolKind(
        tool({ presentation: { kind: 'other', title: 'image_gen', actionVerb: 'Toolbox' } }),
      ),
    ).toBe('image');
  });

  it('keeps direct legacy generation calls working', () => {
    expect(resolveGenerationToolKind(tool({ toolName: 'image_gen' }))).toBe('image');
    expect(resolveGenerationToolKind(tool({ toolName: 'video_gen' }))).toBe('video');
  });

  it('does not infer generation from outer toolbox input or unknown targets', () => {
    expect(
      resolveGenerationToolKind(
        tool({
          presentation: {
            kind: 'process',
            title: 'process_start',
            routedToolName: 'process_start',
            inputPreview: '{"prompt":"image_gen"}',
          },
        }),
      ),
    ).toBeNull();
    expect(resolveGenerationToolKind(tool())).toBeNull();
  });
});

describe('shouldRenderGenerationProgress', () => {
  it('keeps running and failed cards, and hides done once media is attached', () => {
    expect(shouldRenderGenerationProgress('running', [])).toBe(true);
    expect(shouldRenderGenerationProgress('error', [])).toBe(true);
    expect(shouldRenderGenerationProgress('done', [])).toBe(true);
    expect(shouldRenderGenerationProgress('done', [{ kind: 'media' }])).toBe(false);
    expect(shouldRenderGenerationProgress(null, [{ kind: 'media' }])).toBe(false);
  });
});

describe('getGenerationStatus', () => {
  it('prioritizes running and failed generation calls', () => {
    expect(
      getGenerationStatus(
        {
          tools: [
            tool({ status: 'done', presentation: { kind: 'image', title: 'image_gen' } }),
            tool({
              toolCallId: 'call-2',
              status: 'running',
              presentation: { kind: 'image', title: 'image_gen' },
            }),
          ],
        },
        'image',
      ),
    ).toBe('running');
    expect(
      getGenerationStatus(
        {
          tools: [
            tool({ status: 'done', presentation: { kind: 'image', title: 'image_gen' } }),
            tool({
              toolCallId: 'call-2',
              status: 'error',
              presentation: { kind: 'image', title: 'image_gen' },
            }),
          ],
        },
        'image',
      ),
    ).toBe('error');
  });

  it('returns done only for matching generation calls', () => {
    expect(
      getGenerationStatus(
        {
          tools: [
            tool({
              status: 'done',
              presentation: { kind: 'image', title: 'image_gen' },
            }),
            tool({
              toolCallId: 'call-video',
              status: 'running',
              presentation: { kind: 'video', title: 'video_gen' },
            }),
          ],
        },
        'image',
      ),
    ).toBe('done');
    expect(getGenerationStatus({ tools: [] }, 'video')).toBeNull();
  });
});
