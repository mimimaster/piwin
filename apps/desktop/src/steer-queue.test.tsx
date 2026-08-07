// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { SteerQueue, type SteerQueueMessage } from './steer-queue';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const queueMessages: SteerQueueMessage[] = [
  { id: 'queued-1', text: 'Check the failing test first' },
  { id: 'queued-2', text: 'Then summarize the root cause' },
];

function Harness(props: {
  messages: readonly SteerQueueMessage[];
  onSendNow: (messageId: string) => void;
  onEdit: (messageId: string, text: string) => void;
  onRemove: (messageId: string) => void;
}): ReactElement {
  return (
    <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
      <SteerQueue {...props} />
    </PiwinUiProvider>
  );
}

describe('SteerQueue', () => {
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
    globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
  });

  it('renders the waiting header and all queued messages', () => {
    act(() =>
      root.render(
        <Harness
          messages={queueMessages}
          onSendNow={vi.fn()}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
        />,
      ),
    );

    expect(container.querySelector('[data-testid="steer-queue"]')).not.toBeNull();
    expect(container.querySelector('.steer-queue-title')?.textContent).toBe('Queued');
    expect(container.querySelector('.steer-queue-count')?.textContent).toBe('2');
    expect(container.textContent).toContain('to Send');
    expect(container.textContent).toContain('Check the failing test first');
    expect(container.textContent).toContain('Then summarize the root cause');
  });

  it('sends, edits, and removes individual queued messages', () => {
    const onSendNow = vi.fn();
    const onEdit = vi.fn();
    const onRemove = vi.fn();
    act(() =>
      root.render(
        <Harness
          messages={queueMessages}
          onSendNow={onSendNow}
          onEdit={onEdit}
          onRemove={onRemove}
        />,
      ),
    );

    act(() => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="steer-queue-send-queued-1"]')
        ?.click();
      container
        .querySelector<HTMLButtonElement>('[data-testid="steer-queue-edit-button-queued-2"]')
        ?.click();
    });
    expect(onSendNow).toHaveBeenCalledWith('queued-1');
    expect(container.querySelector('[data-testid="steer-queue-edit-queued-2"]')).not.toBeNull();

    const editInput = container.querySelector<HTMLTextAreaElement>(
      '[data-testid="steer-queue-edit-queued-2"]',
    );
    act(() => {
      if (editInput) {
        const valueSetter = Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          'value',
        )?.set;
        valueSetter?.call(editInput, 'Updated instruction');
        editInput.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            inputType: 'insertText',
            data: 'Updated instruction',
          }),
        );
        editInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
      container
        .querySelector<HTMLButtonElement>('[data-testid="steer-queue-save-queued-2"]')
        ?.click();
      container
        .querySelector<HTMLButtonElement>('[data-testid="steer-queue-remove-queued-1"]')
        ?.click();
    });
    expect(onEdit).toHaveBeenCalledWith('queued-2', 'Updated instruction');
    expect(onRemove).toHaveBeenCalledWith('queued-1');
  });

  it('returns null when the queue is empty', () => {
    act(() =>
      root.render(
        <Harness messages={[]} onSendNow={vi.fn()} onEdit={vi.fn()} onRemove={vi.fn()} />,
      ),
    );

    expect(container.querySelector('[data-testid="steer-queue"]')).toBeNull();
  });
});
