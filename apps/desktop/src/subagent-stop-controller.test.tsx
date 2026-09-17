// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import type { HostCommand, HostResponse } from '@piwin/contracts';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import type { SubagentOrchestrationItem } from './subagent-orchestration-view';
import { SubagentInvocationStop } from './subagent-invocation-stop';
import {
  SubagentStopProvider,
  useSubagentStopController,
  type SubagentStopController,
} from './subagent-stop-controller';

const notifications = vi.hoisted(() => ({
  error: vi.fn(),
  warning: vi.fn(),
}));

vi.mock('@piwin/ui-kit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@piwin/ui-kit')>()),
  showErrorNotification: notifications.error,
  showWarningNotification: notifications.warning,
}));

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function item(
  overrides: Partial<SubagentOrchestrationItem> & Pick<SubagentOrchestrationItem, 'anchorId'>,
): SubagentOrchestrationItem {
  return {
    title: overrides.anchorId,
    activity: 'Running tool',
    executionStatus: 'running',
    updatedAt: '2026-09-17T00:00:00.000Z',
    ...overrides,
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: ((value: T) => void) | undefined;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve: resolve as (value: T) => void };
}

function ok(data: unknown): HostResponse {
  return {
    type: 'response',
    command: 'subagent/batch-cancel',
    success: true,
    data,
  } as HostResponse;
}

let controller: SubagentStopController | null = null;

function Harness(props: {
  request: (command: HostCommand) => Promise<HostResponse>;
  items: SubagentOrchestrationItem[];
}): ReactElement {
  const stop = useSubagentStopController({
    request: props.request,
    items: props.items,
    locale: 'en',
  });
  controller = stop;
  return (
    <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
      <SubagentStopProvider value={stop}>
        {stop.dialog}
        <SubagentInvocationStop runId="run-1" status="running" locale="en" />
      </SubagentStopProvider>
    </PiwinUiProvider>
  );
}

function stopButton(): HTMLButtonElement {
  const button = document.querySelector('[data-testid="subagent-invocation-stop"]');
  if (!(button instanceof HTMLButtonElement)) throw new Error('card stop was not rendered');
  return button;
}

function findButtonByText(text: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll('button')].find(
    (button): button is HTMLButtonElement => button.textContent?.trim() === text,
  );
}

describe('subagent stop controller', () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    notifications.error.mockClear();
    notifications.warning.mockClear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    controller = null;
  });

  it('stops a single-task batch without confirmation and shows pending state', async () => {
    const response = deferred<HostResponse>();
    const request = vi.fn(() => response.promise);
    act(() => root.render(<Harness request={request} items={[item({ anchorId: 'a', runId: 'run-1' })]} />));

    await act(async () => {
      stopButton().click();
      await Promise.resolve();
    });

    expect(request).toHaveBeenCalledWith({ type: 'subagent/batch-cancel', runId: 'run-1' });
    expect(stopButton().disabled).toBe(true);
    expect(stopButton().getAttribute('aria-label')).toBe('Stopping…');

    await act(async () => {
      response.resolve(ok({ cancelled: true, status: 'cancelled' }));
      await response.promise;
    });
    expect(stopButton().disabled).toBe(false);
    expect(notifications.error).not.toHaveBeenCalled();
  });

  it('confirms before stopping a batch that still has sibling tasks running', async () => {
    const request = vi.fn(async () => ok({ cancelled: true, status: 'cancelled' }));
    act(() =>
      root.render(
        <Harness
          request={request}
          items={[item({ anchorId: 'a', runId: 'run-1' }), item({ anchorId: 'b', runId: 'run-1' })]}
        />,
      ),
    );
    expect(stopButton().getAttribute('aria-label')).toBe('Stop whole batch');

    await act(async () => {
      stopButton().click();
      await Promise.resolve();
    });
    expect(request).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('2 running tasks');

    const confirm = findButtonByText('Stop');
    if (!confirm) throw new Error('confirm button was not rendered');
    await act(async () => {
      confirm.click();
      await Promise.resolve();
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('reports a failed stop and warns when the child had to be detached', async () => {
    const request = vi
      .fn<(command: HostCommand) => Promise<HostResponse>>()
      .mockResolvedValueOnce({
        type: 'response',
        command: 'subagent/batch-cancel',
        success: false,
        error: 'boom',
      } as HostResponse)
      .mockResolvedValueOnce(ok({ cancelled: true, status: 'detached' }));
    act(() => root.render(<Harness request={request} items={[item({ anchorId: 'a', runId: 'run-1' })]} />));

    await act(async () => {
      await controller?.stop('run-1');
    });
    expect(notifications.error).toHaveBeenCalledWith('boom', 'Could not stop subagent');

    await act(async () => {
      await controller?.stop('run-1');
    });
    expect(notifications.warning).toHaveBeenCalledTimes(1);
  });

  it('keeps transcript cards read-only outside the provider', () => {
    act(() =>
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <SubagentInvocationStop runId="run-1" status="running" locale="en" />
        </PiwinUiProvider>,
      ),
    );
    expect(document.querySelector('[data-testid="subagent-invocation-stop"]')).toBeNull();
  });
});
