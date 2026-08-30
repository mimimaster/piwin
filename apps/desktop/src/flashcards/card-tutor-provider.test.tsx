// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useEffect, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { HostCommand, HostResponse } from '@piwin/contracts';
import { CardTutorProvider, useCardTutor } from './card-tutor-provider';
import type { FlashcardDraftSource } from './flashcard-tutor-draft';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function ok(markdown: string, explanationId: string): HostResponse {
  return {
    type: 'response',
    command: 'flashcards/explain-selection',
    success: true,
    data: {
      explanationId,
      itemId: 'card-1',
      selectedText: '光合',
      intent: 'hint',
      markdown,
    },
  };
}

function fail(code: string): HostResponse {
  return {
    type: 'response',
    command: 'flashcards/explain-selection',
    success: false,
    error: code,
    problem: { code },
  };
}

function Harness(): ReactElement {
  const tutor = useCardTutor();
  return (
    <div>
      <span data-testid="status">{tutor.state.status}</span>
      <span data-testid="markdown">{tutor.state.markdown ?? ''}</span>
      <span data-testid="error">{tutor.state.error?.code ?? ''}</span>
      <button
        type="button"
        data-testid="explain"
        onClick={() =>
          void tutor.explain({
            itemId: 'card-1',
            face: 'front',
            selectedText: '光合',
            intent: 'hint',
          })
        }
      >
        explain
      </button>
      <button type="button" data-testid="retry" onClick={() => void tutor.retry()}>
        retry
      </button>
      <button type="button" data-testid="cancel" onClick={() => tutor.cancel()}>
        cancel
      </button>
    </div>
  );
}

describe('CardTutorProvider', () => {
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

  it('drops a stale response after a newer explanation starts', async () => {
    let first!: (response: HostResponse) => void;
    let second!: (response: HostResponse) => void;
    let explainCount = 0;
    const request = vi.fn(async (command: HostCommand): Promise<HostResponse> => {
      if (command.type === 'flashcards/cancel-explanation') {
        return { type: 'response', command: command.type, success: true, data: { cancelled: true } };
      }
      if (command.type !== 'flashcards/explain-selection') {
        return { type: 'response', command: command.type, success: false, error: 'unexpected' };
      }
      explainCount += 1;
      const id = command.input.explanationId;
      if (explainCount === 1) {
        return new Promise((resolve) => {
          first = (response) => resolve(response);
        }).then(() => ok('stale hint', id));
      }
      return new Promise((resolve) => {
        second = (response) => resolve(response);
      }).then(() => ok('fresh hint', id));
    });

    act(() => {
      root.render(
        <CardTutorProvider request={request} locale="zh-CN">
          <Harness />
        </CardTutorProvider>,
      );
    });

    await act(async () => {
      container.querySelector('[data-testid="explain"]')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
    });
    await act(async () => {
      container.querySelector('[data-testid="explain"]')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
    });

    await act(async () => {
      first({ type: 'response', command: 'flashcards/explain-selection', success: true, data: {} });
    });
    expect(container.querySelector('[data-testid="markdown"]')?.textContent).toBe('');

    await act(async () => {
      second({ type: 'response', command: 'flashcards/explain-selection', success: true, data: {} });
    });
    expect(container.querySelector('[data-testid="status"]')?.textContent).toBe('ready');
    expect(container.querySelector('[data-testid="markdown"]')?.textContent).toBe('fresh hint');
  });

  it('cancels the in-flight explanation on unmount', async () => {
    let resolveExplain: ((response: HostResponse) => void) | undefined;
    const request = vi.fn(async (command: HostCommand): Promise<HostResponse> => {
      if (command.type === 'flashcards/cancel-explanation') {
        return { type: 'response', command: command.type, success: true, data: { cancelled: true } };
      }
      return new Promise((resolve) => {
        resolveExplain = resolve;
      });
    });

    act(() => {
      root.render(
        <CardTutorProvider request={request} locale="zh-CN">
          <Harness />
        </CardTutorProvider>,
      );
    });
    await act(async () => {
      container.querySelector('[data-testid="explain"]')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
    });

    act(() => {
      root.unmount();
    });

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'flashcards/cancel-explanation' }),
    );
    resolveExplain?.(ok('late', 'ignored'));
  });

  it('turns a malformed current Host success into error instead of hanging', async () => {
    const request = vi.fn(async (command: HostCommand): Promise<HostResponse> => {
      if (command.type === 'flashcards/cancel-explanation') {
        return { type: 'response', command: command.type, success: true, data: { cancelled: true } };
      }
      return {
        type: 'response',
        command: 'flashcards/explain-selection',
        success: true,
        data: { unexpected: true },
      };
    });

    act(() => {
      root.render(
        <CardTutorProvider request={request} locale="zh-CN">
          <Harness />
        </CardTutorProvider>,
      );
    });
    await act(async () => {
      container.querySelector('[data-testid="explain"]')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
    });
    expect(container.querySelector('[data-testid="status"]')?.textContent).toBe('error');
    expect(container.querySelector('[data-testid="error"]')?.textContent).toBe(
      'flashcard-selection-provider-failed',
    );
  });

  it('retries the last snapshot with a new explanation id', async () => {
    const ids: string[] = [];
    const request = vi.fn(async (command: HostCommand): Promise<HostResponse> => {
      if (command.type === 'flashcards/cancel-explanation') {
        return { type: 'response', command: command.type, success: true, data: { cancelled: true } };
      }
      if (command.type !== 'flashcards/explain-selection') {
        return { type: 'response', command: command.type, success: false, error: 'unexpected' };
      }
      ids.push(command.input.explanationId);
      if (ids.length === 1) return fail('flashcard-selection-provider-failed');
      return ok('recovered', command.input.explanationId);
    });

    act(() => {
      root.render(
        <CardTutorProvider request={request} locale="zh-CN">
          <Harness />
        </CardTutorProvider>,
      );
    });

    await act(async () => {
      container.querySelector('[data-testid="explain"]')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
    });
    expect(container.querySelector('[data-testid="status"]')?.textContent).toBe('error');

    await act(async () => {
      container.querySelector('[data-testid="retry"]')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
    });
    expect(container.querySelector('[data-testid="status"]')?.textContent).toBe('ready');
    expect(container.querySelector('[data-testid="markdown"]')?.textContent).toBe('recovered');
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });
});

