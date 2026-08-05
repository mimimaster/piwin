// @vitest-environment happy-dom
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  HistoryTicksDrawer,
  formatRelativeTime,
  formatFullTimestamp,
  getDynamicTickWidth,
  truncateMessageText,
} from './history-ticks-drawer';
import type { ChatMessageUi } from './chat-reducer';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

describe('history-ticks-drawer helpers', () => {
  it('formats relative time correctly', () => {
    const now = new Date('2026-07-31T17:30:00Z');
    expect(formatRelativeTime('2026-07-31T17:27:00Z', now)).toBe('3m');
    expect(formatRelativeTime('2026-07-31T17:20:00Z', now)).toBe('10m');
    expect(formatRelativeTime('2026-07-31T17:03:00Z', now)).toBe('27m');
    expect(formatRelativeTime('2026-07-31T15:30:00Z', now)).toBe('2h');
    expect(formatRelativeTime('2026-07-29T17:30:00Z', now)).toBe('2d');
  });

  it('formats full timestamp correctly', () => {
    const formatted = formatFullTimestamp('2026-07-31T17:08:00Z');
    expect(typeof formatted).toBe('string');
    expect(formatted.length).toBeGreaterThan(0);
  });

  it('calculates dynamic tick width based on text length', () => {
    const shortText = 'Hi';
    const longText = 'This is a long message content meant to test dynamic width scaling logic accurately.';
    const shortWidth = getDynamicTickWidth(shortText, 8, 18);
    const longWidth = getDynamicTickWidth(longText, 8, 18);
    expect(shortWidth).toBeGreaterThanOrEqual(8);
    expect(longWidth).toBeLessThanOrEqual(18);
    expect(longWidth).toBeGreaterThan(shortWidth);
  });

  it('truncates long text correctly', () => {
    const shortText = 'Short message';
    const longText = 'A'.repeat(150);
    expect(truncateMessageText(shortText, 100)).toBe('Short message');
    expect(truncateMessageText(longText, 100)).toHaveLength(103);
    expect(truncateMessageText(longText, 100).slice(-3)).toBe('...');
  });
});

