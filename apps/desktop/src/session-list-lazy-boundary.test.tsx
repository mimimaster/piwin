// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionListLazyBoundary } from './session-list-lazy-boundary';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type ObserverCallback = ConstructorParameters<typeof IntersectionObserver>[0];

class IntersectionObserverFixture {
  static instances: IntersectionObserverFixture[] = [];

  readonly root: Element | Document | null;
  readonly rootMargin: string;
  readonly thresholds: readonly number[] = [0];
  private readonly callback: ObserverCallback;
  private target: Element | null = null;

  constructor(callback: ObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback;
    this.root = options?.root ?? null;
    this.rootMargin = options?.rootMargin ?? '0px';
    IntersectionObserverFixture.instances.push(this);
  }

  disconnect(): void {
    this.target = null;
  }

  observe(target: Element): void {
    this.target = target;
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  unobserve(target: Element): void {
    if (this.target === target) {
      this.target = null;
    }
  }

  trigger(isIntersecting: boolean): void {
    const target = this.target;
    if (target === null) {
      return;
    }
    const bounds = target.getBoundingClientRect();
    this.callback(
      [
        {
          boundingClientRect: bounds,
          intersectionRatio: isIntersecting ? 1 : 0,
          intersectionRect: bounds,
          isIntersecting,
          rootBounds: null,
          target,
          time: performance.now(),
        },
      ],
      this as unknown as IntersectionObserver,
    );
  }
}

function renderBoundary(
  cursor: string,
  onLoad: () => Promise<boolean>,
): {
  container: HTMLDivElement;
  root: Root;
} {
  const container = document.createElement('div');
  container.className = 'sidebar-folder-tree';
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <ul>
        <SessionListLazyBoundary
          scopeKey="general"
          direction="next"
          cursor={cursor}
          loadingLabel="Loading sessions"
          onLoad={onLoad}
        />
      </ul>,
    );
  });
  return { container, root };
}

describe('SessionListLazyBoundary', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    IntersectionObserverFixture.instances = [];
    document.body.replaceChildren();
  });

  it('loads an intersecting cursor once without rendering page controls', async () => {
    vi.stubGlobal('IntersectionObserver', IntersectionObserverFixture);
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(performance.now());
      return 1;
    });
    let resolveLoad: ((loaded: boolean) => void) | undefined;
    const onLoad = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveLoad = resolve;
        }),
    );
    const { container, root } = renderBoundary('next-cursor', onLoad);
    const observer = IntersectionObserverFixture.instances[0];
    expect(observer).toBeDefined();

    act(() => {
      observer?.trigger(true);
      observer?.trigger(true);
    });
    expect(onLoad).toHaveBeenCalledOnce();
    expect(container.querySelector('.session-page-row')).toBeNull();

    await act(async () => {
      resolveLoad?.(true);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onLoad).toHaveBeenCalledOnce();

    act(() => root.unmount());
  });
});
