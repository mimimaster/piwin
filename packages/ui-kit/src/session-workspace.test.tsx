// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  BROWSER_MINI_DRAG_THRESHOLD_PX,
  BROWSER_MINI_KEYBOARD_NUDGE_PX,
  BrowserMiniCard,
  isBrowserMiniDragGesture,
} from './index.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('BrowserMiniCard primitives', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  function mount(node: React.ReactElement): HTMLDivElement {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(node);
    });
    return container;
  }

  afterEach(() => {
    if (root && container) {
      act(() => {
        root?.unmount();
      });
      container.remove();
    }
    root = undefined;
    container = undefined;
  });

  it('distinguishes clean click (expand) from pointer drag on BrowserMiniCard', () => {
    expect(
      isBrowserMiniDragGesture(10, 10, 12, 12, BROWSER_MINI_DRAG_THRESHOLD_PX),
    ).toBe(false);
    expect(
      isBrowserMiniDragGesture(10, 10, 16, 10, BROWSER_MINI_DRAG_THRESHOLD_PX),
    ).toBe(true);

    const onExpand = vi.fn();
    const onDismiss = vi.fn();
    const onResetPosition = vi.fn();
    const onDragStart = vi.fn();
    const onDragMove = vi.fn();
    const onDragEnd = vi.fn();
    const onKeyboardNudge = vi.fn();

    const el = mount(
      <BrowserMiniCard
        title="localhost:3000"
        frameSrc="data:image/gif;base64,R0lGODlhAQABAAAAACw="
        placementMode="floating"
        floatingPosition={{ x: 24, y: 48 }}
        controlOwner="agent"
        runtimeState="stale"
        tabCount={3}
        alertBanner={{
          tone: 'warning',
          message: '网页请求确认弹窗',
          actionLabel: '处理弹窗',
        }}
        onExpand={onExpand}
        onDismiss={onDismiss}
        onResetPosition={onResetPosition}
        onDragStart={onDragStart}
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
        onKeyboardNudge={onKeyboardNudge}
      />,
    );

    // Bezel-less card: agent control shows as a single island dot, never a header.
    expect(
      el.querySelector('[data-testid="browser-mini-card-agent-island"]'),
    ).not.toBeNull();
    expect(
      el.querySelector('[data-testid="browser-mini-card-header"]'),
    ).toBeNull();
    expect(
      el.querySelector('[data-testid="browser-mini-card-state-pill"]')
        ?.textContent,
    ).toBe('画面已过期');

    const card = el.querySelector(
      '[data-testid="browser-mini-card"]',
    ) as HTMLElement;

    // 1. Clean click on the card (< 5px movement) expands the full Browser panel
    act(() => {
      card.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          button: 0,
          pointerId: 1,
          clientX: 100,
          clientY: 100,
        }),
      );
      card.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          pointerId: 1,
          clientX: 102,
          clientY: 101,
        }),
      );
      card.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          pointerId: 1,
          clientX: 102,
          clientY: 101,
        }),
      );
    });

    expect(onExpand).toHaveBeenCalledTimes(1);
    expect(onDragStart).not.toHaveBeenCalled();

    // 2. Dragging on the card (>= 5px movement) moves the mini and does NOT expand
    act(() => {
      card.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          button: 0,
          pointerId: 2,
          clientX: 100,
          clientY: 100,
        }),
      );
      card.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          pointerId: 2,
          clientX: 130,
          clientY: 120,
        }),
      );
      card.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          pointerId: 2,
          clientX: 130,
          clientY: 120,
        }),
      );
    });

    expect(onDragStart).toHaveBeenCalledTimes(1);
    expect(onDragMove).toHaveBeenCalledWith({
      deltaX: 30,
      deltaY: 20,
      clientX: 130,
      clientY: 120,
    });
    expect(onDragEnd).toHaveBeenCalledTimes(1);
    expect(onExpand).toHaveBeenCalledTimes(1);

    // 3. Keyboard arrow nudge works for non-drag accessibility
    act(() => {
      card.dispatchEvent(
        new KeyboardEvent('keydown', {
          bubbles: true,
          key: 'ArrowLeft',
        }),
      );
    });
    expect(onKeyboardNudge).toHaveBeenCalledWith({
      dx: -BROWSER_MINI_KEYBOARD_NUDGE_PX,
      dy: 0,
    });

    // 4. Floating reset position button & alert banner action work
    const resetBtn = el.querySelector(
      '[data-testid="browser-mini-card-reset-position"]',
    ) as HTMLButtonElement;
    act(() => {
      resetBtn.click();
    });
    expect(onResetPosition).toHaveBeenCalledTimes(1);
  });

  it('forwards a clean card click when onViewportActivate is set', () => {
    const onExpand = vi.fn();
    const onViewportActivate = vi.fn();
    const el = mount(
      <BrowserMiniCard
        title="localhost:3000"
        frameSrc="data:image/gif;base64,R0lGODlhAQABAAAAACw="
        onExpand={onExpand}
        onViewportActivate={onViewportActivate}
      />,
    );
    const card = el.querySelector(
      '[data-testid="browser-mini-card"]',
    ) as HTMLElement;
    act(() => {
      card.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          button: 0,
          pointerId: 7,
          clientX: 40,
          clientY: 40,
        }),
      );
      card.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          pointerId: 7,
          clientX: 41,
          clientY: 40,
        }),
      );
    });
    expect(onViewportActivate).toHaveBeenCalledTimes(1);
    expect(onExpand).not.toHaveBeenCalled();
  });
});
