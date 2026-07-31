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
