// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import type { JobRecord } from '@piwin/contracts';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { applyComposerStopAll, focusComposerSubagentItem } from './composer-activity-actions';
import { subagentInvocationDomId } from './subagent-orchestration-view';
import { ComposerActivityPill, type ComposerActivityPillProps } from './composer-activity-pill';
import { EMPTY_SUBAGENT_ORCHESTRATION_VIEW } from './composer-activity-model';
import { DesktopLocaleProvider } from './desktop-locale-context';
import type { SubagentOrchestrationItem, SubagentOrchestrationView } from './subagent-orchestration-view';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function makeItem(
  overrides: Partial<SubagentOrchestrationItem> & Pick<SubagentOrchestrationItem, 'anchorId'>,
): SubagentOrchestrationItem {
  return {
    title: overrides.title ?? overrides.anchorId,
    activity: 'Running tool',
    executionStatus: 'running',
    updatedAt: '2026-09-13T00:00:00.000Z',
    ...overrides,
  };
}

function makeJob(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    jobId: 'job-1',
    kind: 'service',
    lifetime: 'session',
    command: 'node',
    argv: ['node', 'server.js'],
    cwd: '/project',
    status: 'running',
    ownerSessionId: 'session-1',
    startedAt: '2026-09-13T00:00:00.000Z',
    latestLogCursor: 0,
    ...overrides,
  };
}

function viewFromItems(items: SubagentOrchestrationItem[]): SubagentOrchestrationView {
  return {
    ...EMPTY_SUBAGENT_ORCHESTRATION_VIEW,
    items,
    activeCount: items.filter(
      (item) =>
        item.executionStatus === 'queued' ||
        item.executionStatus === 'starting' ||
        item.executionStatus === 'running',
    ).length,
  };
}

function Harness(props: ComposerActivityPillProps): ReactElement {
  return (
    <DesktopLocaleProvider locale="en" onLocaleChange={() => undefined}>
      <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
        <ComposerActivityPill {...props} />
      </PiwinUiProvider>
    </DesktopLocaleProvider>
  );
}

function queryPill(): HTMLElement | null {
  return document.querySelector('[data-testid="composer-activity-pill"]');
}

function queryPopover(): HTMLElement | null {
  return document.querySelector('[data-testid="composer-activity-popover"]');
}

function activatePill(): void {
  const pill = queryPill();
  if (!(pill instanceof HTMLElement)) {
    throw new Error('activity pill was not rendered');
  }
  act(() => {
    pill.focus();
    pill.click();
  });
}