describe('HistoryTicksDrawer component', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
    }
    container = null;
    root = null;
  });

  const sampleMessages: ChatMessageUi[] = [
    {
      id: 'msg-user-1',
      role: 'user',
      text: '内置的浏览器有优化的方案吗',
      thinking: '',
      tools: [],
      attachments: [],
      status: 'done',
      createdAt: '2026-07-31T17:03:00Z',
    },
    {
      id: 'msg-assistant-1',
      role: 'assistant',
      text: 'Here is the response...',
      thinking: '',
      tools: [],
      attachments: [],
      status: 'done',
      createdAt: '2026-07-31T17:04:00Z',
    },
    {
      id: 'msg-user-2',
      role: 'user',
      text: '第二条用户消息',
      thinking: '',
      tools: [],
      attachments: [],
      status: 'done',
      createdAt: '2026-07-31T17:27:00Z',
    },
  ];

  it('returns null when there are no user messages', () => {
    act(() => {
      root?.render(<HistoryTicksDrawer messages={[]} />);
    });
    expect(container?.querySelector('.history-ticks-drawer')).toBeNull();
  });

  it('transitions from an empty session to messages without changing hook order', () => {
    act(() => {
      root?.render(<HistoryTicksDrawer messages={[]} />);
    });

    act(() => {
      root?.render(<HistoryTicksDrawer messages={sampleMessages} />);
    });

    expect(container?.querySelector('.history-ticks-drawer')).not.toBeNull();
    expect(container?.querySelectorAll('.border-tick-line').length).toBe(2);
  });

  it('renders collapsed handle initially and expands on tick line click', () => {
    act(() => {
      root?.render(<HistoryTicksDrawer messages={sampleMessages} />);
    });

    const drawer = container?.querySelector('.history-ticks-drawer');
    expect(drawer).not.toBeNull();
    const firstBorderTick = container?.querySelector('.border-tick-line');
    expect(firstBorderTick).not.toBeNull();
    expect(container?.querySelectorAll('.border-tick-line').length).toBe(2);

    // Click border tick line to expand
    act(() => {
      firstBorderTick?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    expect(container?.querySelector('[data-testid="history-drawer-panel"]')).not.toBeNull();
    expect(container?.querySelectorAll('.history-tick-item').length).toBe(2);
  });

  it('stays pinned open when mouse leaves the drawer', () => {
    act(() => {
      root?.render(<HistoryTicksDrawer messages={sampleMessages} />);
    });

    const firstBorderTick = container?.querySelector('.border-tick-line');
    act(() => {
      firstBorderTick?.dispatchEvent(
        new window.MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    });

    const drawer = container?.querySelector('[data-testid="history-ticks-drawer"]');
    expect(drawer?.classList.contains('is-pinned')).toBe(true);
    expect(container?.querySelector('[data-testid="history-drawer-panel"]')).not.toBeNull();

    act(() => {
      drawer?.dispatchEvent(
        new window.MouseEvent('mouseleave', { bubbles: true, cancelable: true }),
      );
    });

    expect(container?.querySelector('[data-testid="history-drawer-panel"]')).not.toBeNull();
    expect(drawer?.classList.contains('is-pinned')).toBe(true);
  });

  it('closes when the pin close button is clicked', () => {
    act(() => {
      root?.render(<HistoryTicksDrawer messages={sampleMessages} />);
    });

    const firstBorderTick = container?.querySelector('.border-tick-line');
    act(() => {
      firstBorderTick?.dispatchEvent(
        new window.MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    });

    const closeButton = container?.querySelector('[data-testid="history-drawer-close"]');
    expect(closeButton).not.toBeNull();
    act(() => {
      closeButton?.dispatchEvent(
        new window.MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    });

    expect(container?.querySelector('[data-testid="history-drawer-panel"]')).toBeNull();
    expect(container?.querySelector('.border-tick-line')).not.toBeNull();
  });

  it('closes when clicking outside the drawer while pinned', () => {
    act(() => {
      root?.render(<HistoryTicksDrawer messages={sampleMessages} />);
    });

    const firstBorderTick = container?.querySelector('.border-tick-line');
    act(() => {
      firstBorderTick?.dispatchEvent(
        new window.MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    });
    expect(container?.querySelector('[data-testid="history-drawer-panel"]')).not.toBeNull();

    act(() => {
      document.dispatchEvent(
        new window.MouseEvent('mousedown', { bubbles: true, cancelable: true }),
      );
    });

    expect(container?.querySelector('[data-testid="history-drawer-panel"]')).toBeNull();
  });

  it('closes when Escape is pressed while pinned', () => {
    act(() => {
      root?.render(<HistoryTicksDrawer messages={sampleMessages} />);
    });

    const firstBorderTick = container?.querySelector('.border-tick-line');
    act(() => {
      firstBorderTick?.dispatchEvent(
        new window.MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    });

    act(() => {
      document.dispatchEvent(
        new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
    });

    expect(container?.querySelector('[data-testid="history-drawer-panel"]')).toBeNull();
  });

  it('shows message bubble popover after expanding drawer and hovering tick item', () => {
    act(() => {
      root?.render(<HistoryTicksDrawer messages={sampleMessages} />);
    });

    const firstBorderTick = container?.querySelector('.border-tick-line');
    act(() => {
      firstBorderTick?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    const firstTick = container?.querySelector('[data-testid="history-tick-msg-user-1"]');
    expect(firstTick).not.toBeNull();

    act(() => {
      firstTick?.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true, cancelable: true }));
    });

    const bubble = container?.querySelector('[data-testid="history-message-bubble"]');
    expect(bubble).not.toBeNull();
    expect(bubble?.querySelector('.history-bubble-text')?.textContent).toBe('内置的浏览器有优化的方案吗');
  });

  it('clears the preview bubble on mouse leave so it cannot freeze open', () => {
    act(() => {
      root?.render(<HistoryTicksDrawer messages={sampleMessages} />);
    });

    const firstBorderTick = container?.querySelector('.border-tick-line');
    act(() => {
      firstBorderTick?.dispatchEvent(
        new window.MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    });

    const firstTick = container?.querySelector('[data-testid="history-tick-msg-user-1"]');
    act(() => {
      firstTick?.dispatchEvent(
        new window.MouseEvent('mouseover', { bubbles: true, cancelable: true }),
      );
    });
    expect(container?.querySelector('[data-testid="history-message-bubble"]')).not.toBeNull();

    const drawer = container?.querySelector('[data-testid="history-ticks-drawer"]');
    act(() => {
      drawer?.dispatchEvent(
        new window.MouseEvent('mouseout', {
          bubbles: true,
          cancelable: true,
          relatedTarget: document.body,
        }),
      );
    });

    // Drawer stays pinned, but the sticky preview must not remain.
    expect(container?.querySelector('[data-testid="history-drawer-panel"]')).not.toBeNull();
    expect(container?.querySelector('[data-testid="history-message-bubble"]')).toBeNull();
  });

  it('unpins when the conversation identity changes', () => {
    act(() => {
      root?.render(<HistoryTicksDrawer messages={sampleMessages} />);
    });

    const firstBorderTick = container?.querySelector('.border-tick-line');
    act(() => {
      firstBorderTick?.dispatchEvent(
        new window.MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    });
    expect(container?.querySelector('[data-testid="history-drawer-panel"]')).not.toBeNull();

    const otherSessionMessages: ChatMessageUi[] = [
      {
        ...sampleMessages[0]!,
        id: 'msg-other-session',
        text: 'another session',
      },
    ];
    act(() => {
      root?.render(<HistoryTicksDrawer messages={otherSessionMessages} />);
    });

    expect(container?.querySelector('[data-testid="history-drawer-panel"]')).toBeNull();
    expect(container?.querySelector('.border-tick-line')).not.toBeNull();
  });

  it('triggers scrollIntoView when clicking a tick', () => {
    const targetDiv = document.createElement('div');
    targetDiv.id = 'msg-msg-user-1';
    targetDiv.scrollIntoView = vi.fn();
    document.body.appendChild(targetDiv);

    act(() => {
      root?.render(<HistoryTicksDrawer messages={sampleMessages} />);
    });

    const firstBorderTick = container?.querySelector('.border-tick-line');
    act(() => {
      firstBorderTick?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    const firstTick = container?.querySelector('[data-testid="history-tick-msg-user-1"]');
    act(() => {
      firstTick?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    expect(targetDiv.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
    document.body.removeChild(targetDiv);
  });
});
