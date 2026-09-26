// @vitest-environment happy-dom
import { act, createElement, useRef, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { isFollowTailNearBottom, useFollowTail, type FollowTail } from './use-follow-tail.js';

describe('isFollowTailNearBottom', () => {
  it('follows while the remaining distance is within the threshold', () => {
    expect(isFollowTailNearBottom(936, 1000, 50, 64)).toBe(true);
    expect(isFollowTailNearBottom(800, 1000, 50, 64)).toBe(false);
  });

  it('treats a short document as already at the tail', () => {
    expect(isFollowTailNearBottom(0, 40, 50, 64)).toBe(true);
  });
});

describe('useFollowTail', () => {
  it('reports leaving the tail and jumps back on request', async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    let latest: FollowTail | undefined;
    function Probe(): ReactElement {
      const ref = useRef<HTMLDivElement | null>(null);
      latest = useFollowTail({ axisRef: ref, revision: 'r1' });
      return createElement('div', { ref, 'data-probe': '' });
    }
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    act(() => root.render(createElement(Probe)));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 30)));
    const node = container.querySelector<HTMLDivElement>('[data-probe]');
    if (node === null) throw new Error('probe missing');
    Object.defineProperty(node, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(node, 'clientHeight', { value: 400, configurable: true });
    node.scrollTo = ((options: ScrollToOptions) => {
      node.scrollTop = options.top ?? 0;
    }) as typeof node.scrollTo;

    act(() => {
      node.scrollTop = 0;
      node.dispatchEvent(new Event('scroll'));
    });
    expect(latest?.atTail).toBe(false);

    act(() => latest?.jumpToTail());
    expect(latest?.atTail).toBe(true);
    expect(node.scrollTop).toBe(1000);
    act(() => root.unmount());
    container.remove();
    globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
  });
});
