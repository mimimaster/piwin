// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FlashcardFace, PiwinUiProvider, TearDeckSurface } from '@piwin/ui-kit';
import { MOBILE_THEME } from './mobile-theme.js';

describe('mobile flashcard face smoke', () => {
  it('renders ui-kit FlashcardFace without importing apps/desktop', () => {
    const markup = renderToStaticMarkup(
      createElement(PiwinUiProvider, {
        manifest: MOBILE_THEME,
        children: createElement(TearDeckSurface, {
          current: createElement(FlashcardFace, {
            deckName: 'srs',
            content: 'question',
            contentTestId: 'flashcards-tear-front',
          }),
        }),
      }),
    );
    expect(markup).toContain('fcws-tear-card');
    expect(markup).toContain('flashcards-tear-front');
    expect(markup).not.toContain('apps/desktop');
  });
});
