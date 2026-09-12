// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import type { JobRecord } from '@piwin/contracts';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { openComposerJobLogs } from './composer-activity-actions';
import { DesktopLocaleProvider } from './desktop-locale-context';
import { TerminalJobMonitor, type TerminalJobMonitorProps } from './terminal-job-monitor';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function makeJob(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    jobId: 'job-1',
    kind: 'service',
    lifetime: 'session',
    command: 'node',
    argv: ['vite', '--port', '5173'],
    cwd: '/project',
    status: 'ready',
    ownerSessionId: 'session-1',
    startedAt: '2026-09-13T00:00:00.000Z',
    latestLogCursor: 0,
    label: 'dev server',
    ...overrides,
  };
}

function Harness(props: Omit<TerminalJobMonitorProps, 'children'>): ReactElement {
  return (
    <DesktopLocaleProvider locale="en" onLocaleChange={() => undefined}>
      <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
        <TerminalJobMonitor {...props}>
          <div data-testid="pty-surface">zsh pty</div>
        </TerminalJobMonitor>
      </PiwinUiProvider>
    </DesktopLocaleProvider>
  );
}

describe('TerminalJobMonitor', () => {
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

  it('hides the switcher when there are no jobs', () => {
    act(() =>
      root.render(
        <Harness
          jobs={[]}
          selectedJobId={null}
          logsById={{}}
          onSelectJob={vi.fn()}
          onSelectPty={vi.fn()}
          onStopJob={vi.fn()}
        />,
      ),
    );
    expect(container.querySelector('[data-testid="terminal-job-switcher"]')).toBeNull();
    expect(container.querySelector('[data-testid="pty-surface"]')?.textContent).toBe('zsh pty');
  });

  it('keeps zsh selected by default and lists ready jobs with a port', () => {
    act(() =>
      root.render(
        <Harness
          jobs={[makeJob()]}
          selectedJobId={null}
          logsById={{}}
          onSelectJob={vi.fn()}
          onSelectPty={vi.fn()}
          onStopJob={vi.fn()}
        />,
      ),
    );
    expect(container.querySelector('[data-testid="pty-surface"]')?.textContent).toBe('zsh pty');
    expect(container.querySelector('[data-testid="terminal-job-log"]')).toBeNull();
    expect(container.querySelector('[data-testid="terminal-job-chip"]')?.textContent).toContain(
      'dev server',
    );
    expect(container.querySelector('[data-testid="terminal-job-chip"]')?.textContent).toContain(
      ':5173',
    );
  });

  it('opening a job selects it in the monitor and loads job/logs', () => {
    const loadJobLogs = vi.fn();
    const openTerminal = vi.fn();
    const selectJob = vi.fn();
    const onSelectJob = vi.fn((jobId: string) => {
      openComposerJobLogs({
        jobId,
        selectJob,
        loadJobLogs,
        openTerminal,
      });
    });
    act(() =>
      root.render(
        <Harness
          jobs={[makeJob()]}
          selectedJobId={null}
          logsById={{}}
          onSelectJob={onSelectJob}
          onSelectPty={vi.fn()}
          onStopJob={vi.fn()}
        />,
      ),
    );
    const chip = container.querySelector('[data-testid="terminal-job-chip"]');
    if (!(chip instanceof HTMLElement)) {
      throw new Error('job chip was not rendered');
    }
    act(() => {
      chip.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onSelectJob).toHaveBeenCalledWith('job-1');
    expect(loadJobLogs).toHaveBeenCalledWith('job-1');
    expect(openTerminal).toHaveBeenCalledTimes(1);

    act(() =>
      root.render(
        <Harness
          jobs={[makeJob()]}
          selectedJobId="job-1"
          logsById={{ 'job-1': 'listening on :5173\n' }}
          onSelectJob={onSelectJob}
          onSelectPty={vi.fn()}
          onStopJob={vi.fn()}
        />,
      ),
    );
    expect(container.querySelector('[data-testid="terminal-job-log"]')?.textContent).toContain(
      'listening on :5173',
    );
    expect(container.querySelector('[data-testid="terminal-job-pty"]')?.hasAttribute('hidden')).toBe(
      true,
    );
  });
});

describe('openComposerJobLogs', () => {
  it('selects the job, loads logs, and opens the terminal tab', () => {
    const selectJob = vi.fn();
    const loadJobLogs = vi.fn();
    const openTerminal = vi.fn();
    openComposerJobLogs({
      jobId: 'job-9',
      selectJob,
      loadJobLogs,
      openTerminal,
    });
    expect(selectJob).toHaveBeenCalledWith('job-9');
    expect(loadJobLogs).toHaveBeenCalledWith('job-9');
    expect(openTerminal).toHaveBeenCalledTimes(1);
  });
});
