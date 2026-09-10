// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import type { FlashcardModel, HostResponse } from '@piwin/contracts';
import { PIWIN_APPEARANCE_DARK } from '../appearance-tokens';
import { DesktopLocaleProvider } from '../desktop-locale-context';
import { FlashcardsWorkspaceView } from './index';
import type { FlashcardsHomeCommand } from './FlashcardsWorkspaceView';
import { createStudyHostFake } from './flashcards/study/study-test-harness';
import { findButton, flush, flushLibrary, setInputValue } from './workspace-subpages-test-helpers';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type FakeStore = {
  decks: string[];
  cards: Array<{
    id: string;
    model: FlashcardModel;
    deck: string;
    front?: string;
    back?: string;
    createdAt: string;
    sequenceId?: string;
    position?: number;
  }>;
};

function makeFakeRequester(store: FakeStore): {
  request: (command: FlashcardsHomeCommand) => Promise<HostResponse>;
  calls: FlashcardsHomeCommand[];
} {
  const calls: FlashcardsHomeCommand[] = [];
  const study = createStudyHostFake(store.cards);
  const ok = (command: FlashcardsHomeCommand, data: unknown): HostResponse => ({
    type: 'response',
    command: command.type,
    success: true,
    data,
  });
  return {
    calls,
    request: vi.fn(async (command: FlashcardsHomeCommand): Promise<HostResponse> => {
      calls.push(command);
      switch (command.type) {
        case 'flashcards/decks':
          return ok(command, { decks: store.decks });
        case 'flashcards/list':
          return ok(command, { cards: store.cards });
        case 'flashcards/delete': {
          store.cards = store.cards.filter((card) => card.id !== command.cardId);
          return ok(command, {});
        }
        case 'flashcards/create': {
          store.cards.push({
            id: `card-${store.cards.length + 1}`,
            model: command.input.model ?? 'basic',
            deck: command.input.deck ?? 'General',
            ...(command.input.front !== undefined ? { front: command.input.front } : {}),
            ...(command.input.back !== undefined ? { back: command.input.back } : {}),
            createdAt: 'now',
          });
          return ok(command, { card: {} });
        }
        case 'config/get':
          return ok(command, { config: { providers: [] } });
        default:
          if (command.type.startsWith('flashcards/study/')) {
            return study.request(command);
          }
          return ok(command, {});
      }
    }),
  };
}

const BASE_STORE: FakeStore = {
  decks: ['General', 'TypeScript'],
  cards: [
    {
      id: 'card-1',
      model: 'basic',
      deck: 'General',
      front: 'What is KV Cache?',
      back: 'Key/value activation cache.',
      createdAt: '2d',
    },
    {
      id: 'card-2',
      model: 'basic',
      deck: 'TypeScript',
      front: 'useMemo vs useCallback?',
      back: 'Value vs function memoization.',
      createdAt: '3d',
    },
    {
      id: 'seq-a',
      model: 'basic',
      deck: 'OS',
      front: 'What is a page table?',
      back: 'Virtual to physical map.',
      createdAt: '4d',
      sequenceId: 'seq_os',
      position: 1,
    },
    {
      id: 'seq-b',
      model: 'basic',
      deck: 'OS',
      front: 'What is a TLB?',
      back: 'Translation lookaside buffer.',
      createdAt: '4d',
      sequenceId: 'seq_os',
      position: 2,
    },
  ],
};

