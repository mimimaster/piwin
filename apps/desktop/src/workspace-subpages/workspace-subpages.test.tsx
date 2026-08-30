// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import type { FlashcardModel, HostCommand, HostResponse, MediaLibraryItem } from '@piwin/contracts';
import { PIWIN_APPEARANCE_DARK } from '../appearance-tokens';
import { LibraryWorkspaceView, FlashcardsWorkspaceView } from './index';
import type { FlashcardsHomeCommand } from './FlashcardsWorkspaceView';
import { createStudyHostFake } from './flashcards/study/study-test-harness';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function setInputValue(input: HTMLInputElement | HTMLTextAreaElement | null, value: string): void {
  if (!input) return;
  const proto =
    input instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function findButton(root: ParentNode, text: string): HTMLButtonElement | undefined {
  return Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((b) =>
    b.textContent?.includes(text),
  );
}

/** Drain the microtask queue after fake-requester resolves. */
async function flush(times = 8): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await Promise.resolve();
    });
  }
}

/** media/list is debounced 200ms before the host request. */
async function flushLibrary(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => {
      window.setTimeout(resolve, 220);
    });
  });
  await flush(12);
}

function makeLibraryItem(overrides: Partial<MediaLibraryItem> = {}): MediaLibraryItem {
  return {
    assetId: 'asset-1',
    sessionId: 'sess-1',
    mimeType: 'image/png',
    byteSize: 2048,
    createdAt: '2026-08-27T12:00:00.000Z',
    kind: 'image',
    prompt: 'neon street',
    model: 'flux',
    ...overrides,
  };
}

function makeMediaListRequester(items: MediaLibraryItem[]): {
  request: (command: HostCommand) => Promise<HostResponse>;
  calls: HostCommand[];
} {
  const calls: HostCommand[] = [];
  return {
    calls,
    request: vi.fn(async (command: HostCommand): Promise<HostResponse> => {
      calls.push(command);
      if (command.type === 'media/delete') {
        const index = items.findIndex(
          (item) =>
            item.sessionId === command.input.sessionId && item.assetId === command.input.assetId,
        );
        if (index >= 0) {
          items.splice(index, 1);
        }
        return {
          type: 'response',
          command: 'media/delete',
          success: true,
          data: {
            deleted: index >= 0,
            sessionId: command.input.sessionId,
            assetId: command.input.assetId,
          },
        };
      }
      if (command.type !== 'media/list') {
        return { type: 'response', command: command.type, success: false, error: 'unexpected' };
      }
      const query = command.input.query?.trim().toLowerCase() ?? '';
      const kind = command.input.kind;
      const filtered = items.filter((item) => {
        if (kind !== undefined && item.kind !== kind) {
          return false;
        }
        return query === '' || item.prompt?.toLowerCase().includes(query) === true;
      });
      return {
        type: 'response',
        command: 'media/list',
        success: true,
        data: { items: filtered, total: filtered.length },
      };
    }),
  };
}

