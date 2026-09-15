// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import type { FlashcardModel, HostCommand, HostResponse } from '@piwin/contracts';
import { PIWIN_APPEARANCE_DARK } from '../../../appearance-tokens';
import { FlashcardsWorkspaceView } from '../../FlashcardsWorkspaceView';
import { createStudyHostFake, type StudyHarnessCard } from './study-test-harness';
import { clearStudyResumePointer, clearStudyReturnContext } from './study-return-context';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type LibraryCard = StudyHarnessCard & {
  model: FlashcardModel;
  createdAt: string;
  position?: number;
};

const CARDS: LibraryCard[] = [
  {
    id: 'seq-a',
    model: 'basic',
    deck: 'OS',
    front: 'What is a page table?',
    back: 'Virtual to physical map.',
    createdAt: '4d',
    sequenceId: 'seq_os',
    position: 1,
    sourceFile: '/Users/host/notes/page-table.md',
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
  {
    id: 'card-1',
    model: 'basic',
    deck: 'General',
    front: 'What is KV Cache?',
    back: 'Key/value activation cache.',
    createdAt: '2d',
  },
];

function ok(command: HostCommand, data: unknown): HostResponse {
  return { type: 'response', command: command.type, success: true, data };
}

function makeRequester() {
  const study = createStudyHostFake(CARDS);
  const calls: HostCommand[] = [];
  const startKeys: Array<string | undefined> = [];
  const request = vi.fn(async (command: HostCommand, options?: { idempotencyKey?: string }): Promise<HostResponse> => {
    calls.push(command);
    if (command.type === 'flashcards/study/start') {
      startKeys.push(options?.idempotencyKey);
    }
    if (command.type === 'flashcards/decks') {
      return ok(command, { decks: ['General', 'OS'] });
    }
    if (command.type === 'flashcards/list') {
      return ok(command, { cards: CARDS });
    }
    if (command.type.startsWith('flashcards/study/')) {
      return study.request(command);
    }
    return ok(command, {});
  });
  return { request, calls, study, startKeys };
}

async function flush(times = 12): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe('Flashcard study workbench', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    clearStudyReturnContext();
    clearStudyResumePointer();
    window.localStorage.removeItem('piwin.desktop.flashcardStudy.pending');
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    document.body.innerHTML = '';
    clearStudyReturnContext();
    clearStudyResumePointer();
  });

  async function renderWorkspace() {
    const fake = makeRequester();
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <FlashcardsWorkspaceView locale="zh-CN" onClose={vi.fn()} request={fake.request} />
        </PiwinUiProvider>,
      );
    });
    await flush();
    return fake;
  }

  async function openSet(): Promise<ReturnType<typeof makeRequester>> {
    const fake = await renderWorkspace();
    const openButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="flashcard-open-seq_os"]',
    );
    act(() => {
      openButton?.click();
    });
    await flush();
    return fake;
  }

  it('opens a sequence round from a set tile as a page, not an overlay', async () => {
    const fake = await openSet();
    expect(container.querySelector('[data-testid="flashcards-study-page"]')).not.toBeNull();
    expect(container.querySelector('[role="dialog"][aria-modal="true"]')).toBeNull();
    expect(container.querySelector('[data-testid="flashcards-tear-front"]')?.textContent).toContain(
      'page table',
    );
    expect(container.querySelector('.fcws-tear-source-line')?.textContent).toContain('page-table.md');
    expect(container.querySelector('.fcws-tear-source-line')?.textContent).not.toContain('/Users/host');
    expect(fake.calls.some((command) => command.type === 'flashcards/study/start')).toBe(true);
    const start = fake.calls.find((command) => command.type === 'flashcards/study/start');
    expect(start).toMatchObject({
      type: 'flashcards/study/start',
      mode: 'sequence',
      scope: { kind: 'sequence', sequenceId: 'seq_os' },
    });
    expect(fake.startKeys[0]?.length).toBeGreaterThan(0);
  });

  it('opens a sequence round from a single card tile', async () => {
    const fake = await renderWorkspace();
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="flashcard-open-card-1"]')?.click();
    });
    await flush();
    const start = fake.calls.find((command) => command.type === 'flashcards/study/start');
    expect(start).toMatchObject({
      mode: 'sequence',
      scope: { kind: 'item', itemId: 'card-1' },
    });
    expect(container.querySelector('[data-testid="flashcards-study-page"]')).not.toBeNull();
  });

  it('opens a scheduled round from 待复习', async () => {
    const fake = await renderWorkspace();
    expect(container.querySelector('[data-testid="flashcards-study-due"]')?.textContent).toContain('待复习');
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="flashcards-study-due"]')?.click();
    });
    await flush();
    const start = fake.calls.find((command) => command.type === 'flashcards/study/start');
    expect(start).toMatchObject({
      mode: 'scheduled',
      scope: { kind: 'all' },
    });
    expect(container.querySelector('[data-testid="flashcards-study-page"]')).not.toBeNull();
  });

  it('flips without tearing and tears once on next', async () => {
    const fake = await openSet();
    act(() => {
      const buttons = Array.from(container.querySelectorAll('button'));
      buttons.find((button) => button.textContent?.includes('解答'))?.click();
    });
    await flush();
    expect(container.querySelector('[data-testid="flashcards-tear-back"]')?.textContent).toContain(
      'physical map',
    );
    expect(container.querySelector('.fcws-tear-card.is-tearing')).toBeNull();
    expect(fake.calls.filter((command) => command.type === 'flashcards/study/next')).toHaveLength(0);

    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="flashcards-tear-next"]')?.click();
    });
    await flush();
    expect(fake.calls.filter((command) => command.type === 'flashcards/study/next')).toHaveLength(1);
    expect(container.querySelector('.fcws-tear-card.is-tearing')).not.toBeNull();
    const under = container.querySelector('[data-testid="flashcards-study-under-shell"]');
    expect(under).not.toBeNull();
    expect(under?.closest('.fcws-tear-under')).not.toBeNull();
    expect(under?.textContent ?? '').not.toMatch(/page table|TLB|physical map/);
    await act(async () => {
      await new Promise((resolve) => {
        window.setTimeout(resolve, 280);
      });
    });
    await flush();
    expect(container.querySelector('.fcws-tear-card.is-tearing')).toBeNull();
    expect(container.querySelector('[data-testid="flashcards-tear-front"]')?.textContent).toContain('TLB');
  });

  it('rates once on double-click in scheduled mode and tears', async () => {
    const fake = await renderWorkspace();
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="flashcards-study-due"]')?.click();
    });
    await flush();
    act(() => {
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent?.includes('解答'))
        ?.click();
    });
    await flush();
    const good = container.querySelector<HTMLButtonElement>('[data-testid="flashcards-study-rate-good"]');
    act(() => {
      good?.click();
      good?.click();
    });
    await flush();
    expect(fake.calls.filter((command) => command.type === 'flashcards/study/rate')).toHaveLength(1);
    expect(container.querySelector('.fcws-tear-card.is-tearing')).not.toBeNull();
  });

  it('double-clicks next once', async () => {
    const fake = await openSet();
    const next = container.querySelector<HTMLButtonElement>('[data-testid="flashcards-tear-next"]');
    act(() => {
      next?.click();
      next?.click();
    });
    await flush();
    expect(fake.calls.filter((command) => command.type === 'flashcards/study/next')).toHaveLength(1);
  });

  it('closes an overlay on the first Esc, then leaves study', async () => {
    await openSet();
    const endBtn = container.querySelector<HTMLButtonElement>('[data-testid="flashcards-study-end"]');
    expect(endBtn).not.toBeNull();
    act(() => {
      endBtn?.click();
    });
    await flush();
    expect(document.body.querySelector('[data-testid="flashcards-study-end-confirm"]')).not.toBeNull();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await flush();
    expect(document.body.querySelector('[data-testid="flashcards-study-end-confirm"]')).toBeNull();
    expect(container.querySelector('[data-testid="flashcards-study-page"]')).not.toBeNull();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await flush(16);
    expect(container.querySelector('[data-testid="flashcards-study-page"]')).toBeNull();
    expect(container.querySelector('[data-testid="flashcards-workspace"]')).not.toBeNull();
  });

  it('does not flip or rate while the end-round overlay is open', async () => {
    const fake = await openSet();
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="flashcards-study-end"]')?.click();
    });
    await flush();
    expect(document.body.querySelector('[data-testid="flashcards-study-end-confirm"]')).not.toBeNull();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '3', bubbles: true }));
    });
    await flush();
    expect(container.querySelector('[data-testid="flashcards-tear-front"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="flashcards-tear-back"]')).toBeNull();
    expect(fake.calls.filter((command) => command.type === 'flashcards/study/next')).toHaveLength(0);
    expect(fake.calls.filter((command) => command.type === 'flashcards/study/rate')).toHaveLength(0);
    expect(fake.calls.filter((command) => command.type === 'flashcards/study/checkpoint')).toHaveLength(0);
  });

  it('restores ReturnContext after leaving study', async () => {
    await renderWorkspace();
    const search = container.querySelector<HTMLInputElement>('.vault-search input');
    act(() => {
      if (!search) return;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      setter?.call(search, 'page');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await flush();
    const osChip = container.querySelector<HTMLButtonElement>('[data-testid="flashcards-deck-OS"]');
    act(() => {
      osChip?.click();
    });
    await flush();
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="flashcard-open-seq_os"]')?.click();
    });
    await flush();
    expect(container.querySelector('[data-testid="flashcards-study-page"]')).not.toBeNull();
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="flashcards-study-back-btn"]')?.click();
    });
    await flush(16);
    expect(container.querySelector('[data-testid="flashcards-study-page"]')).toBeNull();
    expect(container.querySelector<HTMLInputElement>('.vault-search input')?.value).toBe('page');
    expect(
      container.querySelector('[data-testid="flashcards-deck-OS"]')?.className,
    ).toMatch(/is-on/);
  });

  it('has no pause button; leaving saves and re-entering resumes the same card and face', async () => {
    const fake = await openSet();
    expect(container.querySelector('[data-testid="flashcards-study-pause"]')).toBeNull();
    act(() => {
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent?.includes('解答'))
        ?.click();
    });
    await flush();
    expect(container.querySelector('[data-testid="flashcards-tear-back"]')).not.toBeNull();

    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="flashcards-study-back-btn"]')?.click();
    });
    await flush(16);
    expect(container.querySelector('[data-testid="flashcards-study-page"]')).toBeNull();
    expect(fake.calls.filter((command) => command.type === 'flashcards/study/pause')).toHaveLength(1);

    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="flashcard-open-seq_os"]')?.click();
    });
    await flush(16);
    expect(fake.calls.filter((command) => command.type === 'flashcards/study/resume')).toHaveLength(1);
    expect(container.querySelector('[data-testid="flashcards-study-paused"]')).toBeNull();
    expect(container.querySelector('[data-testid="flashcards-tear-back"]')?.textContent).toContain(
      'physical map',
    );
  });

  it('flips when the card body is clicked', async () => {
    await openSet();
    const content = container.querySelector<HTMLElement>('[data-testid="flashcards-tear-front"]');
    expect(content).not.toBeNull();
    act(() => {
      content?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }));
      content?.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 10, clientY: 10 }));
    });
    await flush();
    expect(container.querySelector('[data-testid="flashcards-tear-back"]')?.textContent).toContain(
      'physical map',
    );
  });

  it('keeps the rate bar in place before reveal and enables it after', async () => {
    await renderWorkspace();
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="flashcards-study-due"]')?.click();
    });
    await flush();
    const good = container.querySelector<HTMLButtonElement>('[data-testid="flashcards-study-rate-good"]');
    expect(good).not.toBeNull();
    expect(good?.disabled).toBe(true);
    act(() => {
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent?.includes('解答'))
        ?.click();
    });
    await flush();
    expect(
      container.querySelector<HTMLButtonElement>('[data-testid="flashcards-study-rate-good"]')?.disabled,
    ).toBe(false);
  });

  it('undoes the last advance', async () => {
    await openSet();
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="flashcards-tear-next"]')?.click();
    });
    await flush();
    await act(async () => {
      await new Promise((resolve) => {
        window.setTimeout(resolve, 280);
      });
    });
    await flush();
    expect(container.querySelector('[data-testid="flashcards-tear-front"]')?.textContent).toContain('TLB');
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="flashcards-study-undo"]')?.click();
    });
    await flush();
    expect(container.querySelector('[data-testid="flashcards-tear-front"]')?.textContent).toContain(
      'page table',
    );
  });
});
