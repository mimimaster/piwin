import { describe, expect, it } from 'vitest';
import type { ToolCardUi } from './chat-reducer';
import { resolveGenerationToolKind } from './generation-tool-kind.js';

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
