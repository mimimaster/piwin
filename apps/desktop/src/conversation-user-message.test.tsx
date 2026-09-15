// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ChatMessageUi } from './chat-reducer';
import { formatTurnExactStamp, formatTurnRelativeAge } from './chat-turn-marginalia.js';
import { UserMessageContent } from './conversation-user-message.js';

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
