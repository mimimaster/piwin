// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from '../../appearance-tokens';
import type { FlashcardItem } from '@piwin/contracts';
import { TactileStudyStage } from './TactileStudyStage';
import { flush } from '../workspace-subpages-test-helpers';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('TactileStudyStage', () => {
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
    document.body.innerHTML = '';
  });

  const sampleCards: FlashcardItem[] = [
    {
      id: 'card-1',
      model: 'basic',
      deck: 'Architecture',
      front: 'What is AGENTS.md?',
      back: 'Working rules for piwin.',
      createdAt: '2026-08-01T00:00:00Z',
    },
    {
      id: 'card-2',
      model: 'basic',
      deck: 'Architecture',
      front: 'What is the hard cap?',
      back: '1000 lines per source file.',
      createdAt: '2026-08-02T00:00:00Z',
    },
  ];

  it('reuses FlashcardFace with the question visible by default', () => {
    act(() => {
      root.render(
        <TactileStudyStage
          locale="zh-CN"
          selectedDeck="Architecture"
          cards={sampleCards}
        />,
      );
    });

    expect(container.querySelector('[data-testid="flashcards-tear-card"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="flashcards-tear-front"]')?.textContent).toContain(
      'What is AGENTS.md?',
    );
    expect(container.querySelector('[data-testid="flashcards-study-rate-bar"]')).not.toBeNull();
    expect(
      container.querySelector<HTMLButtonElement>('[data-testid="flashcards-study-rate-good"]')?.disabled,
    ).toBe(true);
  });

  it('flips to the answer on click and flips back on second click', () => {
    act(() => {
      root.render(
        <TactileStudyStage
          locale="zh-CN"
          selectedDeck="Architecture"
          cards={sampleCards}
        />,
      );
    });

    const card = container.querySelector<HTMLElement>('[data-testid="flashcards-tear-card"]');
    expect(container.querySelector('[data-testid="flashcards-tear-back"]')).toBeNull();

    act(() => {
      card?.click();
    });
    expect(container.querySelector('[data-testid="flashcards-tear-back"]')?.textContent).toContain(
      'Working rules for piwin.',
    );

    act(() => {
      card?.click();
    });
    expect(container.querySelector('[data-testid="flashcards-tear-front"]')?.textContent).toContain(
      'What is AGENTS.md?',
    );
  });

  it('flips on Space and advances on rating keys 1-4 after reveal', () => {
    act(() => {
      root.render(
        <TactileStudyStage
          locale="zh-CN"
          selectedDeck="Architecture"
          cards={sampleCards}
        />,
      );
    });

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    });
    expect(container.querySelector('[data-testid="flashcards-tear-back"]')?.textContent).toContain(
      'Working rules for piwin.',
    );

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    });
    expect(container.querySelector('[data-testid="flashcards-tear-front"]')?.textContent).toContain(
      'What is the hard cap?',
    );
  });

  it('rates with the shared study rate bar after reveal', () => {
    act(() => {
      root.render(
        <TactileStudyStage
          locale="zh-CN"
          selectedDeck="Architecture"
          cards={sampleCards}
        />,
      );
    });

    act(() => {
      container.querySelector<HTMLElement>('[data-testid="flashcards-tear-card"]')?.click();
    });

    const goodBtn = container.querySelector<HTMLButtonElement>('[data-testid="flashcards-study-rate-good"]');
    expect(goodBtn?.disabled).toBe(false);

    act(() => {
      goodBtn?.click();
    });

    expect(container.querySelector('[data-testid="flashcards-tear-front"]')?.textContent).toContain(
      'What is the hard cap?',
    );
  });
});

describe('FlashcardsStudyView Mode Separation', () => {
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
    document.body.innerHTML = '';
  });

  it('isolates Daily Review mode completely from library search and empty states', async () => {
    const { FlashcardsStudyView } = await import('./FlashcardsStudyView');
    const fakeRequest = vi.fn().mockResolvedValue({
      success: true,
      data: { cards: [], decks: [] },
    });

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <FlashcardsStudyView
            locale="zh-CN"
            request={fakeRequest}
            initialMode="study"
          />
        </PiwinUiProvider>,
      );
    });
    await flush();

    expect(container.querySelector('[data-testid="flashcards-tactile-stage"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="flashcards-tear-card"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="flashcards-library-stage"]')).toBeNull();
    expect(container.querySelector('[data-testid="flashcards-search-input"]')).toBeNull();
    expect(container.textContent).not.toContain('还没有闪卡');

    const libBtn = container.querySelector<HTMLButtonElement>('[data-testid="flashcards-mode-library"]');
    expect(libBtn).not.toBeNull();
    act(() => {
      libBtn?.click();
    });
    await flush();

    expect(container.querySelector('[data-testid="flashcards-library-stage"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="flashcards-distill-studio"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="flashcards-tactile-stage"]')).toBeNull();

    const sampleDeckBtn = container.querySelector<HTMLButtonElement>('[data-testid="flashcards-try-sample-deck"]');
    expect(sampleDeckBtn).not.toBeNull();
    act(() => {
      sampleDeckBtn?.click();
    });
    await flush();

    expect(container.querySelector('[data-testid="flashcards-tactile-stage"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="flashcards-tear-card"]')).not.toBeNull();

    const decksBtn = container.querySelector<HTMLButtonElement>('[data-testid="flashcards-mode-decks"]');
    expect(decksBtn).not.toBeNull();
    act(() => {
      decksBtn?.click();
    });
    await flush();

    expect(container.querySelector('[data-testid="flashcards-deck-grid"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="flashcards-deck-card-piwin 核心工程与规范"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="flashcards-deck-card-LLM-Wiki 与知识工程"]')).not.toBeNull();
    const createSlot = container.querySelector('[data-testid="flashcards-deck-create"]');
    expect(createSlot).not.toBeNull();
    expect(createSlot?.querySelector('.deck-add-plus')?.textContent).toBe('+');

    const studyDeckBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="flashcards-deck-study-piwin 核心工程与规范"]',
    );
    expect(studyDeckBtn).not.toBeNull();
    act(() => {
      studyDeckBtn?.click();
    });
    await flush();

    expect(container.querySelector('[data-testid="flashcards-tactile-stage"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="flashcards-tear-card"]')).not.toBeNull();
  });
});
