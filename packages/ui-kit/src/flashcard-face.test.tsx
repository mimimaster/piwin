// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PiwinUiProvider } from './piwin-ui-provider.js';
import { FlashcardFace } from './flashcard-face.js';
import { TearDeckSurface, FLASHCARD_TEAR_DURATION_MS } from './tear-deck-surface.js';
import { TEST_THEME_DARK } from './test-theme-fixtures.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SRC_DIR = dirname(fileURLToPath(import.meta.url));

function renderWithProvider(child: ReactElement): string {
  return renderToStaticMarkup(
    createElement(PiwinUiProvider, { manifest: TEST_THEME_DARK, children: child }),
  );
}

describe('FlashcardFace', () => {
  it('keeps the existing tear-card class contract', () => {
    const markup = renderWithProvider(
      createElement(FlashcardFace, {
        revealed: true,
        tearing: true,
        deckName: '生物',
        tag: createElement('span', { className: 'fcws-tear-tag' }, '#cell'),
        indexTag: createElement('span', { className: 'fcws-tear-index-tag' }, '#1'),
        content: 'front text',
        contentTestId: 'flashcards-tear-back',
        source: createElement('div', { className: 'fcws-tear-source-line' }, 'notes.md'),
      }),
    );
    expect(markup).toContain('fcws-tear-card');
    expect(markup).toContain('is-tearing');
    expect(markup).toContain('is-revealed');
    expect(markup).toContain('fcws-tear-deck-name');
    expect(markup).toContain('fcws-tear-tag');
    expect(markup).toContain('fcws-tear-index-tag');
    expect(markup).toContain('fc-quiet-text-zone');
    expect(markup).toContain('data-testid="flashcards-tear-back"');
    expect(markup).toContain('fcws-tear-source-line');
  });

  describe('whole-card click flips', () => {
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
      window.getSelection()?.removeAllRanges();
    });

    function renderFace(onFlip: () => void): void {
      act(() => {
        root.render(
          createElement(PiwinUiProvider, {
            manifest: TEST_THEME_DARK,
            children: createElement(FlashcardFace, {
              deckName: 'deck',
              onFlip,
              content: createElement(
                'p',
                null,
                'question text ',
                createElement('a', { href: 'https://example.com', id: 'face-link' }, 'link'),
              ),
            }),
          }),
        );
      });
    }

    function press(target: Element, x: number, y: number): void {
      act(() => {
        target.dispatchEvent(
          new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y }),
        );
      });
    }

    function click(target: Element, x: number, y: number): void {
      act(() => {
        target.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }));
      });
    }

    it('flips when the content body is clicked', () => {
      const flips: number[] = [];
      renderFace(() => flips.push(1));
      const paragraph = container.querySelector('.fcws-tear-content p');
      expect(paragraph).not.toBeNull();
      press(paragraph as Element, 10, 10);
      click(paragraph as Element, 12, 11);
      expect(flips).toHaveLength(1);
    });

    it('does not flip after a drag', () => {
      const flips: number[] = [];
      renderFace(() => flips.push(1));
      const paragraph = container.querySelector('.fcws-tear-content p') as Element;
      press(paragraph, 10, 10);
      click(paragraph, 60, 12);
      expect(flips).toHaveLength(0);
    });

    it('does not flip when text inside the card is selected', () => {
      const flips: number[] = [];
      renderFace(() => flips.push(1));
      const paragraph = container.querySelector('.fcws-tear-content p') as Element;
      const textNode = paragraph.firstChild;
      expect(textNode).not.toBeNull();
      const range = document.createRange();
      range.setStart(textNode as Node, 0);
      range.setEnd(textNode as Node, 5);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      press(paragraph, 10, 10);
      click(paragraph, 10, 10);
      expect(flips).toHaveLength(0);
    });

    it('does not flip when a link inside the card is clicked', () => {
      const flips: number[] = [];
      renderFace(() => flips.push(1));
      const link = container.querySelector('#face-link') as Element;
      press(link, 10, 10);
      click(link, 10, 10);
      expect(flips).toHaveLength(0);
    });
  });

  it('does not import Host or filesystem APIs', () => {
    const face = readFileSync(join(SRC_DIR, 'flashcard-face.tsx'), 'utf8');
    const surface = readFileSync(join(SRC_DIR, 'tear-deck-surface.tsx'), 'utf8');
    for (const source of [face, surface]) {
      expect(source).not.toMatch(/@piwin\/host-client/);
      expect(source).not.toMatch(/@piwin\/host-runtime/);
      expect(source).not.toMatch(/node:fs/);
      expect(source).not.toMatch(/from 'fs'/);
    }
  });
});

describe('TearDeckSurface', () => {
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

  it('does not replay the same transitionId', () => {
    const seen: string[] = [];
    const face = createElement(FlashcardFace, {
      tearing: true,
      deckName: 'deck',
      content: 'Q',
    });
    act(() => {
      root.render(
        createElement(PiwinUiProvider, {
          manifest: TEST_THEME_DARK,
          children: createElement(TearDeckSurface, {
            tearing: true,
            transitionId: 'round-1:2',
            current: face,
            onTransitionEnd: (id) => seen.push(id),
          }),
        }),
      );
    });
    const stage = container.querySelector('.fcws-tear-stage');
    const card = container.querySelector('.fcws-tear-card');
    expect(stage).not.toBeNull();
    expect(card).not.toBeNull();
    act(() => {
      card?.dispatchEvent(new Event('animationend', { bubbles: true }));
      card?.dispatchEvent(new Event('animationend', { bubbles: true }));
    });
    expect(seen).toEqual(['round-1:2']);
  });

  it('settles immediately under reduced motion', () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) =>
      ({
        matches: query.includes('prefers-reduced-motion'),
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
        onchange: null,
      })) as typeof window.matchMedia;
    const seen: string[] = [];
    try {
      act(() => {
        root.render(
          createElement(PiwinUiProvider, {
            manifest: TEST_THEME_DARK,
            children: createElement(TearDeckSurface, {
              tearing: true,
              transitionId: 'round-9:4',
              current: createElement(FlashcardFace, {
                tearing: true,
                deckName: 'deck',
                content: 'Q',
              }),
              onTransitionEnd: (id) => seen.push(id),
            }),
          }),
        );
      });
      expect(seen).toEqual(['round-9:4']);
      expect(FLASHCARD_TEAR_DURATION_MS).toBe(200);
    } finally {
      window.matchMedia = original;
    }
  });

  it('does not hide the whole under-shell card', () => {
    const css = readFileSync(join(SRC_DIR, 'flashcards.css'), 'utf8');
    expect(css).not.toMatch(/\.fcws-tear-under \.fcws-tear-card \{\s*visibility:\s*hidden;\s*\}/);
    expect(css).toMatch(/\.fcws-tear-under \.fcws-tear-card \{[\s\S]*?visibility:\s*visible;/);
  });

  it('does not render an under-shell node unless provided', () => {
    const markup = renderWithProvider(
      createElement(TearDeckSurface, {
        current: createElement(FlashcardFace, { deckName: 'deck', content: 'Q' }),
      }),
    );
    expect(markup).toContain('data-testid="flashcards-tear"');
    expect(markup).not.toContain('fcws-tear-under');
    expect(markup).not.toContain('has-under-shell');
  });
});
