// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import type { ChatMessageUi } from './chat-reducer';
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

    const frame = container.querySelector('.fc-quiet-frame');
    expect(frame).not.toBeNull();
    expect(container.textContent).toContain('什么是光合作用？');
    expect(container.textContent).not.toContain('光能转化为化学能');

    // Click to reveal answer
    act(() => {
      frame?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.textContent).toContain('光能转化为化学能');
    expect(container.querySelector('.chat-flashcard-rate-section')).not.toBeNull();

    // Click '记住了' (good) rating
    const goodBtn = container.querySelector('.fc-quiet-rate-btn.btn-good');
    expect(goodBtn).not.toBeNull();
    act(() => {
      goodBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.textContent).toContain('已记录：记住了');
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
    expect(container.textContent).toContain('#生物学');
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
});
