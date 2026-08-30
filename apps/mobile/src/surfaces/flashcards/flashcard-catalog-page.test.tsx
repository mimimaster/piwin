// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import type { HostCommand, HostResponse } from '@piwin/contracts';
import { MOBILE_THEME } from '../../mobile-theme.js';
import { FlashcardCatalogPage } from './FlashcardCatalogPage.js';
import { createStudyHostFake } from './study-test-harness.js';
import { stripHostAbsolutePaths } from './catalog-paths.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function flush(times = 10): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe('FlashcardCatalogPage', () => {
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

  it('omits Host absolute paths from catalog tiles', async () => {
    const fake = createStudyHostFake([]);
    const onOpenStudy = vi.fn();
    act(() => {
      root.render(
        <PiwinUiProvider manifest={MOBILE_THEME}>
          <FlashcardCatalogPage
            request={fake.request}
            connected
            hasStudyCapability={() => true}
            onOpenStudy={onOpenStudy}
            onBack={vi.fn()}
          />
        </PiwinUiProvider>,
      );
    });
    await flush();
    expect(container.textContent).not.toContain('/Users/host');
    expect(container.textContent).not.toContain('.piwin');
    expect(container.textContent).toContain('What is a page table?');
    const leaked = {
      tiles: [{ kind: 'single' as const, id: 'x', count: 1, preview: 'Q', deck: '/tmp/host' }],
      dueCount: 0,
      newCount: 0,
      unfinishedRounds: [],
    };
    expect(JSON.stringify(stripHostAbsolutePaths(leaked))).not.toContain('/tmp/host');
  });

  it('starts a sequence round from a set tile after Host validation', async () => {
    const fake = createStudyHostFake([
      { id: 'seq-a', front: 'What is a page table?', sequenceId: 'seq_os', deck: 'OS' },
    ]);
    const onOpenStudy = vi.fn();
    act(() => {
      root.render(
        <PiwinUiProvider manifest={MOBILE_THEME}>
          <FlashcardCatalogPage
            request={async (command: HostCommand): Promise<HostResponse> => fake.request(command)}
            connected
            hasStudyCapability={() => true}
            onOpenStudy={onOpenStudy}
            onBack={vi.fn()}
          />
        </PiwinUiProvider>,
      );
    });
    await flush();
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="flashcard-tile-seq_os"]')?.click();
    });
    await flush();
    expect(fake.calls.some((command) => command.type === 'flashcards/study/start')).toBe(true);
    expect(onOpenStudy).toHaveBeenCalledWith('round-1');
  });

  it('explains disconnected and old-Host states with a way back', async () => {
    const onBack = vi.fn();
    act(() => {
      root.render(
        <PiwinUiProvider manifest={MOBILE_THEME}>
          <FlashcardCatalogPage
            request={async () => ({
              type: 'response',
              command: 'flashcards/study/catalog',
              success: false,
              error: 'old',
            })}
            connected={false}
            hasStudyCapability={() => false}
            onOpenStudy={vi.fn()}
            onBack={onBack}
          />
        </PiwinUiProvider>,
      );
    });
    await flush();
    expect(container.querySelector('[data-testid="flashcards-catalog-disconnected"]')).not.toBeNull();
    expect(container.textContent).toContain('未连接 Host');
  });

  it('does not invent a study entry when Host is too old', async () => {
    const onOpenStudy = vi.fn();
    act(() => {
      root.render(
        <PiwinUiProvider manifest={MOBILE_THEME}>
          <FlashcardCatalogPage
            request={async () => ({
              type: 'response',
              command: 'flashcards/study/catalog',
              success: false,
              error: 'old',
              problem: { code: 'host-too-old' },
            })}
            connected
            hasStudyCapability={() => false}
            onOpenStudy={onOpenStudy}
            onBack={vi.fn()}
          />
        </PiwinUiProvider>,
      );
    });
    await flush();
    expect(container.querySelector('[data-testid="flashcards-catalog-host-old"]')).not.toBeNull();
    expect(onOpenStudy).not.toHaveBeenCalled();
  });
});
