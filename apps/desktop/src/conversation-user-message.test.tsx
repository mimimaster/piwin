// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ChatMessageUi } from './chat-reducer';
import { formatTurnExactStamp, formatTurnRelativeAge } from './chat-turn-marginalia.js';
import { USER_MESSAGE_COLLAPSE_THRESHOLD, UserMessageContent } from './conversation-user-message.js';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const message: ChatMessageUi = {
  id: 'u1',
  role: 'user',
  text: 'look at this',
  thinking: '',
  tools: [],
  attachments: [],
  status: 'done',
  contextRefs: [
    {
      kind: 'selection',
      snapshotText: 'visible title',
      label: 'visible title',
    },
  ],
};

describe('UserMessageContent context chips', () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    container?.remove();
    root = null;
    container = null;
  });

  function render(node: ReactElement): void {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const next = createRoot(host);
    act(() => {
      next.render(node);
    });
    root = next;
    container = host;
  }

  it('renders the selection capsule as a proto @ att under the text in Conversation mode', () => {
    render(
      <UserMessageContent message={message} onRetry={vi.fn()} locale="zh-CN" isConversationSession={true} />,
    );
    const chips = container?.querySelector('[data-testid="message-context-refs"]');
    const att = container?.querySelector('[data-testid="transcript-att-chip"]');
    const quoteBox = container?.querySelector('[data-testid="user-message-quote-box"]');
    const bubble = container?.querySelector('[data-testid="user-message-collapsible-body"]');
    expect(chips).not.toBeNull();
    expect(att?.getAttribute('data-att-variant')).toBe('mention');
    expect(att?.textContent).toContain('@ visible title');
    expect(quoteBox).toBeNull();
    expect(bubble?.contains(chips as Node)).toBe(true);
    expect(bubble?.textContent).toContain('look at this');
  });

  it('renders context chips as proto atts in Agent mode', () => {
    render(
      <UserMessageContent message={message} onRetry={vi.fn()} locale="zh-CN" isConversationSession={false} />,
    );
    const chips = container?.querySelector('[data-testid="message-context-refs"]');
    const att = container?.querySelector('[data-testid="transcript-att-chip"]');
    const quoteBox = container?.querySelector('[data-testid="user-message-quote-box"]');
    const bubble = container?.querySelector('[data-testid="user-message-collapsible-body"]');
    expect(chips).not.toBeNull();
    expect(att?.getAttribute('data-att-variant')).toBe('mention');
    expect(att?.textContent).toContain('@ visible title');
    expect(quoteBox).toBeNull();
    expect(bubble?.textContent).toContain('look at this');
  });

  it('does not render avatar in Agent mode', () => {
    render(
      <UserMessageContent message={message} onRetry={vi.fn()} locale="zh-CN" isConversationSession={false} />,
    );
    const avatar = container?.querySelector('[data-testid="user-message-avatar"]');
    const wrapper = container?.querySelector('.user-message-wrapper');
    expect(avatar).toBeNull();
    expect(wrapper?.classList.contains('is-conversation')).toBe(false);
  });

  it('renders user avatar in Conversation mode', () => {
    render(
      <UserMessageContent message={message} onRetry={vi.fn()} locale="zh-CN" isConversationSession={true} />,
    );
    const avatar = container?.querySelector('[data-testid="user-message-avatar"]');
    const wrapper = container?.querySelector('.user-message-wrapper');
    expect(avatar).not.toBeNull();
    expect(avatar?.textContent).toBe('我');
    expect(wrapper?.classList.contains('is-conversation')).toBe(true);
  });

  it('keeps copy, edit, and time in the conversation hover chip without a dedicated in-flow row', () => {
    const timed: ChatMessageUi = {
      ...message,
      createdAt: '2026-08-22T10:26:00.000Z',
    };
    render(
      <UserMessageContent message={timed} onRetry={vi.fn()} locale="zh-CN" isConversationSession={true} />,
    );
    const bubble = container?.querySelector('[data-testid="user-message-collapsible-body"]');
    const footer = container?.querySelector('[data-testid="user-message-actions"]');
    expect(bubble).not.toBeNull();
    expect(footer).not.toBeNull();
    expect(bubble?.contains(footer as Node)).toBe(true);
    const time = footer?.querySelector('[data-testid="user-message-time"]');
    const copy = footer?.querySelector('[data-testid="message-copy-btn"]');
    expect(time).not.toBeNull();
    expect(time?.textContent).toBe(formatTurnRelativeAge(timed.createdAt ?? ''));
    expect(time?.getAttribute('title')).toBe(formatTurnExactStamp(timed.createdAt ?? '', 'zh-CN'));
    expect(copy).not.toBeNull();
    expect(footer?.querySelector('[data-testid="message-edit-btn"]')).not.toBeNull();
    const children = [...(footer?.children ?? [])];
    expect(children.indexOf(time as Element)).toBeLessThan(children.indexOf(copy?.parentElement as Element));
  });

  it('puts abbreviated age in the agent hover action row with copy and edit', () => {
    const timed: ChatMessageUi = {
      ...message,
      createdAt: '2026-08-22T10:26:00.000Z',
    };
    render(
      <UserMessageContent message={timed} onRetry={vi.fn()} locale="zh-CN" isConversationSession={false} />,
    );
    const actions = container?.querySelector('[data-testid="user-message-actions"]');
    const time = actions?.querySelector('[data-testid="user-message-time"]');
    const copy = actions?.querySelector('[data-testid="message-copy-btn"]');
    expect(time).not.toBeNull();
    expect(copy).not.toBeNull();
    expect(time?.textContent).toBe(formatTurnRelativeAge(timed.createdAt ?? ''));
    expect(time?.getAttribute('title')).toBe(formatTurnExactStamp(timed.createdAt ?? '', 'zh-CN'));
    const children = [...(actions?.children ?? [])];
    expect(children.indexOf(time as Element)).toBeLessThan(children.indexOf(copy as Element));
  });

  it('puts the proto fork foot under the paper card, not inside the bubble', () => {
    render(
      <UserMessageContent
        message={message}
        onRetry={vi.fn()}
        locale="zh-CN"
        isConversationSession={true}
        branchSwitcher={<span data-testid="message-branch-switcher">‹ 2 / 3 ›</span>}
      />,
    );
    const foot = container?.querySelector('[data-testid="user-message-fork-foot"]');
    const bubble = container?.querySelector('[data-testid="user-message-collapsible-body"]');
    expect(foot).not.toBeNull();
    expect(foot?.classList.contains('ufoot')).toBe(true);
    expect(foot?.textContent).toContain('分叉的提问');
    expect(foot?.textContent).toContain('‹ 2 / 3 ›');
    expect(bubble?.contains(foot as Node)).toBe(false);
  });

  it('renders a voice handover as a task card instead of a typed bubble', () => {
    render(
      <UserMessageContent
        message={{ ...message, source: 'voice-delegation', voiceCallId: 'live_1', text: '搜索近期资料' }}
        onRetry={vi.fn()}
        locale="zh-CN"
        isConversationSession={true}
      />,
    );
    expect(container?.querySelector('[data-testid="voice-handover-card"]')).not.toBeNull();
    expect(container?.querySelector('[data-testid="user-message-voice-delegation"]')?.textContent).toBe(
      '语音委派',
    );
    expect(container?.querySelector('.voice-handover-card-brief')?.textContent).toBe('搜索近期资料');
    expect(container?.querySelector('[data-testid="user-message-avatar"]')).toBeNull();
  });

  it('renders slash message with gradient ribbon and command header in Conversation mode', () => {
    const slashMsg: ChatMessageUi = {
      ...message,
      id: 'u-slash-1',
      text: '/RuiC-card-skill 在重新生成',
    };
    render(
      <UserMessageContent
        message={slashMsg}
        onRetry={vi.fn()}
        locale="zh-CN"
        isConversationSession={true}
      />,
    );
    const containerEl = container?.querySelector('[data-testid="user-message-slash-container"]');
    const ribbon = container?.querySelector('[data-testid="user-message-slash-ribbon"]');
    const header = container?.querySelector('[data-testid="user-message-slash-header"]');
    const content = container?.querySelector('[data-testid="user-message-slash-content"]');

    expect(containerEl).not.toBeNull();
    expect(ribbon).not.toBeNull();
    expect(header?.textContent).toBe('/RuiC-card-skill');
    expect(content?.textContent).toBe('在重新生成');
  });

  it('renders slash message with gradient ribbon and command header in Agent mode', () => {
    const goalMsg: ChatMessageUi = {
      ...message,
      id: 'u-slash-2',
      text: '/goal 把所有超时测试修好',
    };
    render(
      <UserMessageContent
        message={goalMsg}
        onRetry={vi.fn()}
        locale="zh-CN"
        isConversationSession={false}
      />,
    );
    const containerEl = container?.querySelector('[data-testid="user-message-slash-container"]');
    const ribbon = container?.querySelector('[data-testid="user-message-slash-ribbon"]');
    const header = container?.querySelector('[data-testid="user-message-slash-header"]');
    const content = container?.querySelector('[data-testid="user-message-slash-content"]');

    expect(containerEl).not.toBeNull();
    expect(ribbon).not.toBeNull();
    expect(header?.textContent).toBe('/goal');
    expect(content?.textContent).toBe('把所有超时测试修好');
  });

  it('renders bare slash command without trailing empty content in Conversation mode', () => {
    const compactMsg: ChatMessageUi = {
      ...message,
      id: 'u-slash-3',
      text: '/compact',
    };
    render(
      <UserMessageContent
        message={compactMsg}
        onRetry={vi.fn()}
        locale="zh-CN"
        isConversationSession={true}
      />,
    );
    const header = container?.querySelector('[data-testid="user-message-slash-header"]');
    const content = container?.querySelector('[data-testid="user-message-slash-content"]');

    expect(header?.textContent).toBe('/compact');
    expect(content).toBeNull();
  });
});

