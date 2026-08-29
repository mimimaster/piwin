// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { FlashcardView, FlashcardStackView } from './FlashcardView';
import type { FlashcardReviewCard } from '@piwin/contracts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('FlashcardView lifecycle, animation & memory recycling', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const sampleCard: FlashcardReviewCard = {
    cardId: 'card-test-1',
    itemId: 'card-test-1',
    model: 'basic',
    ordinal: 1,
    deck: '生物',
    front: '什么是光合作用？',
    back: '植物利用光能将二氧化碳和水转化为有机物的过程。',
    tags: ['植物学', '能量转化'],
    createdAt: '2026-08-18T00:00:00.000Z',
  };

  it('renders front face with question, deck, and tags', () => {
    act(() => {
      root.render(<FlashcardView card={sampleCard} locale="zh-CN" />);
    });

    expect(container.textContent).toContain('什么是光合作用？');
    expect(container.textContent).toContain('生物');
    expect(container.textContent).toContain('#植物学');
    expect(container.textContent).toContain('翻看解答');
  });

  it('manages is-flipping transient state and cleans up after animation timer', () => {
    act(() => {
      root.render(<FlashcardView card={sampleCard} locale="zh-CN" />);
    });

    const frame = container.querySelector('.fc-quiet-frame');
    expect(frame).not.toBeNull();
    expect(frame?.classList.contains('is-flipped')).toBe(false);
    expect(frame?.classList.contains('is-flipping')).toBe(false);

    // Trigger flip
    act(() => {
      frame?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(frame?.classList.contains('is-flipped')).toBe(true);
    expect(frame?.classList.contains('is-flipping')).toBe(true);

    // Advance timer past animation duration (550ms)
    act(() => {
      vi.advanceTimersByTime(600);
    });

    // is-flipping must be removed so WebKit releases temporary will-change GPU allocation
    expect(frame?.classList.contains('is-flipping')).toBe(false);
    expect(frame?.classList.contains('is-flipped')).toBe(true);
  });

  it('supports keyboard navigation for flip and FSRS rating', () => {
    let capturedAction: unknown = null;
    act(() => {
      root.render(
        <FlashcardView
          card={sampleCard}
          locale="zh-CN"
          onAction={(a) => {
            capturedAction = a;
          }}
        />,
      );
    });

    const cardContainer = container.querySelector('.fc-quiet-card-container');
    expect(cardContainer).not.toBeNull();

    // Press Space to flip
    act(() => {
      cardContainer?.dispatchEvent(
        new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }),
      );
    });

    expect(container.textContent).toContain('植物利用光能');

    // Press '3' to rate 'good' (记住了)
    act(() => {
      cardContainer?.dispatchEvent(
        new KeyboardEvent('keydown', { key: '3', bubbles: true, cancelable: true }),
      );
    });

    expect(container.textContent).toContain('已记录：记住了');
    expect(capturedAction).toEqual({
      type: 'piwin-artifact:action',
      channelId: 'card-test-1',
      action: 'flashcard/rate',
      payload: {
        cardId: 'card-test-1',
        rating: 'good',
      },
    });
  });

  it('virtualizes multi-card deck by mounting only the active card in FlashcardStackView', () => {
    const card2: FlashcardReviewCard = {
      cardId: 'card-test-2',
      itemId: 'card-test-2',
      model: 'basic',
      ordinal: 1,
      deck: '物理',
      front: '牛顿第一运动定律',
      back: '一切物体在没有受到力的作用时，总保持匀速直线运动状态或静止状态。',
      createdAt: '2026-08-18T00:00:00.000Z',
    };

    act(() => {
      root.render(<FlashcardStackView cards={[sampleCard, card2]} locale="zh-CN" />);
    });

    // Top quiet navigation is present
    expect(container.textContent).toContain('卡片 (2)');
    expect(container.textContent).toContain('什么是光合作用？');
    // Card 2 is NOT mounted in DOM (memory saving)
    expect(container.textContent).not.toContain('牛顿第一运动定律');

    // Click next button
    const nextBtn = container.querySelector('button[title="下一张"]');
    expect(nextBtn).not.toBeNull();

    act(() => {
      nextBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // Card 2 is now mounted and Card 1 is cleanly unmounted from memory
    expect(container.textContent).toContain('牛顿第一运动定律');
    expect(container.textContent).not.toContain('什么是光合作用？');
  });

  it('treats one cloze item as a single physical card, even if FSRS faces are passed in', () => {
    const clozeC1: FlashcardReviewCard = {
      cardId: 'card-mito:c1',
      itemId: 'card-mito',
      model: 'cloze',
      ordinal: 1,
      deck: '生物',
      front: '线粒体是[…]的能量工厂。',
      back: '线粒体是**细胞**的能量工厂。',
      createdAt: '2026-08-18T00:00:00.000Z',
    };
    const clozeC2: FlashcardReviewCard = {
      ...clozeC1,
      cardId: 'card-mito:c2',
      ordinal: 2,
      front: '线粒体是细胞的[…]。',
      back: '线粒体是细胞的**能量工厂**。',
    };

    act(() => {
      root.render(<FlashcardStackView cards={[clozeC1, clozeC2]} locale="zh-CN" />);
    });

    expect(container.textContent).not.toContain('卡片 (2)');
    expect(container.querySelectorAll('[data-testid="chat-flashcard"]')).toHaveLength(1);
  });

  it('preview cards flip without an FSRS rating row', () => {
    const preview: FlashcardReviewCard = {
      cardId: 'card-mito',
      itemId: 'card-mito',
      model: 'cloze',
      ordinal: 0,
      deck: '生物',
      front: '线粒体是[…]的[…]。',
      back: '线粒体是**细胞**的**能量工厂**。',
      createdAt: '2026-08-18T00:00:00.000Z',
    };

    act(() => {
      root.render(<FlashcardView card={preview} locale="zh-CN" />);
    });

    const frame = container.querySelector('.fc-quiet-frame');
    act(() => {
      frame?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.textContent).toContain('线粒体是');
    expect(container.querySelector('[data-testid="chat-flashcard-rate-section"]')).toBeNull();
    expect(container.textContent).not.toContain('已记录');
  });

  it('safely cleans up pending animation timer on unmount with zero leaks', () => {
    act(() => {
      root.render(<FlashcardView card={sampleCard} locale="zh-CN" />);
    });

    const frame = container.querySelector('.fc-quiet-frame');
    act(() => {
      frame?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // Unmount while flip animation timer is still pending
    act(() => {
      root.unmount();
    });

    // Advancing timers should not throw or cause dangling setState
    expect(() => {
      act(() => {
        vi.advanceTimersByTime(1000);
      });
    }).not.toThrow();
  });

  function firstTextNode(rootEl: ParentNode): Text {
    const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT);
    const node = walker.nextNode();
    if (!(node instanceof Text) || node.textContent.trim().length === 0) {
      throw new Error('expected a non-empty text node on the card face');
    }
    return node;
  }

  function selectRangeOnCardFace(face: Element, start: number, end: number): void {
    const text = firstTextNode(face);
    const range = document.createRange();
    range.setStart(text, start);
    range.setEnd(text, Math.min(end, text.data.length));
    const selection = window.getSelection();
    if (!selection) {
      throw new Error('expected window.getSelection');
    }
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  }

  it('shows front primary action 给我提示 after a real Range selection on the front face', () => {
    act(() => {
      root.render(<FlashcardView card={sampleCard} locale="zh-CN" />);
    });

    const front = container.querySelector('.fc-quiet-front .fc-quiet-body');
    expect(front).not.toBeNull();
    act(() => {
      selectRangeOnCardFace(front!, 0, 4);
    });

    const primary =
      container.querySelector('[data-testid="card-selection-primary"]') ??
      Array.from(container.querySelectorAll('button')).find((btn) =>
        /给我提示|Hint/i.test(btn.textContent ?? ''),
      );
    expect(primary).toBeTruthy();
    expect(primary?.textContent ?? '').toMatch(/给我提示|Hint/i);
    expect(container.querySelector('.fc-selection-pill')).toBeNull();
  });

  it('shows back primary action 讲解 after a real Range selection on the back face', () => {
    act(() => {
      root.render(<FlashcardView card={sampleCard} locale="zh-CN" />);
    });

    const cardContainer = container.querySelector('.fc-quiet-card-container');
    act(() => {
      cardContainer?.dispatchEvent(
        new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }),
      );
    });
    expect(container.querySelector('.fc-quiet-frame')?.classList.contains('is-flipped')).toBe(true);

    const back = container.querySelector('.fc-quiet-back .fc-quiet-body');
    expect(back).not.toBeNull();
    act(() => {
      selectRangeOnCardFace(back!, 0, 4);
    });

    const primary =
      container.querySelector('[data-testid="card-selection-primary"]') ??
      Array.from(container.querySelectorAll('button')).find((btn) =>
        /讲解|Explain/i.test(btn.textContent ?? ''),
      );
    expect(primary).toBeTruthy();
    expect(primary?.textContent ?? '').toMatch(/讲解|Explain/i);
    expect(primary?.textContent ?? '').not.toMatch(/给我提示|Hint/i);
  });

  it('does not flip the card when selecting text with a DOM Range', () => {
    act(() => {
      root.render(<FlashcardView card={sampleCard} locale="zh-CN" />);
    });

    const frame = container.querySelector('.fc-quiet-frame');
    const front = container.querySelector('.fc-quiet-front .fc-quiet-body');
    expect(frame?.classList.contains('is-flipped')).toBe(false);
    expect(front).not.toBeNull();

    act(() => {
      selectRangeOnCardFace(front!, 0, 4);
    });

    expect(frame?.classList.contains('is-flipped')).toBe(false);
    expect(window.getSelection()?.toString().trim().length).toBeGreaterThan(0);
  });

  it('does not flip the card when clicking text on the card face', () => {
    act(() => {
      root.render(<FlashcardView card={sampleCard} locale="zh-CN" />);
    });

    const frame = container.querySelector('.fc-quiet-frame');
    const front = container.querySelector('.fc-quiet-front .fc-quiet-body');
    expect(frame?.classList.contains('is-flipped')).toBe(false);
    expect(front).not.toBeNull();

    act(() => {
      front?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    expect(frame?.classList.contains('is-flipped')).toBe(false);
  });

  it('flips the card when Space is pressed while the card is focused', () => {
    act(() => {
      root.render(<FlashcardView card={sampleCard} locale="zh-CN" />);
    });

    const cardContainer = container.querySelector('.fc-quiet-card-container');
    const frame = container.querySelector('.fc-quiet-frame');
    expect(frame?.classList.contains('is-flipped')).toBe(false);

    act(() => {
      (cardContainer as HTMLElement | null)?.focus();
      cardContainer?.dispatchEvent(
        new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }),
      );
    });

    expect(frame?.classList.contains('is-flipped')).toBe(true);
  });
});
