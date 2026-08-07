// @vitest-environment happy-dom
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  HistoryTicksDrawer,
  formatFullTimestamp,
  getHistoryTickWaveScale,
  truncateMessageText,
} from './history-ticks-drawer';
import type { ChatMessageUi } from './chat-reducer';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function getInlineTickScale(element: HTMLElement | undefined): number {
  const transform = element?.style.transform ?? '';
  const scaleText = /^scaleX\(([^)]+)\)$/.exec(transform)?.[1];
  return scaleText ? Number(scaleText) : 1;
}

describe('history-ticks-drawer helpers', () => {
  it('formats full timestamp correctly', () => {
    const formatted = formatFullTimestamp('2026-07-31T17:08:00Z');
    expect(typeof formatted).toBe('string');
    expect(formatted.length).toBeGreaterThan(0);
  });

  it('truncates long text correctly', () => {
    const shortText = 'Short message';
    const longText = 'A'.repeat(150);
    expect(truncateMessageText(shortText, 100)).toBe('Short message');
    expect(truncateMessageText(longText, 100)).toHaveLength(103);
    expect(truncateMessageText(longText, 100).slice(-3)).toBe('...');
  });

  it('keeps the wave profile symmetric around the hovered tick', () => {
    expect(getHistoryTickWaveScale(0)).toBeCloseTo(36 / 12);
    expect(getHistoryTickWaveScale(1)).toBeCloseTo(30 / 12);
    expect(getHistoryTickWaveScale(2)).toBeCloseTo(24 / 12);
    expect(getHistoryTickWaveScale(3)).toBeCloseTo(18 / 12);
    expect(getHistoryTickWaveScale(4)).toBe(1);
    expect(getHistoryTickWaveScale(5)).toBe(1);
    expect(getHistoryTickWaveScale(Number.POSITIVE_INFINITY)).toBe(1);
    expect(getHistoryTickWaveScale(-1)).toBeCloseTo(36 / 12);

    const firstStep = getHistoryTickWaveScale(0) - getHistoryTickWaveScale(1);
    const secondStep = getHistoryTickWaveScale(1) - getHistoryTickWaveScale(2);
    const thirdStep = getHistoryTickWaveScale(2) - getHistoryTickWaveScale(3);
    const fourthStep = getHistoryTickWaveScale(3) - getHistoryTickWaveScale(4);
    expect(firstStep).toBeCloseTo(secondStep);
    expect(secondStep).toBeCloseTo(thirdStep);
    expect(thirdStep).toBeCloseTo(fourthStep);
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

  it('shows the corresponding user message when a collapsed tick is hovered', () => {
    act(() => {
      root?.render(<HistoryTicksDrawer messages={sampleMessages} />);
    });

    const firstTick = container?.querySelector('[data-testid="history-tick-msg-user-1"]');
    const rail = container?.querySelector('[data-testid="history-drawer-handle"]');
    expect(firstTick).not.toBeNull();
    expect(rail).not.toBeNull();

    if (rail instanceof HTMLElement) {
      vi.spyOn(rail, 'getBoundingClientRect').mockReturnValue({
        top: 100,
        left: 8,
        right: 50,
        bottom: 200,
        width: 42,
        height: 100,
        x: 8,
        y: 100,
        toJSON: () => ({}),
      } as DOMRect);
    }

    act(() => {
      rail?.dispatchEvent(
        new window.MouseEvent('mousemove', {
          bubbles: true,
          cancelable: true,
          clientY: 108.5,
        }),
      );
    });

    // Portaled to document.body so fixed coords are viewport-relative (not
    // rebased by chat-column backdrop-filter containing blocks).
    const bubble = document.querySelector('[data-testid="history-message-bubble"]');
    expect(bubble).not.toBeNull();
    expect(bubble?.parentElement).toBe(document.body);
    expect(container?.contains(bubble)).toBe(false);
    // left = rail.left(8) + wave max(36) + gap(8) = 52 — tight to the tick tip.
    expect((bubble as HTMLElement).style.left).toBe('52px');
    expect(bubble?.querySelector('.history-bubble-text')?.textContent).toBe(
      '内置的浏览器有优化的方案吗',
    );
    expect(firstTick?.classList.contains('is-hovered')).toBe(true);
  });

  it('applies the wave to nearby ticks while sweeping across the rail', async () => {
    const firstMessage = sampleMessages[0];
    if (!firstMessage) {
      throw new Error('Expected a sample message');
    }

    const waveMessages: ChatMessageUi[] = Array.from({ length: 11 }, (_, index) => ({
      ...firstMessage,
      id: `wave-user-${index}`,
      text: `Wave message ${index}`,
    }));

    act(() => {
      root?.render(<HistoryTicksDrawer messages={waveMessages} />);
    });

    const rail = container?.querySelector('[data-testid="history-drawer-handle"]');
    const tickElements = container?.querySelectorAll<HTMLElement>('.border-tick-line');
    expect(rail).not.toBeNull();
    expect(tickElements?.length).toBe(11);

    if (rail instanceof HTMLElement) {
      vi.spyOn(rail, 'getBoundingClientRect').mockReturnValue({
        top: 0,
        left: 8,
        right: 50,
        bottom: 100,
        width: 42,
        height: 100,
        x: 8,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect);
    }

    await act(async () => {
      rail?.dispatchEvent(
        new window.MouseEvent('mousemove', {
          bubbles: true,
          cancelable: true,
          // Between the fifth and sixth ticks; the nearest (sixth) tick stays the peak.
          clientY: 58,
        }),
      );

      await new Promise<void>((resolve) => {
        if (typeof window.requestAnimationFrame === 'function') {
          window.requestAnimationFrame(() => resolve());
        } else {
          resolve();
        }
      });
    });

    expect(getInlineTickScale(tickElements?.[0])).toBe(1);
    expect(getInlineTickScale(tickElements?.[1])).toBe(1);
    expect(getInlineTickScale(tickElements?.[2])).toBeCloseTo(18 / 12);
    expect(getInlineTickScale(tickElements?.[3])).toBeCloseTo(24 / 12);
    expect(getInlineTickScale(tickElements?.[4])).toBeCloseTo(30 / 12);
    expect(getInlineTickScale(tickElements?.[5])).toBeCloseTo(36 / 12);
    expect(getInlineTickScale(tickElements?.[6])).toBeCloseTo(30 / 12);
    expect(getInlineTickScale(tickElements?.[7])).toBeCloseTo(24 / 12);
    expect(getInlineTickScale(tickElements?.[8])).toBeCloseTo(18 / 12);
    expect(getInlineTickScale(tickElements?.[9])).toBe(1);
    expect(getInlineTickScale(tickElements?.[10])).toBe(1);
  });

  it('switches the bubble to the next user message without moving the rail', () => {
    act(() => {
      root?.render(<HistoryTicksDrawer messages={sampleMessages} />);
    });

    const firstTick = container?.querySelector('[data-testid="history-tick-msg-user-1"]');
    const secondTick = container?.querySelector('[data-testid="history-tick-msg-user-2"]');
    const rail = container?.querySelector('[data-testid="history-drawer-handle"]');

    if (rail instanceof HTMLElement) {
      vi.spyOn(rail, 'getBoundingClientRect').mockReturnValue({
        top: 0,
        left: 8,
        right: 50,
        bottom: 100,
        width: 42,
        height: 100,
        x: 8,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect);
    }

    act(() => {
      rail?.dispatchEvent(
        new window.MouseEvent('mousemove', {
          bubbles: true,
          cancelable: true,
          clientY: 8.5,
        }),
      );
      rail?.dispatchEvent(
        new window.MouseEvent('mousemove', {
          bubbles: true,
          cancelable: true,
          clientY: 19.5,
        }),
      );
    });

    expect(document.querySelector('.history-bubble-text')?.textContent).toBe('第二条用户消息');
    expect(firstTick?.classList.contains('is-hovered')).toBe(false);
    expect(secondTick?.classList.contains('is-hovered')).toBe(true);
  });

  it('clears the preview bubble when the pointer leaves the rail', () => {
    act(() => {
      root?.render(<HistoryTicksDrawer messages={sampleMessages} />);
    });

    const rail = container?.querySelector('[data-testid="history-drawer-handle"]');
    const drawer = container?.querySelector('[data-testid="history-ticks-drawer"]');

    if (rail instanceof HTMLElement) {
      vi.spyOn(rail, 'getBoundingClientRect').mockReturnValue({
        top: 0,
        left: 8,
        right: 50,
        bottom: 100,
        width: 42,
        height: 100,
        x: 8,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect);
    }

    act(() => {
      rail?.dispatchEvent(
        new window.MouseEvent('mousemove', {
          bubbles: true,
          cancelable: true,
          clientY: 8.5,
        }),
      );
    });
    expect(document.querySelector('[data-testid="history-message-bubble"]')).not.toBeNull();

    act(() => {
      drawer?.dispatchEvent(
        new window.MouseEvent('mouseout', {
          bubbles: true,
          cancelable: true,
          relatedTarget: document.body,
        }),
      );
    });

    expect(document.querySelector('[data-testid="history-message-bubble"]')).toBeNull();
  });

  it('jumps directly to the historical message when a tick is clicked', () => {
    const targetElement = document.createElement('div');
    targetElement.id = 'msg-msg-user-1';
    targetElement.scrollIntoView = vi.fn();
    document.body.appendChild(targetElement);

    act(() => {
      root?.render(<HistoryTicksDrawer messages={sampleMessages} />);
    });

    const firstTick = container?.querySelector('[data-testid="history-tick-msg-user-1"]');
    act(() => {
      firstTick?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    expect(targetElement.scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'center',
    });
    expect(container?.querySelector('[data-testid="history-drawer-panel"]')).toBeNull();
    document.body.removeChild(targetElement);
  });

  it('jumps directly to the historical message with keyboard activation', () => {
    const targetElement = document.createElement('div');
    targetElement.id = 'msg-msg-user-2';
    targetElement.scrollIntoView = vi.fn();
    document.body.appendChild(targetElement);

    act(() => {
      root?.render(<HistoryTicksDrawer messages={sampleMessages} />);
    });

    const secondTick = container?.querySelector('[data-testid="history-tick-msg-user-2"]');
    act(() => {
      secondTick?.dispatchEvent(
        new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
    });

    expect(targetElement.scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'center',
    });
    document.body.removeChild(targetElement);
  });
});
