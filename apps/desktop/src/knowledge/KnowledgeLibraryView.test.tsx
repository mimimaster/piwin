// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from '../appearance-tokens.js';
import { KnowledgeLibraryView } from './KnowledgeLibraryView.js';

describe('KnowledgeLibraryView', () => {
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

  const cards = [
    {
      id: 'card-1',
      model: 'basic' as const,
      front: 'What is the loop?',
      back: 'Pick, index, generate, review.',
      deck: 'os',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];

  it('renders the gallery without in-panel FSRS', () => {
    const onOpenCardsPanel = vi.fn();
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <KnowledgeLibraryView
            folderPath="/notes/os"
            folderName="os"
            cards={cards}
            request={vi.fn().mockResolvedValue({ success: true, data: {} }) as any}
            onBack={() => undefined}
            onOpenCardsPanel={onOpenCardsPanel}
          />
        </PiwinUiProvider>,
      );
    });
    expect(container.textContent).toContain('What is the loop?');
    expect(container.querySelector('[data-testid="review-mode-btn"]')).toBeNull();
    expect(container.querySelector('[data-testid="fsrs-review-container"]')).toBeNull();
    expect(container.querySelector('[data-testid="export-anki-btn"]')).not.toBeNull();
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="open-due-review-btn"]')?.click();
    });
    expect(onOpenCardsPanel).toHaveBeenCalledTimes(1);
  });

  it('forgets folder cards after confirm', async () => {
    const request = vi.fn().mockResolvedValue({ success: true, data: { deleted: 1 } });
    const onForgot = vi.fn();
    await act(async () => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <KnowledgeLibraryView
            folderPath="/notes/os"
            folderName="os"
            cards={cards}
            request={request as any}
            onBack={() => undefined}
            onForgot={onForgot}
          />
        </PiwinUiProvider>,
      );
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="library-forget-btn"]')?.click();
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-testid="confirm-dialog-confirm"]')?.click();
    });
    expect(request).toHaveBeenCalledWith({ type: 'doccards/forget-folder', folderPath: '/notes/os' });
    expect(onForgot).toHaveBeenCalledTimes(1);
  });
});
