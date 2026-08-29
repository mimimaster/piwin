// @vitest-environment happy-dom
/**
 * Target shared-tutor contract for TearDeck selection (PR0 red).
 * Pins replaceable `.fc-selection-pill` / clipboard path.
 * Loading / ready / error panel assertions wait for Host stubs in PR2–PR3.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { FlashcardItem, HostCommand, HostResponse } from '@piwin/contracts';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from '../../appearance-tokens.js';
import { CardTutorProvider } from '../../flashcards/card-tutor-provider';
import { TearDeck, type TearDeckLabels } from './tear-deck';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const labels: TearDeckLabels = {
  flipHint: 'Space 翻面',
  tear: '下一张',
  lastCard: '结束浏览',
  close: '关闭',
  deleteCard: '删这张',
  deleteSet: '删整套',
  answer: '解答',
  question: '提问',
  remaining: (count) => `剩余 ${count}`,
  revealShortcut: 'Space',
  nextShortcut: 'Enter',
  completedTitle: '本套已浏览完',
  completedDescription: (count) => `已浏览 ${count} 张`,
  restart: '再看一遍',
};

function sampleCard(overrides: Partial<FlashcardItem> = {}): FlashcardItem {
  return {
    id: 'tear-1',
    model: 'basic',
    deck: '生物',
    front: '什么是光合作用？',
    back: '植物利用光能将二氧化碳和水转化为有机物的过程。',
    createdAt: '2026-08-18T00:00:00.000Z',
    ...overrides,
  };
}

function firstTextNode(rootEl: ParentNode): Text {
  const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT);
  const node = walker.nextNode();
  if (!(node instanceof Text) || node.textContent.trim().length === 0) {
    throw new Error('expected a non-empty text node on the tear card face');
  }
  return node;
}

function selectRange(face: Element, start: number, end: number): void {
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

describe('TearDeck shared selection tutor contract', () => {
  let container: HTMLDivElement;
  let root: Root;
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
  });

  afterEach(() => {
    window.getSelection()?.removeAllRanges();
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
  });

  function renderDeck(node: ReactElement): void {
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>{node}</PiwinUiProvider>,
      );
    });
  }

  it('selection → shared popover primary (给我提示 on front), not .fc-selection-pill', () => {
    renderDeck(
      <TearDeck cards={[sampleCard()]} labels={labels} onClose={() => undefined} />,
    );

    const face =
      container.querySelector('[data-testid="flashcards-tear-front"]') ??
      container.querySelector('.fcws-tear-content');
    expect(face).not.toBeNull();

    act(() => {
      selectRange(face!, 0, 4);
    });

    expect(container.querySelector('.fc-selection-pill')).toBeNull();

    const primary =
      document.querySelector('[data-testid="card-selection-primary"]') ??
      container.querySelector('[data-testid="card-selection-primary"]') ??
      Array.from(document.querySelectorAll('button')).find(
        (btn) =>
          /给我提示|Hint/i.test(btn.textContent ?? '') &&
          btn.getAttribute('data-testid') !== 'card-tutor-fallback',
      );
    expect(primary).toBeTruthy();
    expect(primary?.textContent ?? '').toMatch(/给我提示|Hint/i);
  });

  it('selection help must not write clipboard or copy a prompt toast', async () => {
    renderDeck(
      <TearDeck cards={[sampleCard()]} labels={labels} onClose={() => undefined} />,
    );

    const face =
      container.querySelector('[data-testid="flashcards-tear-front"]') ??
      container.querySelector('.fcws-tear-content');
    expect(face).not.toBeNull();

    act(() => {
      selectRange(face!, 0, 4);
    });

    const help =
      document.querySelector('[data-testid="card-selection-primary"]') ??
      container.querySelector('[data-testid="card-selection-primary"]') ??
      container.querySelector('.fc-selection-pill') ??
      Array.from(document.querySelectorAll('button')).find(
        (btn) =>
          /给我提示|Hint|讲解|Explain/i.test(btn.textContent ?? '') &&
          btn.getAttribute('data-testid') !== 'card-tutor-fallback',
      );
    expect(help).toBeTruthy();

    await act(async () => {
      help?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    expect(writeText).not.toHaveBeenCalled();
    expect(container.textContent ?? '').not.toMatch(/已复制追问指令/);
  });

  it('selection → popover invoke shows Host ready markdown in the tutor panel', async () => {
    const request = vi.fn(async (command: HostCommand): Promise<HostResponse> => {
      if (command.type === 'flashcards/cancel-explanation') {
        return { type: 'response', command: command.type, success: true, data: { cancelled: true } };
      }
      if (command.type !== 'flashcards/explain-selection') {
        return { type: 'response', command: command.type, success: false, error: 'unexpected' };
      }
      return {
        type: 'response',
        command: command.type,
        success: true,
        data: {
          explanationId: command.input.explanationId,
          itemId: command.input.itemId,
          selectedText: command.input.selectedText,
          intent: command.input.intent,
          markdown: '这是一条短提示。',
        },
      };
    });

    renderDeck(
      <CardTutorProvider request={request} locale="zh-CN">
        <TearDeck cards={[sampleCard()]} labels={labels} onClose={() => undefined} />
      </CardTutorProvider>,
    );

    const face =
      container.querySelector('[data-testid="flashcards-tear-front"]') ??
      container.querySelector('.fcws-tear-content');
    act(() => {
      selectRange(face!, 0, 4);
    });
    const primary = document.querySelector('[data-testid="card-selection-primary"]');
    await act(async () => {
      primary?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    expect(container.querySelector('[data-testid="card-tutor-ready"]')).not.toBeNull();
    expect(container.textContent).toContain('这是一条短提示。');
    expect(writeText).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'flashcards/explain-selection' }),
    );
  });

  it('selection → Host error shows retry without clipboard', async () => {
    const request = vi.fn(async (command: HostCommand): Promise<HostResponse> => {
      if (command.type === 'flashcards/cancel-explanation') {
        return { type: 'response', command: command.type, success: true, data: { cancelled: true } };
      }
      return {
        type: 'response',
        command: command.type,
        success: false,
        error: 'flashcard-selection-provider-failed',
        problem: { code: 'flashcard-selection-provider-failed' },
      };
    });

    renderDeck(
      <CardTutorProvider request={request} locale="zh-CN">
        <TearDeck cards={[sampleCard()]} labels={labels} onClose={() => undefined} />
      </CardTutorProvider>,
    );

    const face =
      container.querySelector('[data-testid="flashcards-tear-front"]') ??
      container.querySelector('.fcws-tear-content');
    act(() => {
      selectRange(face!, 0, 4);
    });
    const primary = document.querySelector('[data-testid="card-selection-primary"]');
    await act(async () => {
      primary?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    expect(container.querySelector('[data-testid="card-tutor-error"]')).not.toBeNull();
    expect(container.textContent).toMatch(/重试/);
    expect(container.textContent ?? '').not.toContain('flashcard-selection-provider-failed');
    expect(writeText).not.toHaveBeenCalled();
  });
});
