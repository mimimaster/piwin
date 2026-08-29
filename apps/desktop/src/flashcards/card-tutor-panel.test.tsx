// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import type { HostCommand, HostResponse } from '@piwin/contracts';
import { PIWIN_APPEARANCE_DARK } from '../appearance-tokens';
import { CardTutorPanel } from './card-tutor-panel';
import { CardTutorProvider, useCardTutor } from './card-tutor-provider';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Seed(): ReactElement {
  const tutor = useCardTutor();
  return (
    <button
      type="button"
      data-testid="seed-explain"
      onClick={() =>
        void tutor.explain({
          itemId: 'card-1',
          face: 'back',
          selectedText: '光合',
          intent: 'explain',
        })
      }
    >
      seed
    </button>
  );
}

describe('CardTutorPanel make-card draft', () => {
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

  it('enables 做成新卡 and expands the shared editor with zh defaults', async () => {
    const request = vi.fn(async (command: HostCommand): Promise<HostResponse> => {
      if (command.type === 'flashcards/cancel-explanation' || command.type === 'flashcards/decks') {
        return { type: 'response', command: command.type, success: true, data: { decks: ['生物'] } };
      }
      if (command.type === 'flashcards/explain-selection') {
        return {
          type: 'response',
          command: command.type,
          success: true,
          data: {
            explanationId: command.input.explanationId,
            itemId: command.input.itemId,
            selectedText: command.input.selectedText,
            intent: command.input.intent,
            markdown: '植物把光能变成化学能。',
          },
        };
      }
      return { type: 'response', command: command.type, success: false, error: 'unexpected' };
    });

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <CardTutorProvider request={request} locale="zh-CN">
            <Seed />
            <CardTutorPanel
              locale="zh-CN"
              itemId="card-1"
              face="back"
              item={{ deck: '生物', tags: ['植物学'] }}
            />
          </CardTutorProvider>
        </PiwinUiProvider>,
      );
    });

    await act(async () => {
      container.querySelector('[data-testid="seed-explain"]')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
    });

    const makeCard = container.querySelector('[data-testid="card-tutor-make-card"]');
    expect(makeCard).not.toBeNull();
    expect((makeCard as HTMLButtonElement).disabled).toBe(false);

    await act(async () => {
      makeCard?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.querySelector('[data-testid="card-tutor-panel"]')?.getAttribute('data-status')).toBe(
      'drafting',
    );
    expect(container.querySelector('[data-testid="card-tutor-draft"]')).not.toBeNull();
    const front = container.querySelector(
      '[data-testid="card-tutor-draft-front"] textarea',
    ) as HTMLTextAreaElement | null;
    const back = container.querySelector(
      '[data-testid="card-tutor-draft-back"] textarea',
    ) as HTMLTextAreaElement | null;
    expect(front?.value).toBe('什么是「光合」？');
    expect(back?.value).toBe('植物把光能变成化学能。');
  });
});
