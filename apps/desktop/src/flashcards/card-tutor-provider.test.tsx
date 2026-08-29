// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { HostCommand, HostResponse } from '@piwin/contracts';
import { CardTutorProvider, useCardTutor } from './card-tutor-provider';

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