const SOURCE: FlashcardDraftSource = {
  deck: '生物',
  tags: ['植物学'],
  sourceNoteId: 'note-1',
  sourceFile: 'photosynthesis.md',
  sourceLine: 12,
  sourceExcerpt: '光合作用是…',
};

function explainOk(markdown: string, explanationId: string): HostResponse {
  return {
    type: 'response',
    command: 'flashcards/explain-selection',
    success: true,
    data: {
      explanationId,
      itemId: 'card-1',
      selectedText: '光合',
      intent: 'explain',
      markdown,
    },
  };
}

function CreateHarness(): ReactElement {
  const tutor = useCardTutor();
  return (
    <div>
      <span data-testid="status">{tutor.state.status}</span>
      <span data-testid="front">{tutor.state.draft?.input.front ?? ''}</span>
      <span data-testid="back">{tutor.state.draft?.input.back ?? ''}</span>
      <span data-testid="deck">{tutor.state.draft?.input.deck ?? ''}</span>
      <span data-testid="save-status">{tutor.state.draft?.saveStatus ?? ''}</span>
      <span data-testid="draft-error">{tutor.state.draft?.error?.code ?? ''}</span>
      <span data-testid="draft-error-message">{tutor.state.draft?.error?.message ?? ''}</span>
      <span data-testid="existing">{tutor.state.draft?.existing?.front ?? ''}</span>
      <button
        type="button"
        data-testid="explain"
        onClick={() =>
          void tutor.explain({
            itemId: 'card-1',
            face: 'back',
            selectedText: '光合',
            intent: 'explain',
          })
        }
      >
        explain
      </button>
      <button type="button" data-testid="start-draft" onClick={() => tutor.startDraft(SOURCE)}>
        draft
      </button>
      <button
        type="button"
        data-testid="edit-front"
        onClick={() => tutor.updateDraft({ front: 'Edited front' })}
      >
        edit
      </button>
      <button type="button" data-testid="clear-front" onClick={() => tutor.updateDraft({ front: '' })}>
        clear
      </button>
      <button type="button" data-testid="save" onClick={() => void tutor.saveDraft()}>
        save
      </button>
      <button type="button" data-testid="cancel-draft" onClick={tutor.cancelDraft}>
        cancel-draft
      </button>
      <button type="button" data-testid="close" onClick={tutor.close}>
        close
      </button>
    </div>
  );
}

function click(container: HTMLDivElement, testId: string): Promise<void> {
  return act(async () => {
    container.querySelector(`[data-testid="${testId}"]`)?.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );
  });
}

