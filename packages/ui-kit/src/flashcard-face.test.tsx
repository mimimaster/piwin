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
