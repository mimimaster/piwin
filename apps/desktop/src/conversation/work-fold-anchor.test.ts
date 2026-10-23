// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  collapseFoldWithAnchor,
  collectOpenFolds,
  FOLD_RAIL_ROW_PX,
  pinnedFoldChain,
} from './work-fold-anchor.js';

/** jsdom has no layout: each element reports whatever `top` the test gives it. */
function place(element: Element, top: () => number): void {
  vi.spyOn(element, 'getBoundingClientRect').mockImplementation(
    () => ({ top: top(), bottom: top(), left: 0, right: 0, width: 0, height: 0 }) as DOMRect,
  );
}

function fold(
  container: HTMLElement,
  id: string,
  options: { open?: boolean; level?: 'turn' | 'segment'; title?: string; end?: boolean } = {},
): { header: HTMLButtonElement; end: HTMLSpanElement | null } {
  const header = document.createElement('button');
  header.dataset.foldHeader = id;
  header.dataset.foldOpen = options.open === false ? 'false' : 'true';
  header.dataset.foldLevel = options.level ?? 'segment';
  header.dataset.foldTitle = options.title ?? id;
  header.dataset.foldMeta = '3 tools';
  container.appendChild(header);
  let end: HTMLSpanElement | null = null;
  if (options.end !== false) {
    end = document.createElement('span');
    end.dataset.foldEnd = id;
    container.appendChild(end);
  }
  return { header, end };
}

describe('collectOpenFolds', () => {
  it('lists open folds that have an end marker, in document order', () => {
    const container = document.createElement('div');
    fold(container, 'turn:a', { level: 'turn' });
    fold(container, 'segment:1', { open: false });
    fold(container, 'segment:2', { end: false });
    fold(container, 'segment:3', { title: 'Third' });
    const folds = collectOpenFolds(container);
    expect(folds.map((entry) => entry.id)).toEqual(['turn:a', 'segment:3']);
    expect(folds[0]?.level).toBe('turn');
    expect(folds[1]).toMatchObject({ title: 'Third', meta: '3 tools' });
  });
});

describe('pinnedFoldChain', () => {
  it('keeps the enclosing folds whose headers scrolled away and whose region is still on screen', () => {
    const container = document.createElement('div');
    place(container, () => 100);
    const turn = fold(container, 'turn:a', { level: 'turn' });
    const first = fold(container, 'segment:1');
    const second = fold(container, 'segment:2');
    const later = fold(container, 'segment:3');
    // Viewport top is y=100. The turn and segment 2 contain it; segment 1 ended
    // above it; segment 3's header is still below the fold line.
    place(turn.header, () => -400);
    place(turn.end as Element, () => 900);
    place(first.header, () => -300);
    place(first.end as Element, () => 40);
    place(second.header, () => 60);
    place(second.end as Element, () => 700);
    place(later.header, () => 400);
    place(later.end as Element, () => 800);
    expect(pinnedFoldChain(container).map((entry) => entry.id)).toEqual([
      'turn:a',
      'segment:2',
    ]);
  });

  it('counts the rows already pinned: a header just under them has not scrolled away yet', () => {
    const container = document.createElement('div');
    place(container, () => 0);
    const turn = fold(container, 'turn:a', { level: 'turn' });
    const seg = fold(container, 'segment:1');
    place(turn.header, () => -200);
    place(turn.end as Element, () => 900);
    // Under the turn row (y=30) → visible, so not part of the chain.
    place(seg.header, () => FOLD_RAIL_ROW_PX + 4);
    place(seg.end as Element, () => 800);
    expect(pinnedFoldChain(container).map((entry) => entry.id)).toEqual(['turn:a']);
  });

  it('ignores a fold whose region already ended above the viewport', () => {
    const container = document.createElement('div');
    place(container, () => 0);
    const seg = fold(container, 'segment:1');
    place(seg.header, () => -900);
    place(seg.end as Element, () => -10);
    expect(pinnedFoldChain(container)).toEqual([]);
  });
});

describe('collapseFoldWithAnchor', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
      callback(0);
      return 1;
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('collapses through the real header and lands it under the rail rows above it', () => {
    const container = document.createElement('div');
    let scrollTop = 500;
    Object.defineProperty(container, 'scrollTop', {
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value;
      },
    });
    place(container, () => 0);
    const turn = fold(container, 'turn:a', { level: 'turn' });
    const seg = fold(container, 'segment:1');
    // The header sits at content offset 180, so with scrollTop 500 it is 320px
    // above the viewport. Its on-screen position is always offset - scrollTop.
    const headerContentTop = 180;
    place(turn.header, () => -900);
    place(turn.end as Element, () => 1200);
    place(seg.header, () => headerContentTop - scrollTop);
    place(seg.end as Element, () => 600);
    const clicked = vi.fn(() => {
      // The body vanishes, the list is shorter, and the browser clamps scrollTop.
      scrollTop = 100;
    });
    seg.header.addEventListener('click', clicked);
    const beginProgrammaticScroll = vi.fn();

    collapseFoldWithAnchor(container, seg.header, { beginProgrammaticScroll });

    expect(clicked).toHaveBeenCalledTimes(1);
    // One rail row (the turn) sits above it, so it must end up one row down.
    expect(headerContentTop - scrollTop).toBe(FOLD_RAIL_ROW_PX + 2);
    expect(beginProgrammaticScroll).toHaveBeenCalled();
  });

  it('leaves a header the reader can see exactly where it was', () => {
    const container = document.createElement('div');
    let scrollTop = 0;
    Object.defineProperty(container, 'scrollTop', {
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value;
      },
    });
    place(container, () => 0);
    const seg = fold(container, 'segment:1');
    place(seg.header, () => 240 - scrollTop);
    place(seg.end as Element, () => 900);
    collapseFoldWithAnchor(container, seg.header);
    expect(scrollTop).toBe(0);
  });
});
