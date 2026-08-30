// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import type { FlashcardItem, HostResponse } from '@piwin/contracts';
import { PIWIN_APPEARANCE_DARK } from '../../appearance-tokens';
import { FlashcardsWorkspaceView } from '../FlashcardsWorkspaceView';
import type { FlashcardsRequester, FlashcardsWorkspaceCommand } from './use-flashcards-workspace';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function flush(times = 8): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function selectSegment(root: ParentNode, value: string): void {
  const input = root.querySelector<HTMLInputElement>(`input[type="radio"][value="${value}"]`);
  input?.click();
}

async function waitForTearAdvance(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => {
      window.setTimeout(resolve, 220);
    });
  });
}

async function flushFrames(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => resolve());
      });
    });
  });
}

const CARDS: FlashcardItem[] = [
  {
    id: 'card-1',
    model: 'basic',
    deck: 'General',
    front: 'What is KV Cache?',
    back: 'Key/value activation cache.',
    createdAt: '2d',
    sequenceId: 'seq-1',
    position: 1,
  },
  {
    id: 'card-2',
    model: 'basic',
    deck: 'General',
    front: 'What is attention?',
    back: 'Weighted token mixing.',
    createdAt: '2d',
    sequenceId: 'seq-1',
    position: 2,
  },
];

function requester(): FlashcardsRequester {
  return vi.fn(async (command: FlashcardsWorkspaceCommand): Promise<HostResponse> => {
    if (command.type === 'flashcards/decks') {
      return { type: 'response', command: command.type, success: true, data: { decks: ['General'] } };
    }
    if (command.type === 'flashcards/list') {
      return { type: 'response', command: command.type, success: true, data: { cards: CARDS } };
    }
    if (command.type === 'flashcards/queue') {
      return { type: 'response', command: command.type, success: true, data: { queue: [] } };
    }
    if (command.type === 'flashcards/delete') {
      return { type: 'response', command: command.type, success: true, data: {} };
    }
    return { type: 'response', command: command.type, success: false, error: `unexpected ${command.type}` };
  });
}

describe('FlashcardsWorkspaceView browse overlay', () => {
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

  it('opens TearDeck from the library with 下一张 and 删这张, then 结束浏览 → 已浏览', async () => {
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <FlashcardsWorkspaceView locale="zh-CN" onClose={vi.fn()} request={requester()} />
        </PiwinUiProvider>,
      );
    });
    await flush();

    act(() => {
      selectSegment(container, 'library');
    });

    const open = container.querySelector<HTMLButtonElement>('[data-testid="flashcard-open-card-1"]');
    expect(open).not.toBeNull();
    act(() => {
      open?.click();
    });

    expect(container.querySelector('[data-testid="flashcards-tear"]')).not.toBeNull();
    expect(container.textContent).toContain('下一张');
    expect(container.textContent).toContain('删这张');
    expect(container.textContent).toContain('删整套');
    expect(container.textContent).not.toContain('撕掉');

    const next = container.querySelector('[data-testid="flashcards-tear-next"]');
    expect(next).not.toBeNull();
    act(() => {
      next?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await waitForTearAdvance();

    const end = container.querySelector('[data-testid="flashcards-tear-end"]');
    expect(end?.textContent).toBe('结束浏览');
    act(() => {
      end?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const completed = container.querySelector('[data-testid="flashcards-tear"]');
    expect(container.querySelector('[data-testid="flashcards-tear-completed-desc"]')?.textContent).toBe(
      '已浏览 2 张',
    );
    expect(completed?.textContent).not.toMatch(/掌握/);
  });

  it('uses English browse copy when locale is en', async () => {
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <FlashcardsWorkspaceView locale="en" onClose={vi.fn()} request={requester()} />
        </PiwinUiProvider>,
      );
    });
    await flush();

    act(() => {
      selectSegment(container, 'library');
    });
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="flashcard-open-card-1"]')?.click();
    });

    const tear = container.querySelector('[data-testid="flashcards-tear"]');
    expect(tear?.textContent).toContain('Next');
    expect(tear?.textContent).toContain('Delete this card');
    expect(tear?.textContent).toContain('Delete this set');
    expect(tear?.textContent).not.toContain('撕掉');
    expect(tear?.textContent).not.toMatch(/Mastered/i);

    act(() => {
      container.querySelector('[data-testid="flashcards-tear-next"]')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
    });
    await waitForTearAdvance();

    const end = container.querySelector('[data-testid="flashcards-tear-end"]');
    expect(end?.textContent).toBe('End browsing');
    act(() => {
      end?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.querySelector('[data-testid="flashcards-tear-completed-desc"]')?.textContent).toBe(
      'Browsed 2 cards',
    );
    expect(container.querySelector('[data-testid="flashcards-tear"]')?.textContent).not.toMatch(/Mastered/i);
  });

  it('Escape closes the overlay and restores focus to the gallery tile', async () => {
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <FlashcardsWorkspaceView locale="zh-CN" onClose={vi.fn()} request={requester()} />
        </PiwinUiProvider>,
      );
    });
    await flush();

    act(() => {
      selectSegment(container, 'library');
    });

    const open = container.querySelector<HTMLButtonElement>('[data-testid="flashcard-open-card-1"]');
    expect(open).not.toBeNull();
    act(() => {
      open?.focus();
      open?.click();
    });
    expect(container.querySelector('[data-testid="flashcards-tear"]')).not.toBeNull();

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    await flushFrames();

    expect(container.querySelector('[data-testid="flashcards-tear"]')).toBeNull();
    expect(document.activeElement?.getAttribute('data-testid')).toBe('flashcard-open-card-1');
  });
});