describe('UserMessageContent collapse', () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;
  let scrollHeightSpy: ReturnType<typeof vi.spyOn> | undefined;

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    container?.remove();
    root = null;
    container = null;
    scrollHeightSpy?.mockRestore();
    scrollHeightSpy = undefined;
  });

  function render(node: ReactElement): void {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const next = createRoot(host);
    act(() => {
      next.render(node);
    });
    root = next;
    container = host;
  }

  it('collapses overflowing Conversation prompts by default and expands on click', () => {
    scrollHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockReturnValue(USER_MESSAGE_COLLAPSE_THRESHOLD + 40);
    render(
      <UserMessageContent
        message={{ ...message, text: '宣纸以青檀树皮与沙田稻草为主要原料。'.repeat(12) }}
        onRetry={vi.fn()}
        locale="zh-CN"
        isConversationSession={true}
      />,
    );
    const bubble = container?.querySelector('[data-testid="user-message-collapsible-body"]');
    expect(bubble?.classList.contains('is-collapsed')).toBe(true);
    expect(bubble?.classList.contains('is-clickable')).toBe(true);
    expect(bubble?.getAttribute('aria-expanded')).toBe('false');

    act(() => {
      (bubble as HTMLElement | null)?.click();
    });

    expect(bubble?.classList.contains('is-expanded')).toBe(true);
    expect(bubble?.classList.contains('is-collapsed')).toBe(false);
    expect(bubble?.getAttribute('aria-expanded')).toBe('true');
  });

  it('leaves short Conversation prompts expanded and not clickable', () => {
    scrollHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockReturnValue(USER_MESSAGE_COLLAPSE_THRESHOLD - 20);
    render(
      <UserMessageContent
        message={{ ...message, text: '短提问' }}
        onRetry={vi.fn()}
        locale="zh-CN"
        isConversationSession={true}
      />,
    );
    const bubble = container?.querySelector('[data-testid="user-message-collapsible-body"]');
    expect(bubble?.classList.contains('is-expanded')).toBe(true);
    expect(bubble?.classList.contains('is-clickable')).toBe(false);
    expect(bubble?.getAttribute('role')).toBeNull();
  });

  it('collapses Conversation image attachments with the prompt body by default', () => {
    render(
      <UserMessageContent
        message={{
          ...message,
          text: '看这张图',
          attachments: [
            {
              id: 'attachment-image',
              kind: 'media',
              path: '/tmp/history-image.png',
              mimeType: 'image/png',
              byteSize: 1024,
              source: 'paste',
            },
          ],
        }}
        onRetry={vi.fn()}
        locale="zh-CN"
        isConversationSession={true}
      />,
    );
    const bubble = container?.querySelector('[data-testid="user-message-collapsible-body"]');
    expect(bubble?.classList.contains('is-collapsed')).toBe(true);
    expect(bubble?.classList.contains('has-attachments')).toBe(true);
  });

  it('expands a collapsed card when an image preview opens, and folds the preview with the card', async () => {
    render(
      <UserMessageContent
        message={{
          ...message,
          text: '看这张图',
          contextRefs: [],
          attachments: [
            {
              id: 'attachment-image',
              kind: 'media',
              path: '/tmp/history-image.png',
              mimeType: 'image/png',
              byteSize: 1024,
              source: 'paste',
            },
          ],
        }}
        onRetry={vi.fn()}
        locale="zh-CN"
        isConversationSession={true}
      />,
    );
    const bubble = container?.querySelector<HTMLElement>('[data-testid="user-message-collapsible-body"]');
    const chip = container?.querySelector<HTMLButtonElement>('button[data-testid="transcript-att-chip"]');
    const slot = container?.querySelector('[data-testid="att-image-preview-slot"]');
    expect(bubble?.classList.contains('is-collapsed')).toBe(true);

    // Opening mounts MediaPreview, which reads the image asynchronously.
    await act(async () => {
      chip?.click();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(bubble?.classList.contains('is-expanded')).toBe(true);
    expect(slot?.getAttribute('data-open')).toBe('true');
    expect(chip?.getAttribute('aria-expanded')).toBe('true');

    act(() => {
      bubble?.click();
    });
    expect(bubble?.classList.contains('is-collapsed')).toBe(true);
    expect(slot?.getAttribute('data-open')).toBe('false');
    expect(chip?.getAttribute('aria-expanded')).toBe('false');
  });

  it('pins collapsed overflow to the start of a long Conversation prompt', () => {
    scrollHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockReturnValue(USER_MESSAGE_COLLAPSE_THRESHOLD + 40);
    render(
      <UserMessageContent
        message={{ ...message, text: '宣纸以青檀树皮与沙田稻草为主要原料。'.repeat(12) }}
        onRetry={vi.fn()}
        locale="zh-CN"
        isConversationSession={true}
      />,
    );
    const bubble = container?.querySelector<HTMLElement>('[data-testid="user-message-collapsible-body"]');
    const text = container?.querySelector<HTMLElement>('.user-message-text');
    expect(bubble).not.toBeNull();

    act(() => {
      bubble?.click();
    });
    expect(bubble?.classList.contains('is-expanded')).toBe(true);

    if (bubble) bubble.scrollTop = 160;
    if (text) text.scrollTop = 160;

    act(() => {
      bubble?.click();
    });

    expect(bubble?.classList.contains('is-collapsed')).toBe(true);
    expect(bubble?.scrollTop).toBe(0);
    expect(text?.scrollTop).toBe(0);
  });

  it('keeps copy/edit on the same row for a short single-line Conversation prompt', () => {
    scrollHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockReturnValue(24);
    render(
      <UserMessageContent
        message={{ ...message, text: '短提问', contextRefs: [], attachments: [] }}
        onRetry={vi.fn()}
        locale="zh-CN"
        isConversationSession={true}
      />,
    );
    const bubble = container?.querySelector('[data-testid="user-message-collapsible-body"]');
    expect(bubble?.classList.contains('is-single-line')).toBe(true);
    expect(bubble?.classList.contains('is-multiline')).toBe(false);
  });

  it('pins copy/edit to the bottom-right on multiline Conversation prompts, including after expand', () => {
    scrollHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockReturnValue(USER_MESSAGE_COLLAPSE_THRESHOLD + 40);
    render(
      <UserMessageContent
        message={{
          ...message,
          text: '第一行\n第二行\n第三行',
          contextRefs: [],
          attachments: [],
        }}
        onRetry={vi.fn()}
        locale="zh-CN"
        isConversationSession={true}
      />,
    );
    const bubble = container?.querySelector('[data-testid="user-message-collapsible-body"]');
    expect(bubble?.classList.contains('is-multiline')).toBe(true);
    expect(bubble?.classList.contains('is-collapsed')).toBe(true);

    act(() => {
      (bubble as HTMLElement | null)?.click();
    });

    expect(bubble?.classList.contains('is-expanded')).toBe(true);
    expect(bubble?.classList.contains('is-multiline')).toBe(true);
  });

  it('re-observes the mounted card after switching between Agent and Conversation layouts', () => {
    const observed: Element[] = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(target: Element): void {
          observed.push(target);
        }
        disconnect(): void {}
        unobserve(): void {}
      },
    );
    try {
      const props = {
        message: { ...message, text: '第一行\n第二行', contextRefs: [], attachments: [] },
        onRetry: vi.fn(),
        locale: 'zh-CN' as const,
      };
      render(<UserMessageContent {...props} isConversationSession={false} />);
      act(() => {
        root?.render(<UserMessageContent {...props} isConversationSession={true} />);
      });
      const bubble = container?.querySelector('[data-testid="user-message-collapsible-body"]');
      expect(bubble?.classList.contains('user-message-bubble')).toBe(true);
      expect(observed).toContain(bubble);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
