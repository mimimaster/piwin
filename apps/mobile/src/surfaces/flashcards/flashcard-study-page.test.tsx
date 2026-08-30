// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import type { HostCommand, HostResponse } from '@piwin/contracts';
import { createMemoryFlashcardStudyPendingStore } from '@piwin/host-client';
import { MOBILE_THEME } from '../../mobile-theme.js';
import { FlashcardStudyPage } from './FlashcardStudyPage.js';
import { createStudyHostFake } from './study-test-harness.js';
import { clearMobileStudyReturnContext } from './study-return-context.js';
import {
  historyStateHasFlashcardsOverlay,
  navigateMobileFlashcardsRoute,
} from '../../mobile-flashcards-route.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CARDS = [
  {
    id: 'seq-a',
    front: 'What is a page table?',
    back: 'Virtual to physical map.',
    sequenceId: 'seq_os',
    deck: 'OS',
    sourceFile: '/Users/host/notes/page-table.md',
  },
  { id: 'seq-b', front: 'What is a TLB?', back: 'Translation lookaside buffer.', sequenceId: 'seq_os', deck: 'OS' },
];

async function flush(times = 14): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe('FlashcardStudyPage', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    clearMobileStudyReturnContext();
    window.localStorage.removeItem('piwin.mobile.flashcardStudy.pending');
    history.replaceState(null, '', `${window.location.pathname}${window.location.search}#flashcards/study/round-1`);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    document.body.innerHTML = '';
    clearMobileStudyReturnContext();
  });

  async function renderStudy(options?: {
    throwOnNext?: boolean;
    hasControl?: boolean;
    missing?: boolean;
  }) {
    const fake = createStudyHostFake(CARDS, { throwOnNext: options?.throwOnNext === true });
    if (!options?.missing) {
      await fake.request({
        type: 'flashcards/study/start',
        mode: 'sequence',
        scope: { kind: 'sequence', sequenceId: 'seq_os' },
        resumeExisting: false,
      });
      if (options?.hasControl === false) fake.setHasControl('round-1', false);
    }
    const pending = createMemoryFlashcardStudyPendingStore();
    act(() => {
      root.render(
        <PiwinUiProvider manifest={MOBILE_THEME}>
          <FlashcardStudyPage
            roundId="round-1"
            returnSource="catalog"
            onLeave={vi.fn()}
            ports={{
              request: async (command: HostCommand): Promise<HostResponse> => fake.request(command),
              hasStudyCapability: () => true,
              pending,
            }}
          />
        </PiwinUiProvider>,
      );
    });
    await flush();
    return fake;
  }

  it('opens a Host round as a page and flips without tearing or history spam', async () => {
    const lengthBefore = history.length;
    const fake = await renderStudy();
    expect(container.querySelector('[data-testid="flashcards-study-page"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="flashcards-tear-front"]')?.textContent).toContain(
      'page table',
    );
    expect(container.querySelector('[data-testid="flashcards-study-source"]')?.textContent).toContain(
      'page-table.md',
    );
    expect(container.querySelector('[data-testid="flashcards-study-source"]')?.textContent).not.toContain(
      '/Users/host',
    );
    act(() => {
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent?.includes('解答'))
        ?.click();
    });
    await flush();
    expect(container.querySelector('[data-testid="flashcards-tear-back"]')?.textContent).toContain(
      'physical map',
    );
    expect(container.querySelector('.fcws-tear-card.is-tearing')).toBeNull();
    expect(fake.calls.filter((command) => command.type === 'flashcards/study/next')).toHaveLength(0);
    expect(history.length).toBe(lengthBefore);
    expect(window.location.hash).toBe('#flashcards/study/round-1');
  });

  it('tears once after Host next and keeps a blank incoming under-shell', async () => {
    const fake = await renderStudy();
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="flashcards-tear-next"]')?.click();
    });
    await flush();
    expect(fake.calls.filter((command) => command.type === 'flashcards/study/next')).toHaveLength(1);
    expect(container.querySelector('.fcws-tear-card.is-tearing')).not.toBeNull();
    const under = container.querySelector('[data-testid="flashcards-study-under-shell"]');
    expect(under).not.toBeNull();
    expect(under?.textContent ?? '').not.toMatch(/page table|TLB|physical map/);
  });

  it('shows pending-confirmation when a next request does not confirm', async () => {
    await renderStudy({ throwOnNext: true });
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="flashcards-tear-next"]')?.click();
    });
    await flush();
    expect(container.querySelector('[data-testid="flashcards-study-pending"]')).not.toBeNull();
    expect(container.textContent).toContain('结果待确认');
  });

  it('is read-only after control is claimed elsewhere', async () => {
    await renderStudy({ hasControl: false });
    expect(container.querySelector('[data-testid="flashcards-study-readonly"]')).not.toBeNull();
    expect(container.textContent).toContain('已在另一设备继续');
    expect(container.textContent).toContain('在本设备继续');
  });

  it('closes the end-round overlay on system back without leaving study', async () => {
    await renderStudy();
    navigateMobileFlashcardsRoute({ kind: 'study', roundId: 'round-1' }, 'replace');
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="flashcards-study-end"]')?.click();
    });
    await flush();
    expect(container.querySelector('[data-testid="flashcards-study-end-confirm"]')).not.toBeNull();
    expect(historyStateHasFlashcardsOverlay(history.state)).toBe(true);
    expect(window.location.hash).toBe('#flashcards/study/round-1');

    act(() => {
      history.back();
    });
    await flush();
    expect(container.querySelector('[data-testid="flashcards-study-end-confirm"]')).toBeNull();
    expect(container.querySelector('[data-testid="flashcards-study-page"]')).not.toBeNull();
    expect(window.location.hash).toBe('#flashcards/study/round-1');
  });

  it('pauses the round when system back leaves study, and does not double-pause', async () => {
    history.replaceState(null, '', `${window.location.pathname}${window.location.search}#flashcards`);
    navigateMobileFlashcardsRoute({ kind: 'study', roundId: 'round-1' }, 'push');
    const fake = await renderStudy();
    expect(fake.calls.filter((command) => command.type === 'flashcards/study/pause')).toHaveLength(0);

    act(() => {
      history.back();
    });
    await flush();
    expect(window.location.hash).toBe('#flashcards');
    expect(fake.calls.filter((command) => command.type === 'flashcards/study/pause')).toHaveLength(1);

    act(() => {
      history.back();
    });
    await flush();
    expect(fake.calls.filter((command) => command.type === 'flashcards/study/pause')).toHaveLength(1);
  });

  it('does not pause when system back only closes the end-round overlay', async () => {
    const fake = await renderStudy();
    navigateMobileFlashcardsRoute({ kind: 'study', roundId: 'round-1' }, 'replace');
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="flashcards-study-end"]')?.click();
    });
    await flush();
    act(() => {
      history.back();
    });
    await flush();
    expect(window.location.hash).toBe('#flashcards/study/round-1');
    expect(fake.calls.filter((command) => command.type === 'flashcards/study/pause')).toHaveLength(0);
  });

  it('consumes the overlay history entry when confirming 结束本轮 so the next back leaves', async () => {
    history.replaceState(null, '', `${window.location.pathname}${window.location.search}#flashcards`);
    navigateMobileFlashcardsRoute({ kind: 'study', roundId: 'round-1' }, 'push');
    const fake = await renderStudy();
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="flashcards-study-end"]')?.click();
    });
    await flush();
    expect(historyStateHasFlashcardsOverlay(history.state)).toBe(true);

    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="flashcards-study-end-confirm-btn"]')?.click();
    });
    await flush();
    expect(container.querySelector('[data-testid="flashcards-study-end-confirm"]')).toBeNull();
    expect(historyStateHasFlashcardsOverlay(history.state)).toBe(false);
    expect(window.location.hash).toBe('#flashcards/study/round-1');
    expect(fake.calls.filter((command) => command.type === 'flashcards/study/end')).toHaveLength(1);

    act(() => {
      history.back();
    });
    await flush();
    expect(window.location.hash).toBe('#flashcards');
  });

  it('explains a missing round with a way back', async () => {
    await renderStudy({ missing: true });
    expect(container.querySelector('[data-testid="flashcards-study-missing"]')).not.toBeNull();
    expect(container.textContent).toContain('找不到这一轮');
  });
});
