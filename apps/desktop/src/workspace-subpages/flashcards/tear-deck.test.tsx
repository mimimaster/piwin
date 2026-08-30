// @vitest-environment happy-dom
import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { FlashcardItem } from '@piwin/contracts';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from '../../appearance-tokens.js';
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
  unnamedDeck: '闪卡',
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

describe('TearDeck navigation copy', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('shows 下一张 for a set, not 撕掉', () => {
    const cards = [
      sampleCard({ id: 'a', sequenceId: 'seq', position: 1 }),
      sampleCard({ id: 'b', sequenceId: 'seq', position: 2, front: '第二张问题', back: '第二张答案' }),
    ];
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <TearDeck cards={cards} labels={labels} onClose={() => undefined} />
        </PiwinUiProvider>,
      );
    });

    expect(container.querySelector('[data-testid="flashcards-tear-next"]')?.textContent).toBe('下一张');
    expect(container.textContent).not.toContain('撕掉');
    expect(container.querySelector('[data-testid="flashcards-tear-end"]')).toBeNull();
  });

  it('last card uses 结束浏览 and completed page says 已浏览, never 掌握', () => {
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <TearDeck
            cards={[sampleCard()]}
            labels={labels}
            onClose={() => undefined}
            onDeleteCard={() => undefined}
          />
        </PiwinUiProvider>,
      );
    });

    const end = container.querySelector('[data-testid="flashcards-tear-end"]');
    expect(end?.textContent).toBe('结束浏览');
    expect(container.textContent).toContain('删这张');
    expect(container.querySelector('[data-testid="flashcards-tear-delete-card"]')?.className).toMatch(
      /fcws-tear-danger/,
    );
    expect(end?.className).not.toMatch(/fcws-tear-danger/);

    act(() => {
      end?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.querySelector('[data-testid="flashcards-tear-completed-desc"]')?.textContent).toBe(
      '已浏览 1 张',
    );
    expect(container.textContent).not.toMatch(/掌握/);
    expect(container.textContent).not.toContain('撕掉');
  });
});