describe('LibraryWorkspaceView', () => {
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

  function render(overrides: Partial<Parameters<typeof LibraryWorkspaceView>[0]> = {}): void {
    const request = overrides.request ?? makeMediaListRequester([]).request;
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <LibraryWorkspaceView
            locale="zh-CN"
            onClose={vi.fn()}
            request={request}
            {...overrides}
          />
        </PiwinUiProvider>,
      );
    });
  }

  it('renders library chrome and closes via back button', async () => {
    const onClose = vi.fn();
    render({ onClose });
    await flushLibrary();

    expect(container.textContent).toContain('图片');
    expect(container.textContent).toContain('资料库');
    expect(container.querySelector('[data-testid="library-search"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="library-new-btn"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="library-sort-btn"]')).not.toBeNull();
    expect(container.querySelector('.lib-composer')).toBeNull();
    expect(container.querySelector('[data-testid="composer-input"]')).toBeNull();
    expect(container.querySelector('.vault-bar.is-page')).not.toBeNull();

    const backBtn = container.querySelector<HTMLButtonElement>('[data-testid="library-back-btn"]');
    expect(backBtn).not.toBeNull();
    act(() => {
      backBtn?.click();
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('sends the header search to media/list', async () => {
    const fake = makeMediaListRequester([makeLibraryItem()]);
    render({ request: fake.request });
    await flushLibrary();

    const input = container.querySelector<HTMLInputElement>('[data-testid="library-search"]');
    expect(input).not.toBeNull();
    act(() => {
      setInputValue(input, 'neon');
    });
    await flushLibrary();

    expect(
      fake.calls.some(
        (command) => command.type === 'media/list' && command.input.query === 'neon',
      ),
    ).toBe(true);
  });

  it('returns to chat from New → generate', async () => {
    const onClose = vi.fn();
    render({
      onClose,
      request: makeMediaListRequester([makeLibraryItem()]).request,
    });
    await flushLibrary();

    const newBtn = container.querySelector<HTMLButtonElement>('[data-testid="library-new-btn"]');
    expect(newBtn).not.toBeNull();
    act(() => {
      newBtn?.dispatchEvent(
        new window.PointerEvent('pointerdown', { bubbles: true, cancelable: true }),
      );
      newBtn?.dispatchEvent(
        new window.PointerEvent('pointerup', { bubbles: true, cancelable: true }),
      );
      newBtn?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    const generate = document.querySelector<HTMLElement>('[data-testid="library-new-image"]');
    expect(generate).not.toBeNull();
    act(() => {
      generate?.click();
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('exposes a native window drag region while the library covers shell chrome', async () => {
    render();
    await flushLibrary();

    const titlebar = container.querySelector('[data-testid="studio-topbar"]');
    const dragStrip = container.querySelector('[data-testid="studio-topbar-drag"]');
    expect(titlebar).not.toBeNull();
    expect(container.querySelector('.vault-stage')).not.toBeNull();
    expect(titlebar?.hasAttribute('data-tauri-drag-region')).toBe(true);
    expect(dragStrip).not.toBeNull();
    expect(dragStrip?.hasAttribute('data-tauri-drag-region')).toBe(true);
    expect(
      container.querySelector('[data-testid="library-back-btn"]')?.closest('[data-no-window-drag]'),
    ).not.toBeNull();
  });

  it('lists host vault images instead of the demo set', async () => {
    render({ request: makeMediaListRequester([makeLibraryItem()]).request });
    await flushLibrary();

    expect(container.querySelector('[data-testid="image-card-asset-1"]')).not.toBeNull();
    expect(container.textContent).toContain('neon street');
    expect(container.textContent).not.toContain('Unsplash');
  });

  it('does not fetch original media bytes for gallery tiles', async () => {
    const fake = makeMediaListRequester([makeLibraryItem()]);
    render({ request: fake.request });
    await flushLibrary();
    expect(fake.calls.filter((command) => command.type === 'media/read')).toEqual([]);
  });

  it('opens the lightbox with image details when a card is clicked', async () => {
    render({ request: makeMediaListRequester([makeLibraryItem()]).request });
    await flushLibrary();

    const card = container.querySelector<HTMLDivElement>('[data-testid="image-card-asset-1"]');
    expect(card).not.toBeNull();
    act(() => {
      card?.focus();
      card?.click();
    });
    await flush(2);

    expect(document.body.textContent).toContain('图片详情');
    expect(document.body.textContent).toContain('flux');
    expect(document.body.textContent).not.toContain('填入输入框');
    expect(document.body.textContent).not.toContain('Use in composer');
    expect(container.querySelector('[role="dialog"][aria-modal="true"]')).not.toBeNull();
    expect(container.querySelector('.lib-canvas .vault-look-back')).not.toBeNull();
    expect(document.activeElement?.classList.contains('media-lightbox-close')).toBe(true);

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    await flush(2);
    expect(container.querySelector('[data-testid="images-lightbox"]')).toBeNull();
    expect(document.activeElement).toBe(card);
  });

  it('shows an empty library when the vault has no images', async () => {
    render({ request: makeMediaListRequester([]).request });
    await flushLibrary();
    expect(container.textContent).toContain('还没有图片');
  });

  it('deletes a tile through media/delete and removes the card', async () => {
    const items = [makeLibraryItem()];
    const fake = makeMediaListRequester(items);
    render({ request: fake.request });
    await flushLibrary();

    const deleteBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="media-delete-asset-1"]',
    );
    expect(deleteBtn).not.toBeNull();
    act(() => {
      deleteBtn?.click();
    });
    await flush(8);

    expect(fake.calls).toContainEqual({
      type: 'media/delete',
      input: { sessionId: 'sess-1', assetId: 'asset-1' },
    });
    expect(container.querySelector('[data-testid="image-card-asset-1"]')).toBeNull();
    expect(container.textContent).toContain('还没有图片');
  });

  it('filters images and videos in-page without leaving the library', async () => {
    const items = [
      makeLibraryItem(),
      makeLibraryItem({
        assetId: 'vid-1',
        kind: 'video',
        mimeType: 'video/mp4',
        prompt: 'drone valley',
      }),
    ];
    render({ request: makeMediaListRequester(items).request });
    await flushLibrary();

    expect(container.querySelector('[data-testid="library-tab-all"]')).toBeNull();
    expect(container.querySelector('[data-testid="library-tab-file"]')).toBeNull();
    expect(container.querySelector('[data-testid="library-tab-images"]')?.getAttribute('aria-pressed')).toBe(
      'true',
    );

    // Defaults to Images: image card is present, video is filtered out
    expect(container.querySelector('[data-testid="image-card-asset-1"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="video-card-vid-1"]')).toBeNull();

    // Switch to Videos tab
    const videoTab = container.querySelector<HTMLButtonElement>(
      '[data-testid="library-tab-videos"]',
    );
    expect(videoTab).not.toBeNull();
    act(() => {
      videoTab?.click();
    });
    await flushLibrary();
    expect(container.querySelector('[data-testid="image-card-asset-1"]')).toBeNull();
    expect(container.querySelector('[data-testid="video-card-vid-1"]')).not.toBeNull();

    // Switch back to Images tab
    const imagesTab = container.querySelector<HTMLButtonElement>(
      '[data-testid="library-tab-images"]',
    );
    expect(imagesTab).not.toBeNull();
    act(() => {
      imagesTab?.click();
    });
    await flushLibrary();
    expect(container.querySelector('[data-testid="image-card-asset-1"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="video-card-vid-1"]')).toBeNull();
  });

  it('renders a flat photo grid without magazine chrome', async () => {
    render({ request: makeMediaListRequester([makeLibraryItem()]).request });
    await flushLibrary();

    expect(container.querySelector('.lib-grid')).not.toBeNull();
    expect(container.querySelector('[data-testid="library-search"]')).not.toBeNull();
    expect(container.textContent).not.toContain('生成内容库');
    expect(container.textContent).not.toContain('CREATIVE VAULT');
    expect(container.querySelector('.studio-page-intro')).toBeNull();
    expect(findButton(container, '小')).toBeUndefined();
    expect(container.querySelector('.lib-inspiration-wrap')).toBeNull();
    expect(container.textContent).not.toContain('✦');
  });

  it('toggles batch mode and displays batch toolbar', async () => {
    render({ request: makeMediaListRequester([makeLibraryItem()]).request });
    await flushLibrary();

    const batchBtn = findButton(container, '批量管理');
    expect(batchBtn).toBeDefined();
    act(() => {
      batchBtn?.click();
    });
    await flushLibrary();

    expect(container.querySelector('.lib-batch-bar')).not.toBeNull();
    expect(container.textContent).toContain('退出管理');
    expect(container.querySelector('.lib-card-batch-cb')).not.toBeNull();
  });

  it('toggles inspector drawer and displays asset parameters', async () => {
    render({ request: makeMediaListRequester([makeLibraryItem()]).request });
    await flushLibrary();

    expect(container.querySelector('[data-testid="library-inspector-drawer"]')).toBeNull();

    const inspectorToggleBtn = container.querySelector<HTMLButtonElement>(
      'button[title="切换属性面板"]',
    );
    expect(inspectorToggleBtn).not.toBeNull();
    act(() => {
      inspectorToggleBtn?.click();
    });
    await flush(4);

    expect(container.querySelector('[data-testid="library-inspector-drawer"]')).not.toBeNull();
    expect(container.textContent).toContain('资产检查器');
    expect(container.textContent).toContain('flux');
  });
});

describe('LibraryWorkspaceView videos tab', () => {
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

  function render(overrides: Partial<Parameters<typeof LibraryWorkspaceView>[0]> = {}): void {
    const request = overrides.request ?? makeMediaListRequester([]).request;
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <LibraryWorkspaceView
            locale="en"
            onClose={vi.fn()}
            request={request}
            initialKind="video"
            {...overrides}
          />
        </PiwinUiProvider>,
      );
    });
  }

  it('renders studio chrome and an empty library', async () => {
    render();
    await flushLibrary();
    expect(container.textContent).toContain('Videos');
    expect(container.textContent).toContain('No videos yet');
  });

  it('opens the theater modal with video details', async () => {
    render({
      request: makeMediaListRequester([
        makeLibraryItem({
          assetId: 'vid-1',
          kind: 'video',
          mimeType: 'video/mp4',
          prompt: 'drone valley',
          model: 'kling',
        }),
      ]).request,
    });
    await flushLibrary();

    const card = container.querySelector<HTMLDivElement>('[data-testid="video-card-vid-1"]');
    expect(card).not.toBeNull();
    act(() => {
      card?.click();
    });

    expect(document.body.textContent).toContain('Video details');
    expect(document.body.textContent).toContain('kling');
    expect(container.querySelector('video')?.autoplay).toBe(false);
  });
});

/* ── Flashcards: real host-command flow with an injected requester ──── */

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
          store.cards = store.cards.filter((c) => c.id !== command.cardId);
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
          <FlashcardsWorkspaceView
            locale="zh-CN"
            onClose={vi.fn()}
            request={fake.request}
            {...overrides}
          />
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
    expect(titlebar?.hasAttribute('data-tauri-drag-region')).toBe(true);
    expect(dragStrip).not.toBeNull();
    expect(dragStrip?.hasAttribute('data-tauri-drag-region')).toBe(true);
    expect(
      container
        .querySelector('[data-testid="flashcards-back-btn"]')
        ?.closest('[data-no-window-drag]'),
    ).not.toBeNull();
  }, 15000);

  it('opens a set into the study page, not a dismissible overlay', async () => {
    await renderWith(structuredClone(BASE_STORE));

    const setTile = container.querySelector<HTMLButtonElement>(
      '[data-testid="flashcard-tile-seq_os"] .fcws-tile-face',
    );
    act(() => {
      setTile?.click();
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
    expect(store.cards.some((c) => c.id === 'card-2')).toBe(false);
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
      (b) => b.textContent?.includes('保存') && !b.textContent?.includes('新增'),
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
});
