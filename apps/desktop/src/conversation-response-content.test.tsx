// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import type { ChatMessageUi } from './chat-reducer';
import type { ExploreFlowRole } from './explore-flow';
import { ConversationResponseContent } from './conversation-response-content';
import {
  collectFlashcardToolsFromMessages,
  extractFlashcardRecords,
  messageHasFlashcardToolResult,
} from './flashcard-result-extract';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mountedRenders: Array<{ container: HTMLElement; root: Root }> = [];

function renderContent(node: ReactElement): { container: HTMLElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>{node}</PiwinUiProvider>);
  });
  const render = { container, root };
  mountedRenders.push(render);
  return render;
}

describe('ConversationResponseContent', () => {
  afterEach(() => {
    for (const { container, root } of mountedRenders) {
      try {
        act(() => {
          root.unmount();
        });
        container.remove();
      } catch {
        // cleanup best-effort
      }
    }
    mountedRenders.length = 0;
  });

  it('extracts structured display cards from flashcard tool output JSON', () => {
    const message: ChatMessageUi = {
      id: 'm-1',
      role: 'assistant',
      text: 'Here is your card summary',
      thinking: '',
      tools: [
        {
          toolCallId: 'tc-1',
          toolName: 'flashcard_create',
          status: 'done',
          output: JSON.stringify({
            card: { id: 'card-123', front: 'Q', back: 'A' },
            display: {
              cards: [
                {
                  cardId: 'card-123',
                  itemId: 'card-123',
                  model: 'basic',
                  ordinal: 1,
                  deck: 'default',
                  front: 'Q',
                  back: 'A',
                  createdAt: '2026-08-24T00:00:00.000Z',
                },
              ],
            },
          }),
        },
      ],
      attachments: [],
      status: 'done',
    };

    expect(messageHasFlashcardToolResult(message)).toBe(true);
    const cards = extractFlashcardRecords(message);
    expect(cards).toHaveLength(1);
    expect(cards[0]?.cardId).toBe('card-123');
    expect(cards[0]?.front).toBe('Q');
    expect(cards[0]?.back).toBe('A');
  });

  it('renders extracted flashcard artifact when message.text does not contain fence', () => {
    const message: ChatMessageUi = {
      id: 'm-1',
      role: 'assistant',
      text: '已创建一张关于光合作用的闪卡：\n- 正面：什么是光合作用？',
      thinking: 'Let me summarize the card',
      tools: [
        {
          toolCallId: 'tc-1',
          toolName: 'flashcard_create',
          status: 'done',
          output: JSON.stringify({
            card: { id: 'card-photo', front: '什么是光合作用？', back: '光能转化' },
            display: {
              cards: [
                {
                  cardId: 'card-photo',
                  itemId: 'card-photo',
                  model: 'basic',
                  ordinal: 1,
                  deck: 'default',
                  front: '什么是光合作用？',
                  back: '光能转化',
                  createdAt: '2026-08-24T00:00:00.000Z',
                },
              ],
            },
          }),
        },
      ],
      attachments: [],
      status: 'done',
    };

    const { container } = renderContent(
      <ConversationResponseContent
        message={message}
        messageIndex={0}
        showStreamingCaret={false}
        activeTheme={null}
        artifactThemeKey="default"
        runRecordsById={{}}
        activeRunId={null}
        locale="zh-CN"
        artifactPreviewEnabled={true}
      />,
    );

    expect(container.querySelector('[data-testid="conversation-thinking-summary"]')).not.toBeNull();
    expect(container.textContent).toContain('已创建一张关于光合作用的闪卡');
    expect(
      container.querySelector('[data-testid="conversation-extracted-flashcard"]'),
    ).not.toBeNull();
    expect(container.querySelector('[data-testid="chat-flashcard"]')).not.toBeNull();
    expect(container.textContent).toContain('什么是光合作用？');
  });

  it('renders the first-token activity for an empty streaming assistant message', () => {
    const message: ChatMessageUi = {
      id: 'm-streaming-empty',
      role: 'assistant',
      text: '',
      thinking: '',
      tools: [],
      attachments: [],
      status: 'streaming',
    };

    const { container } = renderContent(
      <ConversationResponseContent
        message={message}
        messageIndex={0}
        showStreamingCaret={false}
        activeTheme={null}
        artifactThemeKey="default"
        runRecordsById={{}}
        activeRunId={null}
        locale="en"
        isStreaming
        artifactPreviewEnabled={true}
      />,
    );

    expect(container.querySelector('[data-testid="conversation-activity"]')).not.toBeNull();
  });

  it('streams live reasoning text while the Conversation bubble is still open', () => {
    const message: ChatMessageUi = {
      id: 'm-live-think',
      role: 'assistant',
      text: '',
      thinking: 'Visualize a pelican on a bicycle, then emit the SVG fence.',
      tools: [],
      attachments: [],
      status: 'streaming',
    };

    const { container } = renderContent(
      <ConversationResponseContent
        message={message}
        messageIndex={0}
        showStreamingCaret={false}
        activeTheme={null}
        artifactThemeKey="default"
        runRecordsById={{}}
        activeRunId="run-live-think"
        locale="zh-CN"
        isStreaming
        artifactPreviewEnabled={true}
      />,
    );

    expect(container.querySelector('[data-testid="conversation-thinking"]')?.textContent).toContain(
      'Visualize a pelican on a bicycle',
    );
    expect(
      container.querySelector('[data-testid="conversation-thinking-wrapper"]')?.className,
    ).toContain('is-open');
  });

  it('keeps live reasoning open after a caption starts on the same bubble', () => {
    const message: ChatMessageUi = {
      id: 'm-think-caption',
      role: 'assistant',
      text: '正在把鹈鹕画进循环骑行动画。',
      thinking: 'Keep drawing the pouch and black wingtips.',
      thinkingStartedAt: 1_000,
      thinkingEndedAt: 2_000,
      tools: [],
      attachments: [],
      status: 'streaming',
    };

    const { container } = renderContent(
      <ConversationResponseContent
        message={message}
        messageIndex={0}
        showStreamingCaret={false}
        activeTheme={null}
        artifactThemeKey="default"
        runRecordsById={{}}
        activeRunId="run-think-caption"
        locale="zh-CN"
        isStreaming
        artifactPreviewEnabled={true}
      />,
    );

    expect(container.querySelector('[data-testid="conversation-thinking"]')?.textContent).toContain(
      'Keep drawing the pouch',
    );
    expect(container.textContent).toContain('正在把鹈鹕画进循环骑行动画。');
  });

  it('stops the thinking spinner and shows composing progress while tool args stream', () => {
    const message: ChatMessageUi = {
      id: 'm-compose-args',
      role: 'assistant',
      text: '',
      thinking: 'Writing the escaped prototype file.',
      thinkingStartedAt: 1_000,
      thinkingEndedAt: 5_000,
      toolArgsProgress: { argumentCharCount: 38900, toolName: 'write_file' },
      tools: [],
      attachments: [],
      status: 'streaming',
    };

    const { container } = renderContent(
      <ConversationResponseContent
        message={message}
        messageIndex={0}
        showStreamingCaret={false}
        activeTheme={null}
        artifactThemeKey="default"
        runRecordsById={{}}
        activeRunId="run-compose"
        locale="zh-CN"
        isStreaming
        artifactPreviewEnabled={true}
      />,
    );

    expect(container.querySelector('[data-testid="conversation-thinking-wrapper"]')).not.toBeNull();
    expect(
      container.querySelector('[data-testid="conversation-thinking-active-animation"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="conversation-tool-args-progress"]')?.textContent,
    ).toContain('write_file');
    expect(
      container.querySelector('[data-testid="conversation-tool-args-progress"]')?.textContent,
    ).toContain('38.9k');
  });

  it('renders Conversation web_search as a tool card', () => {
    const message: ChatMessageUi = {
      id: 'm-search',
      role: 'assistant',
      text: '一只大嘴鹈鹕正在海边骑巡航车。',
      thinking: '',
      tools: [
        {
          toolCallId: 't-web',
          toolName: 'web_search',
          status: 'done',
          output: '{"hits":[]}',
          presentation: {
            kind: 'web',
            title: 'web_search',
            actionVerb: 'Searched',
            inputPreview: '{"query":"white pelican"}',
          },
        },
      ],
      attachments: [],
      status: 'done',
    };

    const { container } = renderContent(
      <ConversationResponseContent
        message={message}
        messageIndex={0}
        showStreamingCaret={false}
        activeTheme={null}
        artifactThemeKey="default"
        runRecordsById={{}}
        activeRunId={null}
        locale="zh-CN"
        artifactPreviewEnabled={true}
      />,
    );

    expect(container.querySelector('[data-testid="turn-tool-group"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="tool-call-card"]')).not.toBeNull();
    expect(container.querySelector('.markdown')?.textContent).toContain(
      '一只大嘴鹈鹕正在海边骑巡航车。',
    );
  });

  it('renders a narration explore flow as one capsule after the status text', () => {
    const grepTool = {
      toolCallId: 't-grep-1',
      toolName: 'grep',
      status: 'done' as const,
      output: '76',
      presentation: {
        kind: 'filesystem' as const,
        title: 'Search',
        actionVerb: 'Searched',
        summary: 'voice|realtime',
        countTag: '76 matches',
      },
    };
    const laterGrep = {
      ...grepTool,
      toolCallId: 't-grep-2',
    };
    const message: ChatMessageUi = {
      id: 'm-narrate',
      role: 'assistant',
      text: '我先查一下实时语音和会话绑定相关的实现/文档。',
      thinking: 'look up the binder',
      tools: [grepTool],
      attachments: [],
      status: 'done',
    };
    const exploreRole: ExploreFlowRole = {
      kind: 'anchor',
      group: {
        anchorMessageId: message.id,
        memberMessageIds: [message.id, 'm-later'],
        items: [
          { kind: 'tool', messageId: message.id, tool: grepTool },
          { kind: 'tool', messageId: 'm-later', tool: laterGrep },
        ],
        toolCount: 2,
        fileCount: 2,
        searchCount: 2,
        thoughtCount: 0,
        hasRunning: false,
        isLive: false,
        errorCount: 0,
      },
    };

    const { container } = renderContent(
      <ConversationResponseContent
        message={message}
        messageIndex={0}
        showStreamingCaret={false}
        activeTheme={null}
        artifactThemeKey="default"
        runRecordsById={{}}
        activeRunId={null}
        locale="zh-CN"
        artifactPreviewEnabled={true}
        exploreRole={exploreRole}
      />,
    );

    expect(container.querySelector('.markdown')?.textContent).toContain(
      '我先查一下实时语音和会话绑定相关的实现/文档。',
    );
    expect(container.querySelector('[data-testid="explore-flow-capsule"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="explore-flow-title"]')?.textContent).toContain(
      '探索了 2 个文件 · 2 次搜索',
    );
    expect(container.querySelector('[data-testid="turn-tool-group"]')).toBeNull();
    expect(container.querySelectorAll('[data-testid="explore-flow-capsule"]')).toHaveLength(1);
  });

  it('collapses completed reasoning so history stays compact', () => {
    const message: ChatMessageUi = {
      id: 'm-think-done',
      role: 'assistant',
      text: '下面是一只在海边骑车的鹈鹕。',
      thinking: 'Finished the SVG.',
      thinkingStartedAt: 1_000,
      thinkingEndedAt: 5_000,
      tools: [],
      attachments: [],
      status: 'done',
    };

    const { container } = renderContent(
      <ConversationResponseContent
        message={message}
        messageIndex={0}
        showStreamingCaret={false}
        activeTheme={null}
        artifactThemeKey="default"
        runRecordsById={{}}
        activeRunId={null}
        locale="zh-CN"
        artifactPreviewEnabled={true}
      />,
    );

    expect(container.querySelector('[data-testid="conversation-thinking"]')).toBeNull();
    expect(container.querySelector('[data-testid="conversation-thinking-summary"]')).not.toBeNull();
  });

  it('handles interaction on native flashcard: reveal, rate, and action callback', () => {
    let capturedAction: unknown = null;
    const message: ChatMessageUi = {
      id: 'm-2',
      role: 'assistant',
      text: '',
      thinking: 'Thinking for 7s',
      tools: [
        {
          toolCallId: 'tc-2',
          toolName: 'flashcard_create',
          status: 'done',
          output: JSON.stringify({
            card: {
              id: 'card-photo',
              deck: '生物',
              front: '什么是光合作用？',
              back: '光能转化为化学能',
              tags: ['生物学'],
            },
          }),
        },
      ],
      attachments: [],
      status: 'done',
    };

    const { container } = renderContent(
      <ConversationResponseContent
        message={message}
        messageIndex={0}
        showStreamingCaret={false}
        activeTheme={null}
        artifactThemeKey="default"
        runRecordsById={{}}
        activeRunId={null}
        locale="zh-CN"
        artifactPreviewEnabled={true}
        onArtifactAction={(action) => {
          capturedAction = action;
        }}
      />,
    );

    const frame = container.querySelector('.flip');
    expect(frame).not.toBeNull();
    expect(container.textContent).toContain('什么是光合作用？');
    expect(container.textContent).not.toContain('光能转化为化学能');

    const card = container.querySelector('.fc-card');
    act(() => {
      card?.dispatchEvent(
        new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }),
      );
    });

    expect(container.textContent).toContain('光能转化为化学能');
    expect(container.querySelector('.chat-flashcard-rate-section')).not.toBeNull();

    const goodBtn = container.querySelector('.rate .btn-good');
    expect(goodBtn).not.toBeNull();
    act(() => {
      goodBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.textContent).toContain('已记录：记得');
    expect(capturedAction).toEqual({
      type: 'piwin-artifact:action',
      channelId: 'card-photo',
      action: 'flashcard/rate',
      payload: { cardId: 'card-photo', rating: 'good' },
    });
  });

  it('extracts cards even when tools are in originalTools (virtualized turn structure)', () => {
    const message = {
      id: 'm-3',
      role: 'assistant' as const,
      text: '',
      thinking: 'Thinking...',
      tools: [],
      originalTools: [
        {
          toolCallId: 'tc-3',
          toolName: 'flashcard_create',
          status: 'done' as const,
          output: JSON.stringify({
            card: {
              id: 'card-virt',
              deck: '物理',
              front: '牛顿第一定律',
              back: '惯性定律',
            },
          }),
        },
      ],
      attachments: [],
      status: 'done' as const,
    };

    const { container } = renderContent(
      <ConversationResponseContent
        message={message as unknown as ChatMessageUi}
        messageIndex={0}
        showStreamingCaret={false}
        activeTheme={null}
        artifactThemeKey="default"
        runRecordsById={{}}
        activeRunId={null}
        locale="zh-CN"
        artifactPreviewEnabled={true}
      />,
    );

    expect(container.querySelector('[data-testid="chat-flashcard"]')).not.toBeNull();
    expect(container.textContent).toContain('牛顿第一定律');
    expect(container.textContent).toContain('物理');
  });

  it('extracts cards from piwin_toolbox routed flashcard_create tool with presentation.output', () => {
    const flashcardPayload = JSON.stringify({
      card: {
        id: 'card-bio-1',
        deck: '生物',
        front: '什么是光合作用？',
        back: '光能转化为化学能',
        tags: ['生物学', '能量转化'],
      },
    });

    const message: ChatMessageUi = {
      id: 'm-4',
      role: 'assistant',
      text: '',
      thinking: 'Thinking for 7s',
      tools: [
        {
          toolCallId: 'functions.piwin_toolbox:1',
          toolName: 'piwin_toolbox',
          status: 'done',
          output: flashcardPayload,
          presentation: {
            kind: 'other',
            title: 'flashcard_create',
            routedToolName: 'flashcard_create',
            output: { text: flashcardPayload, truncated: false },
          },
        },
      ],
      attachments: [],
      status: 'done',
    };

    const { container } = renderContent(
      <ConversationResponseContent
        message={message}
        messageIndex={0}
        showStreamingCaret={false}
        activeTheme={null}
        artifactThemeKey="default"
        runRecordsById={{}}
        activeRunId={null}
        locale="zh-CN"
        artifactPreviewEnabled={true}
      />,
    );

    expect(container.querySelector('[data-testid="chat-flashcard"]')).not.toBeNull();
    expect(container.textContent).toContain('什么是光合作用？');
    expect(container.textContent).toContain('生物');
    expect(container.textContent).toContain('生物学');
  });

  it('extracts cloze review cards from a piwin_toolbox batch-create payload', () => {
    const output = JSON.stringify({
      created: [
        {
          id: 'card-f3dc5a95-msy8lzjt',
          model: 'cloze',
          deck: 'default',
          text: '线粒体是{{c1::细胞}}的{{c2::能量工厂}}。',
          createdAt: '2026-08-18T05:43:48.281Z',
        },
      ],
      skipped: [],
    });
    const toolMessage: ChatMessageUi = {
      id: 'tool-msg',
      role: 'assistant',
      text: '',
      thinking: 'creating',
      tools: [
        {
          toolCallId: 'tc-batch',
          toolName: 'piwin_toolbox',
          status: 'done',
          output,
          presentation: {
            kind: 'other',
            title: 'flashcard_batch_create',
            routedToolName: 'flashcard_batch_create',
            output: { text: output, truncated: false },
          },
        },
      ],
      attachments: [],
      status: 'done',
    };
    const summaryMessage: ChatMessageUi = {
      id: 'summary-msg',
      role: 'assistant',
      text: '已用一次 flashcard_batch_create 创建挖空闪卡',
      thinking: '',
      tools: [],
      attachments: [],
      status: 'done',
    };

    const cards = extractFlashcardRecords(toolMessage);
    expect(cards).toHaveLength(1);
    expect(cards[0]?.ordinal).toBe(0);
    expect(cards[0]?.front).toBe('线粒体是[…]的[…]。');

    const hoisted = collectFlashcardToolsFromMessages([toolMessage, summaryMessage]);
    expect(hoisted).toHaveLength(1);
    const visible: ChatMessageUi & { originalTools?: typeof hoisted } = {
      ...summaryMessage,
      originalTools: hoisted,
    };
    const { container } = renderContent(
      <ConversationResponseContent
        message={visible}
        messageIndex={0}
        showStreamingCaret={false}
        activeTheme={null}
        artifactThemeKey="default"
        runRecordsById={{}}
        activeRunId={null}
        locale="zh-CN"
        artifactPreviewEnabled={true}
      />,
    );
    expect(
      container.querySelector('[data-testid="conversation-extracted-flashcard"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain('线粒体是');
    expect(container.textContent).toContain('[…]');
  });

  it('loads flip cards from a summary card id when tool output is gone', async () => {
    const cards = [
      {
        cardId: 'card-f3dc5a95-msy8lzjt:c1',
        itemId: 'card-f3dc5a95-msy8lzjt',
        model: 'cloze' as const,
        ordinal: 1,
        deck: 'default',
        front: '线粒体是[…]的能量工厂。',
        back: '线粒体是**细胞**的能量工厂。',
        createdAt: '2026-08-18T05:43:48.281Z',
      },
    ];
    const { container } = renderContent(
      <ConversationResponseContent
        message={{
          id: 'summary-only',
          role: 'assistant',
          text: '卡片 ID： card-f3dc5a95-msy8lzjt',
          thinking: '',
          tools: [],
          attachments: [],
          status: 'done',
        }}
        messageIndex={0}
        showStreamingCaret={false}
        activeTheme={null}
        artifactThemeKey="default"
        runRecordsById={{}}
        activeRunId={null}
        locale="zh-CN"
        artifactPreviewEnabled={true}
        onResolveFlashcards={async () => cards}
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      container.querySelector('[data-testid="conversation-extracted-flashcard"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain('线粒体是[…]的能量工厂。');
  });

  it('shows the existing physical card when batch-create skipped a duplicate', () => {
    const output = JSON.stringify({
      created: [],
      skipped: [
        {
          front: '线粒体是细胞的能量工厂。',
          reason: 'duplicate',
          existing: {
            id: 'card-f3dc5a95-msy8lzjt',
            model: 'cloze',
            deck: 'default',
            text: '线粒体是{{c1::细胞}}的{{c2::能量工厂}}。',
            createdAt: '2026-08-18T05:43:48.281Z',
          },
        },
      ],
    });
    const cards = extractFlashcardRecords({
      id: 'dup-msg',
      role: 'assistant',
      text: '该卡片因重复被跳过',
      thinking: '',
      tools: [
        {
          toolCallId: 'tc-dup',
          toolName: 'piwin_toolbox',
          status: 'done',
          output,
          presentation: {
            kind: 'other',
            title: 'flashcard_batch_create',
            routedToolName: 'flashcard_batch_create',
            output: { text: output, truncated: false },
          },
        },
      ],
      attachments: [],
      status: 'done',
    });
    expect(cards).toHaveLength(1);
    expect(cards[0]?.front).toBe('线粒体是[…]的[…]。');
  });

  it('falls back to batch-create args when output only says duplicate', () => {
    const cards = extractFlashcardRecords({
      id: 'dup-args',
      role: 'assistant',
      text: '该卡片因重复被跳过',
      thinking: '',
      tools: [
        {
          toolCallId: 'tc-args',
          toolName: 'piwin_toolbox',
          status: 'done',
          output: JSON.stringify({
            created: [],
            skipped: [{ front: '线粒体是细胞的能量工厂。', reason: 'duplicate' }],
          }),
          presentation: {
            kind: 'other',
            title: 'flashcard_batch_create',
            routedToolName: 'flashcard_batch_create',
            output: {
              text: JSON.stringify({
                created: [],
                skipped: [{ front: '线粒体是细胞的能量工厂。', reason: 'duplicate' }],
              }),
              truncated: false,
            },
          },
          args: {
            cards: [
              {
                model: 'cloze',
                text: '线粒体是{{c1::细胞}}的{{c2::能量工厂}}。',
              },
            ],
          },
        } as ChatMessageUi['tools'][number] & { args: unknown },
      ],
      attachments: [],
      status: 'done',
    });
    expect(cards).toHaveLength(1);
    expect(cards[0]?.front).toBe('线粒体是[…]的[…]。');
  });

  it('recovers a cloze flip card from the reply text after a duplicate skip', () => {
    const cards = extractFlashcardRecords({
      id: 'dup-text',
      role: 'assistant',
      text: '该卡片因重复被跳过。目标挖空格式如下：\n线粒体是{{c1::细胞}}的{{c2::能量工厂}}。',
      thinking: '',
      tools: [
        {
          toolCallId: 'tc-text',
          toolName: 'piwin_toolbox',
          status: 'done',
          output: JSON.stringify({
            created: [],
            skipped: [{ front: '线粒体是细胞的能量工厂。', reason: 'duplicate' }],
          }),
          presentation: {
            kind: 'other',
            title: 'flashcard_batch_create',
            routedToolName: 'flashcard_batch_create',
          },
        },
      ],
      attachments: [],
      status: 'done',
    });
    expect(cards).toHaveLength(1);
    expect(cards[0]?.front).toBe('线粒体是[…]的[…]。');
  });

  it('prefers presentation.flashcard over leftover artifactHtml', () => {
    const cards = extractFlashcardRecords({
      id: 'pres',
      role: 'assistant',
      text: '',
      thinking: '',
      tools: [
        {
          toolCallId: 'tc-pres',
          toolName: 'flashcard_create',
          status: 'done',
          output: JSON.stringify({
            artifactHtml: '<div class="piwin-flashcard" data-card-id="spoof">nope</div>',
          }),
          presentation: {
            kind: 'other',
            title: 'flashcard_create',
            routedToolName: 'flashcard_create',
            flashcard: {
              cards: [
                {
                  cardId: 'card-trusted',
                  itemId: 'card-trusted',
                  model: 'basic',
                  ordinal: 1,
                  deck: 'default',
                  front: 'Trusted front',
                  back: 'Trusted back',
                  createdAt: '2026-08-24T00:00:00.000Z',
                },
              ],
            },
          },
        },
      ],
      attachments: [],
      status: 'done',
    });
    expect(cards).toHaveLength(1);
    expect(cards[0]?.cardId).toBe('card-trusted');
    expect(cards[0]?.front).toBe('Trusted front');
  });

  it('renders one structured card when leftover HTML with data-card-id is in the reply', () => {
    const message: ChatMessageUi = {
      id: 'm-html',
      role: 'assistant',
      text: '```html\n<div class="piwin-flashcard" data-card-id="card-photo"></div>\n```\nAfter artifact',
      thinking: '',
      tools: [
        {
          toolCallId: 'tc-html',
          toolName: 'flashcard_create',
          status: 'done',
          output: JSON.stringify({
            card: { id: 'card-photo', front: '什么是光合作用？', back: '光能转化' },
            display: {
              cards: [
                {
                  cardId: 'card-photo',
                  itemId: 'card-photo',
                  model: 'basic',
                  ordinal: 1,
                  deck: 'default',
                  front: '什么是光合作用？',
                  back: '光能转化',
                  createdAt: '2026-08-24T00:00:00.000Z',
                },
              ],
            },
          }),
        },
      ],
      attachments: [],
      status: 'done',
    };
    const { container } = renderContent(
      <ConversationResponseContent
        message={message}
        messageIndex={0}
        showStreamingCaret={false}
        activeTheme={null}
        artifactThemeKey="default"
        runRecordsById={{}}
        activeRunId={null}
        locale="zh-CN"
        artifactPreviewEnabled={true}
      />,
    );
    expect(
      container.querySelectorAll('[data-testid="conversation-extracted-flashcard"]'),
    ).toHaveLength(1);
    expect(container.querySelectorAll('[data-testid="chat-flashcard"]')).toHaveLength(1);
    expect(container.querySelector('[data-testid="flashcard-preview-card"]')).toBeNull();
  });

  it('does not project leftover artifactHtml as a flashcard UI', () => {
    const message: ChatMessageUi = {
      id: 'm-html-only',
      role: 'assistant',
      text: 'done',
      thinking: '',
      tools: [
        {
          toolCallId: 'tc-html-only',
          toolName: 'flashcard_create',
          status: 'done',
          output: JSON.stringify({
            artifactHtml: '<div class="piwin-flashcard" data-card-id="card-123">Card content</div>',
          }),
        },
      ],
      attachments: [],
      status: 'done',
    };
    expect(extractFlashcardRecords(message)).toEqual([]);
    const { container } = renderContent(
      <ConversationResponseContent
        message={message}
        messageIndex={0}
        showStreamingCaret={false}
        activeTheme={null}
        artifactThemeKey="default"
        runRecordsById={{}}
        activeRunId={null}
        locale="zh-CN"
        artifactPreviewEnabled={true}
      />,
    );
    expect(container.querySelector('[data-testid="conversation-extracted-flashcard"]')).toBeNull();
    expect(container.querySelector('[data-testid="chat-flashcard"]')).toBeNull();
  });

  it('omits the identity header for a continuation completion', () => {
    const message: ChatMessageUi = {
      id: 'm-cont',
      role: 'assistant',
      text: 'Here is the result.',
      thinking: '',
      tools: [],
      attachments: [],
      status: 'done',
      model: {
        protocol: 'openai-compatible',
        providerId: 'cpa',
        modelId: 'glm5.2',
      },
    };
    const { container } = renderContent(
      <ConversationResponseContent
        message={message}
        messageIndex={1}
        showStreamingCaret={false}
        activeTheme={null}
        artifactThemeKey="default"
        runRecordsById={{}}
        activeRunId={null}
        locale="zh-CN"
        artifactPreviewEnabled={true}
        showHeader={false}
      />,
    );
    expect(container.querySelector('[data-testid="conversation-message-header"]')).toBeNull();
    expect(
      container
        .querySelector('[data-testid="conversation-response"]')
        ?.classList.contains('is-continuation'),
    ).toBe(true);
    expect(container.textContent).toContain('Here is the result.');
  });

  it('does not follow a later composer model on a completed reply without a snapshot', () => {
    const message: ChatMessageUi = {
      id: 'm-done-avatar',
      role: 'assistant',
      text: 'Hello after streaming.',
      thinking: '',
      tools: [],
      attachments: [],
      status: 'done',
    };
    const { container } = renderContent(
      <ConversationResponseContent
        message={message}
        messageIndex={0}
        showStreamingCaret={false}
        activeTheme={null}
        artifactThemeKey="default"
        runRecordsById={{}}
        activeRunId={null}
        locale="zh-CN"
        artifactPreviewEnabled={true}
        isStreaming={false}
        isLatestAssistantResponse
        livePromptModel={{
          protocol: 'openai-compatible',
          providerId: 'custom-openai',
          modelId: 'win/glm5.2',
        }}
      />,
    );
    expect(container.querySelector('[data-testid="conversation-message-model-name"]')).toBeNull();
    expect(container.querySelector('.conversation-message-provider-icon')).toBeNull();
  });

  it('keeps the snapshot model when the composer later selects a different model', () => {
    const message: ChatMessageUi = {
      id: 'm-done-snapshot',
      role: 'assistant',
      text: 'Hello after streaming.',
      thinking: '',
      tools: [],
      attachments: [],
      status: 'done',
      model: {
        protocol: 'openai-compatible',
        providerId: 'chatgpt-codex',
        modelId: 'gpt-5.3-codex-spark',
      },
    };
    const { container } = renderContent(
      <ConversationResponseContent
        message={message}
        messageIndex={0}
        showStreamingCaret={false}
        activeTheme={null}
        artifactThemeKey="default"
        runRecordsById={{}}
        activeRunId={null}
        locale="zh-CN"
        artifactPreviewEnabled={true}
        isStreaming={false}
        isLatestAssistantResponse
        livePromptModel={{
          protocol: 'openai-compatible',
          providerId: 'xgrok',
          modelId: 'grok-4',
        }}
      />,
    );
    expect(
      container.querySelector('[data-testid="conversation-message-model-name"]')?.textContent,
    ).toContain('gpt-5.3-codex-spark');
    expect(
      container.querySelector('[data-testid="conversation-message-model-name"]')?.textContent,
    ).not.toContain('grok-4');
  });

  it('keeps the provider avatar on a live streaming row via the live run flag', () => {
    const message: ChatMessageUi = {
      id: 'm-live-avatar',
      role: 'assistant',
      text: '',
      thinking: '',
      tools: [],
      attachments: [],
      status: 'streaming',
    };
    const { container } = renderContent(
      <ConversationResponseContent
        message={message}
        messageIndex={0}
        showStreamingCaret={false}
        activeTheme={null}
        artifactThemeKey="default"
        runRecordsById={{}}
        activeRunId="run-1"
        locale="zh-CN"
        artifactPreviewEnabled={true}
        isStreaming
        livePromptModel={{
          protocol: 'openai-compatible',
          providerId: 'custom-openai',
          modelId: 'win/glm5.2',
        }}
      />,
    );
    expect(container.querySelector('.conversation-message-provider-icon')).not.toBeNull();
    expect(
      container.querySelector('[data-testid="conversation-message-model-name"]')?.textContent,
    ).toContain('glm5.2');
  });

  it('materializes conversation artifact-html after leading prose', async () => {
    const message: ChatMessageUi = {
      id: 'm-pelican',
      role: 'assistant',
      text: [
        '这是一个用纯 SVG + CSS 动画与交互打造的 “海滨骑行鹈鹕” 2D 矢量动画页面。',
        '',
        '```artifact-html',
        '<!DOCTYPE html>',
        '<html lang="zh-CN"><body><h1>Pelican</h1></body></html>',
        '```',
      ].join('\n'),
      thinking: '已思考',
      tools: [],
      attachments: [],
      status: 'done',
      runId: 'run-1',
    };
    const { container } = renderContent(
      <ConversationResponseContent
        message={message}
        sessionId="session-1"
        messageIndex={0}
        showStreamingCaret={false}
        activeTheme={null}
        artifactThemeKey="default"
        runRecordsById={{}}
        activeRunId="run-1"
        locale="zh-CN"
        artifactPreviewEnabled
      />,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.querySelector('.artifact-frame')).not.toBeNull();
    expect(container.querySelector('[data-testid="code-fence-source"]')).toBeNull();
    expect(container.querySelector('[data-testid="code-fence-streaming"]')).toBeNull();
  });

  it('folds a closed Canvas fence to the launcher when the run id is still live', async () => {
    const message: ChatMessageUi = {
      id: 'm-pelican-canvas',
      role: 'assistant',
      text: [
        '```artifact-html title="2D 鹈鹕骑自行车动画 (Pelican on a Bicycle)" surface="canvas"',
        '<!DOCTYPE html>',
        '<html lang="zh-CN"><body><main>骑行</main></body></html>',
        '```',
      ].join('\n'),
      thinking: '已思考',
      tools: [],
      attachments: [],
      status: 'done',
      runId: 'run-1',
    };
    const { container } = renderContent(
      <ConversationResponseContent
        message={message}
        sessionId="session-mtpu6ibz-doig3ng2"
        messageIndex={0}
        showStreamingCaret={false}
        activeTheme={null}
        artifactThemeKey="default"
        runRecordsById={{}}
        activeRunId="run-1"
        locale="zh-CN"
        artifactPreviewEnabled
        onOpenArtifactCanvas={() => {}}
      />,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.querySelector('[data-testid="artifact-canvas-launcher"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="artifact-canvas-download-source"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="code-fence-streaming"]')).toBeNull();
    expect(container.querySelector('.artifact-frame')).toBeNull();
  });

  it('keeps completed Canvas fences as a transcript launcher, not an inline frame', async () => {
    const message: ChatMessageUi = {
      id: 'm-canvas',
      role: 'assistant',
      text: '```artifact-html title="Wide workspace" surface="canvas"\n<div>Wide</div>\n```',
      thinking: '',
      tools: [],
      attachments: [],
      status: 'done',
    };
    const { container } = renderContent(
      <ConversationResponseContent
        message={message}
        sessionId="session-1"
        messageIndex={0}
        showStreamingCaret={false}
        activeTheme={null}
        artifactThemeKey="default"
        runRecordsById={{}}
        activeRunId={null}
        locale="zh-CN"
        artifactPreviewEnabled
        onOpenArtifactCanvas={() => {}}
      />,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.querySelector('[data-testid="artifact-canvas-launcher"]')).not.toBeNull();
    expect(container.querySelector('.artifact-frame')).toBeNull();
  });

  it('forwards the code-first preference to conversation Markdown', () => {
    const message: ChatMessageUi = {
      id: 'm-code-first',
      role: 'assistant',
      text: '```artifact-html\n<section><h2>UI</h2></section>\n```',
      thinking: '',
      tools: [],
      attachments: [],
      status: 'done',
    };
    const { container } = renderContent(
      <ConversationResponseContent
        message={message}
        messageIndex={0}
        showStreamingCaret={false}
        activeTheme={null}
        artifactThemeKey="default"
        runRecordsById={{}}
        activeRunId={null}
        locale="zh-CN"
        artifactPreviewEnabled
        artifactCodeFirst
      />,
    );

    expect(container.querySelector('[data-testid="code-fence-source"]')).not.toBeNull();
    expect(container.querySelector('.artifact-frame')).toBeNull();
  });

  it('renders generation progress and assistant media in the conversation pane path', () => {
    const message: ChatMessageUi = {
      id: 'm-image-live',
      role: 'assistant',
      text: '正在生成图片。',
      thinking: '',
      tools: [
        {
          toolCallId: 'image-call',
          toolName: 'piwin_toolbox',
          status: 'running',
          output: '',
          presentation: { kind: 'image', title: 'image_gen' },
        },
      ],
      attachments: [
        {
          id: 'image-result',
          kind: 'media',
          mimeType: 'image/png',
          path: '/tmp/piwin/media/session-1/image-result.png',
          byteSize: 1024,
          source: 'generated',
        },
      ],
      status: 'streaming',
    };

    const { container } = renderContent(
      <ConversationResponseContent
        message={message}
        messageIndex={0}
        showStreamingCaret={false}
        activeTheme={null}
        artifactThemeKey="default"
        runRecordsById={{}}
        activeRunId="run-image"
        locale="zh-CN"
        isStreaming
        artifactPreviewEnabled
        renderMediaChrome
      />,
    );

    expect(container.querySelector('[data-testid="image-generation-progress"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="message-attachments"]')).not.toBeNull();
  });
});
