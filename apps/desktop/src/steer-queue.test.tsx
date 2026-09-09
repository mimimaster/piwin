// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { DesktopLocaleProvider } from './desktop-locale-context';
import { SteerQueue, type SteerQueueMessage } from './steer-queue';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const queueMessages: SteerQueueMessage[] = [
  {
    id: 'queued-1',
    text: 'Check the failing test first',
    createdAt: '2026-08-09T00:00:00.000Z',
  },
  {
    id: 'queued-2',
    text: 'Then summarize the root cause',
    createdAt: '2026-08-09T00:00:01.000Z',
    attachmentCount: 2,
  },
];

function Harness(props: {
  messages: readonly SteerQueueMessage[];
  onSendNow: (messageId: string) => void;
  onEdit: (messageId: string) => void;
  onRemove: (messageId: string) => void;
  editingMessageId?: string | null;
  onCancelEdit?: () => void;
}): ReactElement {
  return (
    <DesktopLocaleProvider locale="en" onLocaleChange={() => undefined}>
      <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
        <SteerQueue {...props} />
      </PiwinUiProvider>
    </DesktopLocaleProvider>
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
    expect(container.querySelector('.steer-queue-title')?.textContent).toBe('Up next');
    expect(container.querySelector('.steer-queue-count')?.textContent).toBe('2');
    expect(container.textContent).toContain('Sent in order after this run');
    expect(container.textContent).toContain('Check the failing test first');
    expect(container.textContent).toContain('Then summarize the root cause');
  });

  it('sends, opens composer edit, and removes individual queued messages', async () => {
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

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="steer-queue-send-queued-1"]')
        ?.click();
      container
        .querySelector<HTMLButtonElement>('[data-testid="steer-queue-edit-button-queued-2"]')
        ?.click();
      container
        .querySelector<HTMLButtonElement>('[data-testid="steer-queue-remove-queued-1"]')
        ?.click();
    });
    expect(onSendNow).toHaveBeenCalledWith('queued-1');
    expect(onEdit).toHaveBeenCalledWith('queued-2');
    expect(onRemove).toHaveBeenCalledWith('queued-1');
    expect(container.querySelector('[data-testid="steer-queue-edit-queued-2"]')).toBeNull();
  });

  it('opens composer edit from the row body', () => {
    const onEdit = vi.fn();
    act(() =>
      root.render(
        <Harness messages={queueMessages} onSendNow={vi.fn()} onEdit={onEdit} onRemove={vi.fn()} />,
      ),
    );

    act(() => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="steer-queue-open-queued-1"]')
        ?.click();
    });
    expect(onEdit).toHaveBeenCalledWith('queued-1');
  });

  it('marks the handed-off row and only offers cancel', () => {
    const onCancelEdit = vi.fn();
    act(() =>
      root.render(
        <Harness
          messages={queueMessages}
          onSendNow={vi.fn()}
          onEdit={vi.fn()}
          onRemove={vi.fn()}
          editingMessageId="queued-2"
          onCancelEdit={onCancelEdit}
        />,
      ),
    );

    const row = container.querySelector('[data-testid="steer-queue-item-queued-2"]');
    expect(row?.classList.contains('is-editing')).toBe(true);
    expect(row?.getAttribute('aria-current')).toBe('true');
    expect(container.textContent).toContain('Editing');
    expect(container.querySelector('[data-testid="steer-queue-edit-button-queued-2"]')).toBeNull();
    expect(container.querySelector('[data-testid="steer-queue-send-queued-2"]')).toBeNull();
    expect(container.querySelector('[data-testid="steer-queue-remove-queued-2"]')).toBeNull();
    expect(
      container.querySelector<HTMLButtonElement>('[data-testid="steer-queue-open-queued-2"]')
        ?.disabled,
    ).toBe(true);

    act(() => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="steer-queue-cancel-queued-2"]')
        ?.click();
    });
    expect(onCancelEdit).toHaveBeenCalledOnce();
  });

  it('reports queued attachments on the preview row', () => {
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

    const badge = container.querySelector('[data-testid="steer-queue-attachments-queued-2"]');
    expect(badge?.textContent).toContain('2');
    expect(container.querySelector('[data-testid="steer-queue-attachments-queued-1"]')).toBeNull();
  });

  it('returns null when the queue is empty', () => {
    act(() =>
      root.render(
        <Harness messages={[]} onSendNow={vi.fn()} onEdit={vi.fn()} onRemove={vi.fn()} />,
      ),
    );

    expect(container.querySelector('[data-testid="steer-queue"]')).toBeNull();
  });
  it('disables row actions while send-now is pending and enables retry afterward', async () => {
    let finish: () => void = () => { throw new Error('request not started'); };
    const onSendNow = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    act(() => root.render(
      <Harness messages={queueMessages} onSendNow={onSendNow} onEdit={vi.fn()} onRemove={vi.fn()} />,
    ));
    const send = container.querySelector<HTMLButtonElement>('[data-testid="steer-queue-send-queued-1"]');
    if (!send) throw new Error('missing send button');
    act(() => send.click());
    expect(send.disabled).toBe(true);
    expect(send.getAttribute('aria-busy')).toBe('true');
    expect(container.querySelector<HTMLButtonElement>('[data-testid="steer-queue-edit-button-queued-1"]')?.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>('[data-testid="steer-queue-remove-queued-1"]')?.disabled).toBe(true);
    act(() => send.click());
    expect(onSendNow).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    expect(send.disabled).toBe(false);
  });

});
