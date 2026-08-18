// @vitest-environment happy-dom
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FlashcardItem } from '@piwin/contracts';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens.js';
import { DesktopLocaleProvider } from './desktop-locale-context';
import { DocCardSequenceView, sortSequenceCards } from './DocCardSequenceView';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function card(id: string, position: number, extra: Partial<FlashcardItem> = {}): FlashcardItem {
  return {
    id,
    model: 'basic',
    deck: 'Notes',
    front: `front-${id}`,
    back: `back-${id}`,
    createdAt: '2026-08-16T00:00:00.000Z',
    position,
    ...extra,
  };
}

function renderView(node: ReactElement): { container: HTMLDivElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(node);
  });
  return { container, root };
}

describe('sortSequenceCards', () => {
  it('skips deleted snapshot ids and sorts by position', () => {
    expect(
      sortSequenceCards([card('c2', 2), card('c1', 1), card('gone', 3)], ['c1', 'c2']).map(
        (item) => item.cardId,
      ),
    ).toEqual(['c1', 'c2']);
  });
});

describe('DocCardSequenceView', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    if (root && container) {
      act(() => root?.unmount());
      container.remove();
    }
    root = undefined;
    container = undefined;
  });

  it('loads live cards and flips without extra list writes', async () => {
    const request = vi.fn(async (command: { type: string }) => {
      if (command.type === 'flashcards/list') {
        return {
          type: 'response' as const,
          command: command.type,
          success: true as const,
          data: { cards: [card('c1', 1), card('c2', 2)] },
        };
      }
      return { type: 'response' as const, command: command.type, success: true as const };
    });
    ({ root, container } = renderView(
      <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
        <DesktopLocaleProvider locale="en" onLocaleChange={() => undefined}>
          <DocCardSequenceView
            sequence={{
              sequenceId: 'seq_1',
              generationId: 'gen_1',
              workspaceName: 'Notes',
              cardIds: ['c1', 'c2'],
            }}
            request={request}
          />
        </DesktopLocaleProvider>
      </PiwinUiProvider>,
    ));
    await act(async () => {
      await Promise.resolve();
    });
    expect(container?.querySelector('[data-testid="doc-card-sequence-front"]')?.textContent).toBe(
      'front-c1',
    );
    act(() => {
      container?.querySelector<HTMLButtonElement>('[data-testid="doc-card-sequence-next"]')?.click();
    });
    expect(container?.querySelector('[data-testid="doc-card-sequence-front"]')?.textContent).toBe(
      'front-c2',
    );
    expect(request.mock.calls.every((call) => call[0]?.type !== 'session/prompt')).toBe(true);
    expect(request.mock.calls.filter((call) => call[0]?.type === 'flashcards/list')).toHaveLength(1);
  });

  it('shows empty state when every snapshot card is gone', async () => {
    const request = vi.fn(async () => ({
      type: 'response' as const,
      command: 'flashcards/list',
      success: true as const,
      data: { cards: [] },
    }));
    ({ root, container } = renderView(
      <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
        <DesktopLocaleProvider locale="en" onLocaleChange={() => undefined}>
          <DocCardSequenceView
            sequence={{
              sequenceId: 'seq_1',
              generationId: 'gen_1',
              workspaceName: 'Notes',
              cardIds: ['missing'],
            }}
            request={request}
          />
        </DesktopLocaleProvider>
      </PiwinUiProvider>,
    ));
    await act(async () => {
      await Promise.resolve();
    });
    expect(container?.querySelector('[data-testid="doc-card-sequence-empty"]')).not.toBeNull();
  });
});
