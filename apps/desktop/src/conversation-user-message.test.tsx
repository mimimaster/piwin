// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ChatMessageUi } from './chat-reducer';
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

  it('renders the selection capsule inside the quote box within the user bubble in Conversation mode', () => {
    render(
      <UserMessageContent message={message} onRetry={vi.fn()} locale="zh-CN" isConversationSession={true} />,
    );
    const chips = container?.querySelector('[data-testid="message-context-refs"]');
    const quoteBox = container?.querySelector('[data-testid="user-message-quote-box"]');
    const bubble = container?.querySelector('[data-testid="user-message-collapsible-body"]');
    expect(chips).not.toBeNull();
    expect(chips?.textContent).toContain('visible title');
    expect(quoteBox?.contains(chips as Node)).toBe(true);
    expect(bubble?.textContent).toContain('look at this');
  });

  it('renders context chips directly in Agent mode without quote box', () => {
    render(
      <UserMessageContent message={message} onRetry={vi.fn()} locale="zh-CN" isConversationSession={false} />,
    );
    const chips = container?.querySelector('[data-testid="message-context-refs"]');
    const quoteBox = container?.querySelector('[data-testid="user-message-quote-box"]');
    const bubble = container?.querySelector('[data-testid="user-message-collapsible-body"]');
    expect(chips).not.toBeNull();
    expect(chips?.textContent).toContain('visible title');
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
});
