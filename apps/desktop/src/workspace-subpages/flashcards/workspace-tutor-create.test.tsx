// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import type { HostCommand, HostResponse } from '@piwin/contracts';
import { PIWIN_APPEARANCE_DARK } from '../../appearance-tokens';
import { CardTutorProvider } from '../../flashcards/card-tutor-provider';
import { FlashcardsWorkspaceView } from '../FlashcardsWorkspaceView';
import type { FlashcardsRequester } from './use-flashcards-workspace';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function flush(times = 8): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await Promise.resolve();
    });
  }
}

const QUEUE_ITEM = {
  card: {
    cardId: 'rc-1',
    itemId: 'card-1',
    model: 'basic' as const,
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
};

describe('workspace tutor create survives gallery refresh', () => {
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

  it('keeps 已存入闪卡 after workspace reload without unmounting ReviewStage', async () => {
    let loadCount = 0;
    const request = vi.fn(async (command: HostCommand): Promise<HostResponse> => {
      if (command.type === 'flashcards/decks') {
        loadCount += 1;
        return { type: 'response', command: command.type, success: true, data: { decks: ['General'] } };
      }
      if (command.type === 'flashcards/list') {
        return {
          type: 'response',
          command: command.type,
          success: true,
          data: {
            cards: [
              {
                id: 'card-1',
                model: 'basic',
                deck: 'General',
                front: 'What is KV Cache?',
                back: 'Key/value activation cache.',
                createdAt: '2d',
              },
            ],
          },
        };
      }
      if (command.type === 'flashcards/queue') {
        return { type: 'response', command: command.type, success: true, data: { queue: [QUEUE_ITEM] } };
      }
      if (command.type === 'flashcards/cancel-explanation') {
        return { type: 'response', command: command.type, success: true, data: { cancelled: true } };
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
            markdown: 'KV cache stores attention keys and values.',
          },
        };
      }
      if (command.type === 'flashcards/batch-create') {
        return {
          type: 'response',
          command: command.type,
          success: true,
          data: { created: [{ id: 'new-1' }], skipped: [] },
        };
      }
      return { type: 'response', command: command.type, success: false, error: `unexpected ${command.type}` };
    });

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <CardTutorProvider request={request} locale="zh-CN">
            <FlashcardsWorkspaceView
              locale="zh-CN"
              onClose={() => undefined}
              request={request as unknown as FlashcardsRequester}
            />
          </CardTutorProvider>
        </PiwinUiProvider>,
      );
    });
    await flush();

    const startBtn = container.querySelector<HTMLButtonElement>('[data-testid="flashcards-review-start"]');
    expect(startBtn).not.toBeNull();
    act(() => {
      startBtn?.click();
    });
    await flush(2);

    const flip = container.querySelector<HTMLButtonElement>('[data-testid="flashcards-review-flip"]');
    act(() => {
      flip?.click();
    });
    await flush(2);

    const fallback = container.querySelector<HTMLButtonElement>('[data-testid="card-tutor-fallback"]');
    expect(fallback).not.toBeNull();
    await act(async () => {
      fallback?.click();
    });
    await flush();

    const makeCard = container.querySelector<HTMLButtonElement>('[data-testid="card-tutor-make-card"]');
    expect(makeCard).not.toBeNull();
    await act(async () => {
      makeCard?.click();
    });
    await flush();

    const save = container.querySelector<HTMLButtonElement>('[data-testid="card-tutor-save-card"]');
    expect(save).not.toBeNull();
    const loadsBeforeSave = loadCount;
    await act(async () => {
      save?.click();
    });
    await flush();

    expect(loadCount).toBeGreaterThan(loadsBeforeSave);
    expect(container.querySelector('[data-testid="flashcards-review-card"]')).not.toBeNull();
    expect(container.textContent).not.toContain('正在加载闪卡');
    const saved = container.querySelector<HTMLButtonElement>('[data-testid="card-tutor-save-card"]');
    expect(saved?.textContent).toContain('已存入闪卡');
    expect(saved?.disabled).toBe(true);
  });
});
