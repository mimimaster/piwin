// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import type { ChatMessageUi } from './chat-reducer';
import {
  ConversationResponseContent,
  collectFlashcardToolsFromMessages,
  extractFlashcardArtifactHtml,
  extractFlashcardRecords,
  messageHasFlashcardToolResult,
} from './conversation-response-content';

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

  it('extracts artifactHtml from flashcard tool output JSON', () => {
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
            artifactHtml: '<div class="piwin-flashcard" data-card-id="card-123">Card content</div>',
          }),
        },
      ],
      attachments: [],
      status: 'done',
    };

    expect(messageHasFlashcardToolResult(message)).toBe(true);
    const html = extractFlashcardArtifactHtml(message);
    expect(html).toContain('data-card-id="card-123"');
    expect(html).toContain('Q');
    expect(html).toContain('A');
    expect(html).toContain('fc-card-frame');
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
            artifactHtml: '<div class="piwin-flashcard" data-card-id="card-photo"><h1>光合作用</h1></div>',
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
      artifactHtml: '<div class="piwin-flashcard" data-card-id="card-f3dc5a95-msy8lzjt:c1"></div>',
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
    expect(cards).toHaveLength(2);
    expect(cards[0]?.front).toContain('[…]');
    expect(cards[1]?.front).toContain('[…]');

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
    expect(container.querySelector('[data-testid="conversation-extracted-flashcard"]')).not.toBeNull();
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
    expect(container.querySelector('[data-testid="conversation-extracted-flashcard"]')).not.toBeNull();
    expect(container.textContent).toContain('线粒体是[…]的能量工厂。');
  });
});
