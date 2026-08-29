// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import type { FlashcardModel, HostResponse } from '@piwin/contracts';
import { PIWIN_APPEARANCE_DARK } from '../appearance-tokens';
import {
  ImagesWorkspaceView,
  VideosWorkspaceView,
  FlashcardsWorkspaceView,
} from './index';
import type { FlashcardsWorkspaceCommand } from './flashcards/use-flashcards-workspace';

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

/** Select an option on a ui-kit/Mantine SegmentedControl (radio inputs). */
function selectSegment(root: ParentNode, value: string): void {
  const input = root.querySelector<HTMLInputElement>(`input[type="radio"][value="${value}"]`);
  if (!input) return;
  // React binds radio onChange to click; happy-dom forwards it from here.
  input.click();
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

describe('ImagesWorkspaceView', () => {
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

  function render(overrides: Partial<Parameters<typeof ImagesWorkspaceView>[0]> = {}): void {
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <ImagesWorkspaceView locale="zh-CN" onClose={vi.fn()} {...overrides} />
        </PiwinUiProvider>,
      );
    });
  }

  it('renders studio chrome and closes via back button', () => {
    const onClose = vi.fn();
    render({ onClose });

    expect(container.textContent).toContain('图片工作室');

    const backBtn = container.querySelector<HTMLButtonElement>('[data-testid="images-back-btn"]');
    expect(backBtn).not.toBeNull();
    act(() => {
      backBtn?.click();
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('sends the composed command to chat and closes', () => {
    const onClose = vi.fn();
    const onSendToChat = vi.fn();
    render({ onClose, onSendToChat });

    const textarea = container.querySelector<HTMLTextAreaElement>(
      '[data-testid="images-prompt-input"]',
    );
    expect(textarea).not.toBeNull();
    act(() => {
      setInputValue(textarea ?? null, 'Cyberpunk rainy street');
    });

    const inChatBtn = findButton(container, '在会话生成');
    expect(inChatBtn).toBeDefined();
    act(() => {
      inChatBtn?.click();
    });

    expect(onSendToChat).toHaveBeenCalledWith(
      expect.stringContaining('/image Cyberpunk rainy street --ar 1:1'),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('opens the lightbox with image details when a card is clicked', () => {
    render();

    const card = container.querySelector<HTMLDivElement>('[data-testid="image-card-img-1"]');
    expect(card).not.toBeNull();
    act(() => {
      card?.click();
    });

    expect(document.body.textContent).toContain('图片详情');
    expect(document.body.textContent).toContain('Flux-1.1 Pro');
  });

  it('appends a generated placeholder card to the library', async () => {
    vi.useFakeTimers();
    try {
      render();
      const before = container.querySelectorAll('[data-testid^="image-card-"]').length;

      const textarea = container.querySelector<HTMLTextAreaElement>(
        '[data-testid="images-prompt-input"]',
      );
      act(() => {
        setInputValue(textarea ?? null, 'A lighthouse in fog');
      });
      const generateBtn = findButton(container, '立即生成');
      act(() => {
        generateBtn?.click();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });

      const after = container.querySelectorAll('[data-testid^="image-card-"]').length;
      expect(after).toBe(before + 1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('VideosWorkspaceView', () => {
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

  function render(overrides: Partial<Parameters<typeof VideosWorkspaceView>[0]> = {}): void {
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <VideosWorkspaceView locale="en" onClose={vi.fn()} {...overrides} />
        </PiwinUiProvider>,
      );
    });
  }

  it('renders studio chrome, modes, and duration controls', () => {
    render();

    expect(container.textContent).toContain('Videos Studio');
    expect(container.textContent).toContain('Text to Video');
    expect(container.textContent).toContain('5s');
    expect(container.textContent).toContain('FPV Drone');
  });

  it('sends the composed video command to chat', () => {
    const onSendToChat = vi.fn();
    render({ onSendToChat });

    const textarea = container.querySelector<HTMLTextAreaElement>(
      '[data-testid="videos-prompt-input"]',
    );
    act(() => {
      setInputValue(textarea ?? null, 'Drone soaring through mountains');
    });

    const inChatBtn = findButton(container, 'In Chat');
    act(() => {
      inChatBtn?.click();
    });

    expect(onSendToChat).toHaveBeenCalledWith(
      expect.stringContaining('/video Drone soaring through mountains --mode text-to-video'),
    );
  });

  it('opens the theater modal with video details', () => {
    render();

    const card = container.querySelector<HTMLDivElement>('[data-testid="video-card-vid-1"]');
    expect(card).not.toBeNull();
    act(() => {
      card?.click();
    });

    expect(document.body.textContent).toContain('Video details');
    expect(document.body.textContent).toContain('Runway Gen-3');
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
  }>;
  queue: Array<{
    card: {
      cardId: string;
      itemId: string;
      model: FlashcardModel;
      ordinal: number;
      deck: string;
      front: string;
      back: string;
      createdAt: string;
    };
    state: { cardId: string; due: string; stability: number; difficulty: number; reps: number; lapses: number };
    isNew: boolean;
  }>;
};

function makeFakeRequester(store: FakeStore): {
  request: (command: FlashcardsWorkspaceCommand) => Promise<HostResponse>;
  calls: FlashcardsWorkspaceCommand[];
} {
  const calls: FlashcardsWorkspaceCommand[] = [];
  const ok = (command: FlashcardsWorkspaceCommand, data: unknown): HostResponse => ({
    type: 'response',
    command: command.type,
    success: true,
    data,
  });
  return {
    calls,
    request: vi.fn(async (command: FlashcardsWorkspaceCommand): Promise<HostResponse> => {
      calls.push(command);
      switch (command.type) {
        case 'flashcards/decks':
          return ok(command, { decks: store.decks });
        case 'flashcards/list':
          return ok(command, { cards: store.cards });
        case 'flashcards/queue':
          return ok(command, { queue: store.queue });
        case 'flashcards/rate': {
          const entry = store.queue.find((q) => q.card.cardId === command.cardId);
          if (entry !== undefined) store.queue = store.queue.filter((q) => q !== entry);
          return ok(command, {});
        }
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
        default:
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
  ],
  queue: [
    {
      card: {
        cardId: 'rc-1',
        itemId: 'card-1',
        model: 'basic',
        ordinal: 0,
        deck: 'General',
        front: 'What is KV Cache?',
        back: 'Key/value activation cache for attention.',
        createdAt: '2d',
      },
      state: {
        cardId: 'rc-1',
        due: '2026-01-01T00:00:00Z',
        stability: 1,
        difficulty: 5,
        reps: 0,
        lapses: 0,
      },
      isNew: true,
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
          <FlashcardsWorkspaceView locale="zh-CN" onClose={vi.fn()} request={fake.request} {...overrides} />
        </PiwinUiProvider>,
      );
    });
    await flush();
    return fake;
  }

  it('loads overview numbers, deck list, and start-review hero from the host', async () => {
    const fake = await renderWith(structuredClone(BASE_STORE));

    expect(fake.request).toHaveBeenCalledWith({ type: 'flashcards/decks' });
    expect(container.textContent).toContain('闪卡记忆中心');
    expect(container.textContent).toContain('开始复习');
    expect(container.textContent).toContain('全部卡组');
    expect(container.textContent).toContain('General');
    expect(container.textContent).toContain('TypeScript');
  }, 15000);

  it('reviews: reveal answer then rate advances and finishes the queue', async () => {
    const store = structuredClone(BASE_STORE);
    const fake = await renderWith(store);

    const startBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="flashcards-review-start"]',
    );
    expect(startBtn).not.toBeNull();
    act(() => {
      startBtn?.click();
    });
    await flush(2);

    expect(
      container.querySelector('[data-testid="flashcards-review-front"]')?.textContent,
    ).toContain('What is KV Cache?');

    const flipCard = container.querySelector<HTMLButtonElement>(
      '[data-testid="flashcards-review-flip"]',
    );
    act(() => {
      flipCard?.click();
    });

    expect(
      container.querySelector('[data-testid="flashcards-review-back"]')?.textContent,
    ).toContain('attention');

    // Rate "good" (3rd button)
    const goodBtn = findButton(container, '记住了');
    expect(goodBtn).toBeDefined();
    act(() => {
      goodBtn?.click();
    });
    await flush();

    const rateCall = fake.calls.find((c) => c.type === 'flashcards/rate');
    expect(rateCall).toMatchObject({ type: 'flashcards/rate', cardId: 'rc-1', rating: 'good' });

    // Queue exhausted → completion surface, host reloaded
    expect(container.textContent).toContain('今日复习已全部完成');
    expect(fake.calls.filter((c) => c.type === 'flashcards/queue').length).toBeGreaterThanOrEqual(2);
  }, 15000);

  it('library lists rows and deletes through the host command', async () => {
    const store = structuredClone(BASE_STORE);
    const fake = await renderWith(store);

    act(() => {
      selectSegment(container, 'library');
    });

    expect(
      container.querySelector('[data-testid="flashcard-row-card-2"]'),
    ).not.toBeNull();

    const deleteBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="flashcard-row-card-2"] .fcws-card-delete',
    );
    act(() => {
      deleteBtn?.click();
    });
    await flush();

    expect(fake.calls).toContainEqual({ type: 'flashcards/delete', cardId: 'card-2' });
    expect(store.cards.some((c) => c.id === 'card-2')).toBe(false);
  }, 15000);

  it('creates a manual card via flashcards/create', async () => {
    const store = structuredClone(BASE_STORE);
    const fake = await renderWith(store);

    const addBtn = findButton(container, '新增卡片');
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
      (b) => b.textContent?.includes('保存卡片'),
    );
    act(() => {
      saveBtn?.click();
    });
    await flush();

    expect(fake.calls).toContainEqual({
      type: 'flashcards/create',
      input: expect.objectContaining({ model: 'basic', front: 'What is Antigravity?' }),
    });
  }, 15000);

  it('AI generation hands off to chat and closes the page', async () => {
    const store = structuredClone(BASE_STORE);
    const onSendToChat = vi.fn();
    const onClose = vi.fn();
    await renderWith(store, { onSendToChat, onClose });

    const aiBtn = findButton(container, 'AI 生成');
    act(() => {
      aiBtn?.click();
    });
    await flush(2);

    const topicBox = document.body.querySelector<HTMLTextAreaElement>(
      '[data-testid="flashcards-generate-dialog"] textarea',
    );
    act(() => {
      setInputValue(topicBox ?? null, 'Transformer attention');
    });

    const genBtn = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => b.textContent?.includes('在会话中生成'),
    );
    act(() => {
      genBtn?.click();
    });

    expect(onSendToChat).toHaveBeenCalledWith('/doccards generate "Transformer attention"');
    expect(onClose).toHaveBeenCalled();
  }, 15000);
});
