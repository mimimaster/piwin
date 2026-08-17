// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from '../appearance-tokens.js';
import { KnowledgeCardsView, type KnowledgeCardsViewProps } from './KnowledgeCardsView.js';

describe('KnowledgeCardsView', () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const mockCards = [
    {
      id: 'card-1',
      front: 'What is Piwin architecture?',
      back: 'Host-first with Node sidecar and Tauri desktop.',
      deck: 'piwin',
      tags: ['arch'],
      sourceFolder: '/Users/test/piwin',
      sourceFile: 'AGENTS.md',
      sourceLine: 12,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];

  it('renders card gallery and triggers batch generation', () => {
    const onStartGen = vi.fn();
    const props: KnowledgeCardsViewProps = {
      folderPath: '/Users/test/piwin',
      folderName: 'piwin',
      cards: mockCards,
      generationJob: null,
      busy: false,
      request: vi.fn().mockResolvedValue({ success: true, data: {} }),
      onStartGeneration: onStartGen,
    };

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <KnowledgeCardsView {...props} />
        </PiwinUiProvider>,
      );
    });

    expect(container.textContent).toContain('What is Piwin architecture?');

    const genBtn = container.querySelector<HTMLButtonElement>('[data-testid="generate-cards-btn"]');
    expect(genBtn).not.toBeNull();
    act(() => {
      genBtn?.click();
    });
    expect(onStartGen).toHaveBeenCalledTimes(1);
  });

  it('switches to FSRS review mode and flips card', () => {
    const props: KnowledgeCardsViewProps = {
      folderPath: '/Users/test/piwin',
      folderName: 'piwin',
      cards: mockCards,
      generationJob: null,
      busy: false,
      request: vi.fn().mockResolvedValue({ success: true, data: {} }),
      onStartGeneration: vi.fn(),
    };

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <KnowledgeCardsView {...props} />
        </PiwinUiProvider>,
      );
    });

    const reviewBtn = container.querySelector<HTMLButtonElement>('[data-testid="review-mode-btn"]');
    expect(reviewBtn).not.toBeNull();
    act(() => {
      reviewBtn?.click();
    });

    expect(container.querySelector('[data-testid="fsrs-review-container"]')).not.toBeNull();
    expect(container.textContent).toContain('点击或按空格翻转查看答案');

    // Click card to flip
    const cardEl = container.querySelector<HTMLElement>('.fsrs-review-card');
    act(() => {
      cardEl?.click();
    });
    expect(container.textContent).toContain('Host-first with Node sidecar and Tauri desktop.');
    expect(container.textContent).toContain('重来');
    expect(container.textContent).toContain('简单');
  });

  it('offers opening the review session created by generate', () => {
    const onOpenSession = vi.fn();
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <KnowledgeCardsView
            folderPath="/docs"
            folderName="docs"
            cards={mockCards}
            generationJob={{
              id: 'gen_1',
              folderKey: 'k',
              folderPath: '/docs',
              workspaceName: 'docs',
              includeFiles: [],
              status: 'COMPLETED',
              sessionId: 'session-1',
            }}
            busy={false}
            request={vi.fn().mockResolvedValue({ success: true, data: {} })}
            onStartGeneration={vi.fn()}
            onOpenSession={onOpenSession}
          />
        </PiwinUiProvider>,
      );
    });
    const button = container.querySelector<HTMLButtonElement>(
      '[data-testid="open-review-session-btn"]',
    );
    expect(button).not.toBeNull();
    act(() => {
      button?.click();
    });
    expect(onOpenSession).toHaveBeenCalledWith('session-1');
  });
});