describe('FlashcardsWorkspaceView', () => {
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

  async function renderWith(
    store: FakeStore,
    overrides: Partial<Parameters<typeof FlashcardsWorkspaceView>[0]> = {},
  ): Promise<ReturnType<typeof makeFakeRequester>> {
    const fake = makeFakeRequester(store);
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <DesktopLocaleProvider locale="zh-CN" onLocaleChange={() => undefined}>
            <FlashcardsWorkspaceView
              locale="zh-CN"
              onClose={vi.fn()}
              request={fake.request}
              {...overrides}
            />
          </DesktopLocaleProvider>
        </PiwinUiProvider>,
      );
    });
    await flushLibrary();
    return fake;
  }

  it('opens as a tiled library, not a review ritual', async () => {
    const fake = await renderWith(structuredClone(BASE_STORE));

    expect(fake.request).toHaveBeenCalledWith({ type: 'flashcards/decks' });
    expect(container.textContent).toContain('闪卡');
    expect(container.textContent).not.toContain('今日复习');
    expect(container.textContent).not.toContain('开始复习');
    expect(container.querySelector('[data-testid="flashcard-tile-card-1"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="flashcard-tile-seq_os"]')).not.toBeNull();
  }, 15000);

  it('exposes a native window drag region while flashcards covers shell chrome', async () => {
    await renderWith(structuredClone(BASE_STORE));

    const titlebar = container.querySelector('[data-testid="studio-topbar"]');
    const dragStrip = container.querySelector('[data-testid="studio-topbar-drag"]');
    expect(titlebar).not.toBeNull();
    expect(container.querySelector('.vault-stage')).not.toBeNull();
    expect(container.querySelector('.studio-chrome > .vault-titleband')).toBeNull();
    expect(titlebar?.hasAttribute('data-tauri-drag-region')).toBe(true);
    expect(dragStrip).not.toBeNull();
    expect(titlebar?.contains(dragStrip)).toBe(true);
    expect(dragStrip?.hasAttribute('data-tauri-drag-region')).toBe(true);
    expect(titlebar?.querySelector('[data-testid="flashcards-back-btn"]')).not.toBeNull();
    expect(titlebar?.querySelector('.vault-search')).toBeNull();
    expect(container.querySelector('.vault-filters .vault-search')).not.toBeNull();
    expect(container.querySelector('[data-testid="flashcards-open-wiki"]')).not.toBeNull();
    expect(titlebar?.querySelector('[data-testid="flashcards-open-wiki"]')).toBeNull();
    expect(
      container
        .querySelector('[data-testid="flashcards-back-btn"]')
        ?.closest('[data-no-window-drag]'),
    ).not.toBeNull();
  }, 15000);

  it('opens a set into the study page, not a dismissible overlay', async () => {
    await renderWith(structuredClone(BASE_STORE));

    const openSet = container.querySelector<HTMLButtonElement>(
      '[data-testid="flashcard-open-seq_os"]',
    );
    act(() => {
      openSet?.click();
    });
    await flush(8);

    expect(container.querySelector('[data-testid="flashcards-tear-front"]')?.textContent).toContain(
      'page table',
    );
    expect(container.querySelector('[data-testid="flashcards-study-page"]')).not.toBeNull();
    expect(container.querySelector('[role="dialog"][aria-modal="true"]')).toBeNull();
  }, 15000);

  it('deletes a tile through the host command', async () => {
    const store = structuredClone(BASE_STORE);
    const fake = await renderWith(store);

    const deleteBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="flashcard-delete-card-2"]',
    );
    act(() => {
      deleteBtn?.click();
    });
    await flushLibrary();

    expect(fake.calls).toContainEqual({ type: 'flashcards/delete', cardId: 'card-2' });
    expect(store.cards.some((card) => card.id === 'card-2')).toBe(false);
  }, 15000);

  it('creates a manual card via flashcards/create', async () => {
    const store = structuredClone(BASE_STORE);
    const fake = await renderWith(store);

    const addBtn = findButton(container, '新增');
    act(() => {
      addBtn?.click();
    });
    await flush(2);

    const dialog = document.body.querySelector('[data-testid="flashcards-create-dialog"]');
    expect(dialog).not.toBeNull();

    const textareas = dialog?.querySelectorAll('textarea') ?? [];
    act(() => {
      setInputValue(textareas[0] ?? null, 'What is Antigravity?');
      setInputValue(textareas[1] ?? null, 'An agentic pairing platform.');
    });

    const saveBtn = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.includes('保存') && !button.textContent?.includes('新增'),
    );
    act(() => {
      saveBtn?.click();
    });
    await flushLibrary();

    expect(fake.calls).toContainEqual({
      type: 'flashcards/create',
      input: expect.objectContaining({ model: 'basic', front: 'What is Antigravity?' }),
    });
  }, 15000);

  it('jumps into the knowledge-center produce loop on the same page', async () => {
    window.localStorage.removeItem('piwin.doccards.recent_folders');
    await renderWith(structuredClone(BASE_STORE));

    const produceBtn = findButton(container, '出卡');
    expect(produceBtn).toBeDefined();
    act(() => {
      produceBtn?.click();
    });
    await flush(4);

    expect(container.querySelector('[data-testid="flashcards-produce"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="knowledge-project-list"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="hero-pick-folder-btn"]')).not.toBeNull();
    expect(container.querySelector('.vault-sheet')).toBeNull();
  });

  it('does not render an in-page workspace switcher', async () => {
    await renderWith(structuredClone(BASE_STORE));

    expect(container.querySelector('[data-testid="studio-tab-images"]')).toBeNull();
    expect(container.querySelector('[data-testid="studio-tab-flashcards"]')).toBeNull();
  });

  it('filters flashcards by deck tag', async () => {
    const store = structuredClone(BASE_STORE);
    store.cards.push({
      id: 'custom-card-1',
      model: 'basic',
      deck: 'SpecialDeck',
      front: 'Special Question',
      back: 'Special Answer',
      createdAt: '2026-08-27T12:00:00.000Z',
    });
    await renderWith(store);

    const deckChip = container.querySelector<HTMLButtonElement>(
      '[data-testid="flashcards-deck-SpecialDeck"]',
    );
    expect(deckChip).not.toBeNull();
    act(() => {
      deckChip?.click();
    });
    await flush(2);

    expect(container.textContent).toContain('Special Question');
    expect(container.textContent).not.toContain('page table');
  });

  it('opens Wiki search from the gallery toolbar', async () => {
    await renderWith(structuredClone(BASE_STORE));
    const wikiBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="flashcards-open-wiki"]',
    );
    expect(wikiBtn).not.toBeNull();
    act(() => {
      wikiBtn?.click();
    });
    await flush(2);
    expect(container.querySelector('[data-testid="knowledge-wiki-view"]')).not.toBeNull();
  });
});
