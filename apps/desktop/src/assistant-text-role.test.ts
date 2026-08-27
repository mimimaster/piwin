import { describe, expect, it } from 'vitest';
import { assistantTextIsProcess, assistantTextRole } from './assistant-text-role.js';
import type { ChatMessageUi, ToolCardUi } from './chat-reducer.js';

function tool(
  partial: Pick<ToolCardUi, 'toolCallId' | 'toolName'> & Partial<ToolCardUi>,
): ToolCardUi {
  return {
    status: 'done',
    output: '',
    ...partial,
  };
}

function assistant(partial: Partial<ChatMessageUi> & Pick<ChatMessageUi, 'id'>): ChatMessageUi {
  return {
    role: 'assistant',
    text: '',
    thinking: '',
    tools: [],
    attachments: [],
    status: 'done',
    ...partial,
  };
}

describe('assistantTextRole', () => {
  it('treats tool-loop captions as process, not a reply', () => {
    const message = assistant({
      id: 'loop',
      text: '空框就是中间轮次的复制/再生成栏。接下来核对 transcript。',
      thinking: 'The user is asking about a fragmented conversation.',
      tools: [
        tool({ toolCallId: 't1', toolName: 'read' }),
        tool({ toolCallId: 't2', toolName: 'grep' }),
      ],
    });
    expect(assistantTextRole(message)).toBe('process');
    expect(assistantTextIsProcess(message)).toBe(true);
  });

  it('treats bash, web_search, web_fetch, and artifact_instructions as work tools', () => {
    for (const toolName of ['bash', 'web_search', 'web_fetch', 'artifact_instructions'] as const) {
      expect(
        assistantTextRole(
          assistant({
            id: `loop-${toolName}`,
            text: '接着核对。',
            tools: [tool({ toolCallId: `t-${toolName}`, toolName })],
          }),
        ),
      ).toBe('process');
    }
  });

  it('keeps a tool-less completion as a reply', () => {
    const message = assistant({
      id: 'final',
      text: '一只大嘴鹈鹕在海岸公路上骑复古自行车。',
    });
    expect(assistantTextRole(message)).toBe('reply');
    expect(assistantTextIsProcess(message)).toBe(false);
  });

  it('keeps image, video, and flashcard captions as replies', () => {
    expect(
      assistantTextRole(
        assistant({
          id: 'image',
          text: 'Here is the image.',
          tools: [tool({ toolCallId: 'g1', toolName: 'image_gen' })],
        }),
      ),
    ).toBe('reply');
    expect(
      assistantTextRole(
        assistant({
          id: 'video',
          text: '视频生成成功了',
          tools: [tool({ toolCallId: 'g2', toolName: 'video_gen' })],
        }),
      ),
    ).toBe('reply');
    expect(
      assistantTextRole(
        assistant({
          id: 'flash',
          text: '已创建一张闪卡。',
          tools: [tool({ toolCallId: 'g3', toolName: 'flashcard_create' })],
        }),
      ),
    ).toBe('reply');
  });

  it('treats routed toolbox generation as a reply and mixed work tools as process', () => {
    expect(
      assistantTextRole(
        assistant({
          id: 'routed-image',
          text: 'Here is the image.',
          tools: [
            tool({
              toolCallId: 'tb1',
              toolName: 'piwin_toolbox',
              presentation: { kind: 'image', title: 'image', routedToolName: 'image_gen' },
            }),
          ],
        }),
      ),
    ).toBe('reply');
    expect(
      assistantTextRole(
        assistant({
          id: 'mixed',
          text: 'Generating, then I will read the file.',
          tools: [
            tool({ toolCallId: 'g1', toolName: 'image_gen' }),
            tool({ toolCallId: 'r1', toolName: 'read' }),
          ],
        }),
      ),
    ).toBe('process');
  });

  it('does not inspect tool output to decide the role', () => {
    expect(
      assistantTextRole(
        assistant({
          id: 'read-cloze-output',
          text: '接着核对闪卡格式。',
          tools: [
            tool({
              toolCallId: 'r1',
              toolName: 'read',
              output: '{"model":"cloze","id":"card-1"}',
            }),
          ],
        }),
      ),
    ).toBe('process');
  });
});