describe('ComposerActivityPill', () => {
  let container: HTMLElement;
  let root: Root;
  let previousMatchMedia: typeof window.matchMedia;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    previousMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    window.matchMedia = previousMatchMedia;
    globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
  });

  it('is hidden when no active subagents and no jobs', () => {
    act(() =>
      root.render(
        <Harness
          orchestrationView={EMPTY_SUBAGENT_ORCHESTRATION_VIEW}
          jobs={[]}
          onViewJobLogs={vi.fn()}
          onStopJob={vi.fn()}
          onCancelSubagentBatch={vi.fn()}
          onOpenTasks={vi.fn()}
        />,
      ),
    );
    expect(queryPill()).toBeNull();
    expect(container.querySelector('[data-testid="composer-activity-rail"]')).toBeNull();
  });

  it('shows a count for two running invocations and lists both titles', () => {
    act(() =>
      root.render(
        <Harness
          locale="en"
          orchestrationView={viewFromItems([
            makeItem({ anchorId: 'inv-a', invocationId: 'inv-a', title: 'Scout auth', runId: 'run-1' }),
            makeItem({
              anchorId: 'inv-b',
              invocationId: 'inv-b',
              title: 'Write contracts',
              runId: 'run-1',
            }),
          ])}
          jobs={[]}
          onViewJobLogs={vi.fn()}
          onStopJob={vi.fn()}
          onCancelSubagentBatch={vi.fn()}
          onOpenTasks={vi.fn()}
        />,
      ),
    );
    expect(queryPill()?.textContent).toContain('2 Working');
    activatePill();
    const popover = queryPopover();
    expect(popover?.textContent).toContain('Scout auth');
    expect(popover?.textContent).toContain('Write contracts');
  });

  it('clicking a job row calls onViewJobLogs and does not cancel', () => {
    const onViewJobLogs = vi.fn();
    const onStopJob = vi.fn();
    const onCancelSubagentBatch = vi.fn();
    act(() =>
      root.render(
        <Harness
          jobs={[makeJob({ label: 'dev server' })]}
          onViewJobLogs={onViewJobLogs}
          onStopJob={onStopJob}
          onCancelSubagentBatch={onCancelSubagentBatch}
          onOpenTasks={vi.fn()}
        />,
      ),
    );
    activatePill();
    const jobRow = document.querySelector('[data-testid="composer-activity-job-row"]');
    if (!(jobRow instanceof HTMLElement)) {
      throw new Error('job row was not rendered');
    }
    act(() => {
      jobRow.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onViewJobLogs).toHaveBeenCalledWith('job-1');
    expect(onStopJob).not.toHaveBeenCalled();
    expect(onCancelSubagentBatch).not.toHaveBeenCalled();
  });

  it('stop on a job calls onStopJob; stop-all uses only batch-cancel and job/stop', () => {
    const onViewJobLogs = vi.fn();
    const onStopJob = vi.fn();
    const onCancelSubagentBatch = vi.fn();
    act(() =>
      root.render(
        <Harness
          orchestrationView={viewFromItems([
            makeItem({
              anchorId: 'inv-a',
              invocationId: 'inv-a',
              title: 'Scout auth',
              runId: 'run-1',
            }),
          ])}
          jobs={[makeJob({ label: 'api' })]}
          onViewJobLogs={onViewJobLogs}
          onStopJob={onStopJob}
          onCancelSubagentBatch={onCancelSubagentBatch}
          onOpenTasks={vi.fn()}
        />,
      ),
    );
    activatePill();
    const jobStop = document.querySelector('[data-testid="composer-activity-stop-job"]');
    if (!(jobStop instanceof HTMLElement)) {
      throw new Error('job stop was not rendered');
    }
    act(() => {
      jobStop.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onStopJob).toHaveBeenCalledWith('job-1');
    expect(onViewJobLogs).not.toHaveBeenCalled();

    const stopAll = document.querySelector('[data-testid="composer-activity-stop-all"]');
    if (!(stopAll instanceof HTMLElement)) {
      throw new Error('stop-all was not rendered');
    }
    onStopJob.mockClear();
    act(() => {
      stopAll.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onCancelSubagentBatch).toHaveBeenCalledWith('run-1');
    expect(onStopJob).toHaveBeenCalledWith('job-1');
    expect(onViewJobLogs).not.toHaveBeenCalled();
    expect(onCancelSubagentBatch.mock.calls.every((call) => call.length === 1)).toBe(true);
  });

  it('disables a row stop while its request is in flight and routes stop-all as one batch call', () => {
    const onCancelSubagentBatch = vi.fn();
    const onCancelSubagentBatches = vi.fn();
    act(() =>
      root.render(
        <Harness
          orchestrationView={viewFromItems([
            makeItem({ anchorId: 'inv-a', title: 'Scout', runId: 'run-1' }),
            makeItem({ anchorId: 'inv-b', title: 'Writer', runId: 'run-2' }),
          ])}
          onViewJobLogs={vi.fn()}
          onStopJob={vi.fn()}
          onCancelSubagentBatch={onCancelSubagentBatch}
          onCancelSubagentBatches={onCancelSubagentBatches}
          isSubagentStopping={(runId) => runId === 'run-1'}
          onOpenTasks={vi.fn()}
        />,
      ),
    );
    activatePill();
    const stops = [
      ...document.querySelectorAll('[data-testid="composer-activity-stop-subagent"]'),
    ] as HTMLButtonElement[];
    expect(stops.map((button) => button.disabled)).toEqual([true, false]);
    expect(stops[0]?.getAttribute('aria-label')).toBe('Stopping…');

    const stopAll = document.querySelector('[data-testid="composer-activity-stop-all"]');
    if (!(stopAll instanceof HTMLElement)) {
      throw new Error('stop-all was not rendered');
    }
    act(() => {
      stopAll.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onCancelSubagentBatches).toHaveBeenCalledWith(['run-1', 'run-2']);
    expect(onCancelSubagentBatch).not.toHaveBeenCalled();
  });

  it('prefers-reduced-motion does not require the braille animation', () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    act(() =>
      root.render(
        <Harness
          orchestrationView={viewFromItems([
            makeItem({ anchorId: 'inv-a', title: 'Scout', runId: 'run-1' }),
          ])}
          onViewJobLogs={vi.fn()}
          onStopJob={vi.fn()}
          onCancelSubagentBatch={vi.fn()}
          onOpenTasks={vi.fn()}
        />,
      ),
    );
    const icon = document.querySelector('.composer-activity-pill-icon');
    expect(icon?.getAttribute('data-animated')).toBe('false');
    expect(icon?.classList.contains('is-static')).toBe(true);
  });
});

describe('focusComposerSubagentItem', () => {
  it('scrolls a present invocation card and otherwise opens Tasks', () => {
    const openTasks = vi.fn();
    const card = document.createElement('button');
    card.id = subagentInvocationDomId('inv-a');
    card.scrollIntoView = vi.fn();
    document.body.appendChild(card);
    const focus = vi.spyOn(card, 'focus');
    const scroll = card.scrollIntoView as ReturnType<typeof vi.fn>;
    focusComposerSubagentItem(
      makeItem({ anchorId: 'inv-a', invocationId: 'inv-a', runId: 'run-1' }),
      openTasks,
    );
    expect(scroll).toHaveBeenCalled();
    expect(focus).toHaveBeenCalled();
    expect(openTasks).not.toHaveBeenCalled();
    card.remove();
    focusComposerSubagentItem(
      makeItem({ anchorId: 'inv-a', invocationId: 'inv-a', runId: 'run-1' }),
      openTasks,
    );
    expect(openTasks).toHaveBeenCalledTimes(1);
  });
});

describe('applyComposerStopAll', () => {
  it('only invokes batch-cancel and job/stop', () => {
    const cancelBatch = vi.fn();
    const stopJob = vi.fn();
    applyComposerStopAll({
      runIds: ['run-1'],
      jobIds: ['job-1', 'job-2'],
      cancelBatch,
      stopJob,
    });
    expect(cancelBatch).toHaveBeenCalledTimes(1);
    expect(cancelBatch).toHaveBeenCalledWith('run-1');
    expect(stopJob).toHaveBeenCalledTimes(2);
    expect(stopJob).toHaveBeenCalledWith('job-1');
    expect(stopJob).toHaveBeenCalledWith('job-2');
  });
});