describe('CardTutorProvider create from explanation', () => {
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

  function mockRequest(
    batch: (command: HostCommand) => Promise<HostResponse> | HostResponse,
  ): ReturnType<typeof vi.fn> {
    return vi.fn(async (command: HostCommand): Promise<HostResponse> => {
      if (command.type === 'flashcards/cancel-explanation' || command.type === 'flashcards/decks') {
        return { type: 'response', command: command.type, success: true, data: { decks: ['生物'] } };
      }
      if (command.type === 'flashcards/explain-selection') {
        return explainOk('植物把光能变成化学能。', command.input.explanationId);
      }
      return batch(command);
    });
  }

  async function readyDraft(
    request: ReturnType<typeof vi.fn>,
    notify?: (message: string) => void,
  ): Promise<void> {
    act(() => {
      root.render(
        <CardTutorProvider
          request={request}
          locale="zh-CN"
          {...(notify ? { notify } : {})}
        >
          <CreateHarness />
        </CardTutorProvider>,
      );
    });
    await click(container, 'explain');
    await click(container, 'start-draft');
  }

  it('prefills a zh draft from the selection and explanation and keeps user edits', async () => {
    const request = mockRequest(async (command) => ({
      type: 'response',
      command: command.type,
      success: true,
      data: { created: [{ id: 'new-1' }], skipped: [] },
    }));
    await readyDraft(request);
    expect(container.querySelector('[data-testid="status"]')?.textContent).toBe('drafting');
    expect(container.querySelector('[data-testid="front"]')?.textContent).toBe('什么是「光合」？');
    expect(container.querySelector('[data-testid="back"]')?.textContent).toBe(
      '植物把光能变成化学能。',
    );
    await click(container, 'edit-front');
    await click(container, 'save');
    const batch = request.mock.calls.find(
      (entry) => (entry[0] as HostCommand).type === 'flashcards/batch-create',
    )?.[0] as HostCommand | undefined;
    expect(batch).toEqual({
      type: 'flashcards/batch-create',
      input: {
        cards: [
          expect.objectContaining({
            model: 'basic',
            front: 'Edited front',
            back: '植物把光能变成化学能。',
            deck: '生物',
            tags: ['植物学'],
            sourceNoteId: 'note-1',
            sourceFile: 'photosynthesis.md',
            sourceLine: 12,
            sourceExcerpt: '光合作用是…',
          }),
        ],
      },
    });
    const card = batch && batch.type === 'flashcards/batch-create' ? batch.input.cards[0] : undefined;
    expect(card && 'sourceFolder' in card).toBe(false);
  });

  it('notifies on chat success without writing a transcript command', async () => {
    const notify = vi.fn();
    const transcript = vi.fn();
    const request = mockRequest(async (command) => ({
      type: 'response',
      command: command.type,
      success: true,
      data: { created: [{ id: 'new-1' }], skipped: [] },
    }));
    await readyDraft(request, notify);
    await click(container, 'save');
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith('已存入闪卡');
    expect(transcript).not.toHaveBeenCalled();
    const types = request.mock.calls.map((entry) => (entry[0] as HostCommand).type);
    expect(types.filter((type) => type === 'flashcards/batch-create')).toHaveLength(1);
    expect(types.some((type) => type.startsWith('session/') || type.includes('prompt'))).toBe(false);
    expect(container.querySelector('[data-testid="save-status"]')?.textContent).toBe('saved');
  });

  it('reloads the workspace gallery once on success', async () => {
    const reload = vi.fn(async () => undefined);
    const request = mockRequest(async (command) => ({
      type: 'response',
      command: command.type,
      success: true,
      data: { created: [{ id: 'new-1' }], skipped: [] },
    }));
    function ReloadHarness(): ReactElement {
      const tutor = useCardTutor();
      useEffect(() => tutor.registerOnCreated(reload), [tutor.registerOnCreated]);
      return <CreateHarness />;
    }
    act(() => {
      root.render(
        <CardTutorProvider request={request} locale="zh-CN">
          <ReloadHarness />
        </CardTutorProvider>,
      );
    });
    await click(container, 'explain');
    await click(container, 'start-draft');
    await click(container, 'save');
    expect(reload).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="save-status"]')?.textContent).toBe('saved');
    await click(container, 'save');
    expect(
      request.mock.calls.filter((entry) => (entry[0] as HostCommand).type === 'flashcards/batch-create'),
    ).toHaveLength(1);
  });

  it('shows a duplicate in place with skipped.existing and does not pretend success', async () => {
    const notify = vi.fn();
    const request = mockRequest(async (command) => ({
      type: 'response',
      command: command.type,
      success: true,
      data: {
        created: [],
        skipped: [
          {
            front: '什么是「光合」？',
            reason: 'duplicate',
            existing: {
              id: 'old-1',
              model: 'basic',
              deck: '生物',
              front: '已有卡片正面',
              createdAt: '2026-08-18T00:00:00.000Z',
            },
          },
        ],
      },
    }));
    await readyDraft(request, notify);
    await click(container, 'save');
    expect(container.querySelector('[data-testid="status"]')?.textContent).toBe('drafting');
    expect(container.querySelector('[data-testid="draft-error"]')?.textContent).toBe(
      'flashcard-draft-duplicate',
    );
    expect(container.querySelector('[data-testid="existing"]')?.textContent).toBe('已有卡片正面');
    expect(container.querySelector('[data-testid="save-status"]')?.textContent).toBe('idle');
    expect(notify).not.toHaveBeenCalled();
  });

  it('keeps the draft open on Host failure and empty front/back cannot save', async () => {
    const request = mockRequest(async () => {
      throw new Error('host unavailable');
    });
    await readyDraft(request);
    await click(container, 'clear-front');
    await click(container, 'save');
    expect(
      request.mock.calls.some((entry) => (entry[0] as HostCommand).type === 'flashcards/batch-create'),
    ).toBe(false);
    expect(container.querySelector('[data-testid="draft-error"]')?.textContent).toBe(
      'flashcard-draft-empty',
    );
    await click(container, 'edit-front');
    await click(container, 'save');
    expect(container.querySelector('[data-testid="status"]')?.textContent).toBe('drafting');
    expect(container.querySelector('[data-testid="draft-error"]')?.textContent).toBe(
      'flashcard-draft-host-unavailable',
    );
    expect(container.querySelector('[data-testid="save-status"]')?.textContent).toBe('idle');
  });

  it('ignores cancel and close while saving so create still notifies', async () => {
    let finish!: (response: HostResponse) => void;
    const notify = vi.fn();
    const request = mockRequest((command) => {
      if (command.type !== 'flashcards/batch-create') {
        return { type: 'response', command: command.type, success: false, error: 'unexpected' };
      }
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    await readyDraft(request, notify);
    await click(container, 'save');
    expect(container.querySelector('[data-testid="save-status"]')?.textContent).toBe('saving');
    await click(container, 'cancel-draft');
    await click(container, 'close');
    expect(container.querySelector('[data-testid="status"]')?.textContent).toBe('drafting');
    expect(container.querySelector('[data-testid="save-status"]')?.textContent).toBe('saving');
    await act(async () => {
      finish({
        type: 'response',
        command: 'flashcards/batch-create',
        success: true,
        data: { created: [{ id: 'new-1' }], skipped: [] },
      });
    });
    expect(container.querySelector('[data-testid="save-status"]')?.textContent).toBe('saved');
    expect(notify).toHaveBeenCalledWith('已存入闪卡');
  });

  it('surfaces Host validation detail instead of a generic save failure', async () => {
    const request = mockRequest(async (command) => ({
      type: 'response',
      command: command.type,
      success: true,
      data: {
        created: [],
        skipped: [{ front: '什么是「光合」？', reason: 'validation', detail: 'front too long' }],
      },
    }));
    await readyDraft(request);
    await click(container, 'save');
    expect(container.querySelector('[data-testid="status"]')?.textContent).toBe('drafting');
    expect(container.querySelector('[data-testid="draft-error"]')?.textContent).toBe(
      'flashcard-draft-validation',
    );
    expect(container.querySelector('[data-testid="draft-error-message"]')?.textContent).toBe(
      'front too long',
    );
    expect(container.querySelector('[data-testid="save-status"]')?.textContent).toBe('idle');
  });

  it('guards a double submit while saving', async () => {
    let finish!: (response: HostResponse) => void;
    const request = mockRequest((command) => {
      if (command.type !== 'flashcards/batch-create') {
        return { type: 'response', command: command.type, success: false, error: 'unexpected' };
      }
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    await readyDraft(request);
    await click(container, 'save');
    expect(container.querySelector('[data-testid="save-status"]')?.textContent).toBe('saving');
    await click(container, 'save');
    await act(async () => {
      finish({
        type: 'response',
        command: 'flashcards/batch-create',
        success: true,
        data: { created: [{ id: 'new-1' }], skipped: [] },
      });
    });
    expect(
      request.mock.calls.filter((entry) => (entry[0] as HostCommand).type === 'flashcards/batch-create'),
    ).toHaveLength(1);
  });
});
