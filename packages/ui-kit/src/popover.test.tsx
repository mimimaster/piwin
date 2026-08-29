// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { type ReactElement } from 'react';
import { Popover, virtualAnchorFromRange } from './popover.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

describe('Popover autofocus behavior', () => {
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
    if (container) {
      container.remove();
    }
    container = null;
    root = null;
  });

  it('renders popover and prevents default autofocus on open by default', () => {
    const onOpenAutoFocus = vi.fn();
    const tree: ReactElement = (
      <Popover
        open={true}
        trigger={<button type="button">Trigger</button>}
        testId="test-popover"
        onOpenAutoFocus={onOpenAutoFocus}
      >
        <button type="button" data-testid="inside-btn">
          Inside
        </button>
      </Popover>
    );

    act(() => {
      root!.render(tree);
    });

    const popover = document.querySelector('[data-testid="test-popover"]');
    expect(popover).not.toBeNull();
    expect(onOpenAutoFocus).toHaveBeenCalled();
  });

  it('focuses the first control when autoFocus is enabled', () => {
    const tree: ReactElement = (
      <Popover
        open={true}
        autoFocus={true}
        trigger={<button type="button">Trigger</button>}
        testId="focus-popover"
        label="Focus popover"
      >
        <button type="button" data-testid="focus-target">
          Action
        </button>
      </Popover>
    );

    act(() => {
      root!.render(tree);
    });

    const target = document.querySelector('[data-testid="focus-target"]');
    expect(target).not.toBeNull();
    expect(document.activeElement).toBe(target);
  });

  it('positions against a virtual rect and leaves collision to Radix', () => {
    const getBoundingClientRect = (): DOMRect => new DOMRect(24, 12, 96, 18);
    const tree: ReactElement = (
      <Popover
        open={true}
        virtualAnchor={{ getBoundingClientRect }}
        side="top"
        testId="virtual-popover"
        label="Virtual popover"
      >
        <button type="button">Hint</button>
      </Popover>
    );

    act(() => {
      root!.render(tree);
    });

    const anchor = document.querySelector('[data-testid="ui-popover-virtual-anchor"]');
    expect(anchor).toBeInstanceOf(HTMLElement);
    const style = (anchor as HTMLElement).style;
    expect(style.position).toBe('fixed');
    expect(style.left).toBe('24px');
    expect(style.top).toBe('12px');
    expect(style.width).toBe('96px');
    expect(style.height).toBe('18px');
    expect(style.pointerEvents).toBe('none');

    const content = document.querySelector('[data-testid="virtual-popover"]');
    expect(content).not.toBeNull();
    expect(content?.hasAttribute('data-side')).toBe(true);
  });

  it('builds a virtual anchor from a live Range', () => {
    const host = document.createElement('p');
    host.textContent = 'select this phrase';
    document.body.appendChild(host);
    const text = host.firstChild;
    if (!(text instanceof Text)) {
      throw new Error('expected text node');
    }
    const range = document.createRange();
    range.setStart(text, 7);
    range.setEnd(text, 11);
    const original = range.getBoundingClientRect.bind(range);
    vi.spyOn(range, 'getBoundingClientRect').mockImplementation(() => {
      try {
        const live = original();
        if (live.width > 0 || live.height > 0) return live;
      } catch {
        // happy-dom may not layout Ranges
      }
      return new DOMRect(40, 60, 48, 14);
    });

    const tree: ReactElement = (
      <Popover
        open={true}
        virtualAnchor={virtualAnchorFromRange(range)}
        testId="range-popover"
        label="Range popover"
      >
        <button type="button">Explain</button>
      </Popover>
    );

    act(() => {
      root!.render(tree);
    });

    expect(document.querySelector('[data-testid="range-popover"]')).not.toBeNull();
    const anchor = document.querySelector('[data-testid="ui-popover-virtual-anchor"]');
    expect(anchor).toBeInstanceOf(HTMLElement);
    expect((anchor as HTMLElement).style.left).toBe('40px');
    host.remove();
  });
});
