// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { DesktopLocaleProvider } from './desktop-locale-context';
import {
  ActiveJobsStrip,
  formatJobElapsed,
  jobDisplayLabel,
  jobPortFromArgs,
  jobStatusDotClass,
  type ActiveJobsStripProps,
} from './active-jobs-strip';
import type { JobRecord } from '@piwin/contracts';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function makeJob(overrides: Partial<JobRecord>): JobRecord {
  return {
    jobId: 'job-1',
    kind: 'service',
    lifetime: 'session',
    command: 'node',
    argv: ['node', 'server.js'],
    cwd: '/project',
    status: 'running',
    ownerSessionId: 'session-1',
    startedAt: '2026-08-13T00:00:00.000Z',
    latestLogCursor: 0,
    ...overrides,
  };
}

function Harness(props: ActiveJobsStripProps): ReactElement {
  return (
    <DesktopLocaleProvider locale="en" onLocaleChange={() => undefined}>
      <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
        <ActiveJobsStrip {...props} />
      </PiwinUiProvider>
    </DesktopLocaleProvider>
  );
}

describe('jobDisplayLabel', () => {
  it('prefers the explicit label', () => {
    expect(jobDisplayLabel(makeJob({ label: 'dev server' }))).toBe('dev server');
  });

  it('falls back to the argv[0] basename', () => {
    expect(jobDisplayLabel(makeJob({ argv: ['/usr/local/bin/vite'] }))).toBe('vite');
  });

  it('falls back to the command and then the kind', () => {
    expect(jobDisplayLabel(makeJob({ argv: [], command: 'pnpm' }))).toBe('pnpm');
    expect(jobDisplayLabel(makeJob({ argv: [], command: '' }))).toBe('service');
  });
});

describe('jobPortFromArgs', () => {
  it('extracts --port / -p / :port forms', () => {
    expect(jobPortFromArgs(makeJob({ argv: ['vite', '--port', '5173'] }))).toBe(5173);
    expect(jobPortFromArgs(makeJob({ argv: ['node', 'server.js', '-p', '8080'] }))).toBe(8080);
    expect(jobPortFromArgs(makeJob({ argv: ['vite', '--port=3000'] }))).toBe(3000);
  });

  it('extracts a bare :port token', () => {
    expect(jobPortFromArgs(makeJob({ argv: ['server', ':9000'] }))).toBe(9000);
  });

  it('ignores privileged ports and junk', () => {
    expect(jobPortFromArgs(makeJob({ argv: ['server', '--port', '80'] }))).toBeNull();
    expect(jobPortFromArgs(makeJob({ argv: ['server', '--port', 'abc'] }))).toBeNull();
    expect(jobPortFromArgs(makeJob({ argv: ['vite'] }))).toBeNull();
  });
});

describe('formatJobElapsed', () => {
  const started = Date.parse('2026-08-13T00:00:00.000Z');

  it('formats seconds and minutes', () => {
    expect(formatJobElapsed(new Date(started).toISOString(), started + 45_000)).toBe('45s');
    expect(formatJobElapsed(new Date(started).toISOString(), started + 192_000)).toBe('3m 12s');
  });

  it('returns empty for invalid timestamps and never negative', () => {
    expect(formatJobElapsed('not-a-date', started)).toBe('');
    expect(formatJobElapsed(new Date(started).toISOString(), started - 5_000)).toBe('0s');
  });
});

describe('jobStatusDotClass', () => {
  it('maps lifecycle statuses to stable classes', () => {
    expect(jobStatusDotClass('starting')).toBe('is-starting');
    expect(jobStatusDotClass('running')).toBe('is-running');
    expect(jobStatusDotClass('ready')).toBe('is-ready');
    expect(jobStatusDotClass('stopping')).toBe('is-stopping');
    expect(jobStatusDotClass('exited')).toBe('is-running');
  });
});

describe('ActiveJobsStrip', () => {
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

  it('renders nothing when there are no active jobs', () => {
    act(() => root.render(<Harness jobs={[]} onStop={vi.fn()} onViewLogs={vi.fn()} />));
    expect(container.querySelector('[data-testid="active-jobs-strip"]')).toBeNull();
  });

  it('renders a chip per job with label and meta', () => {
    const jobs = [
      makeJob({
        jobId: 'job-1',
        label: 'api',
        status: 'ready',
        startedAt: '2026-08-13T00:00:00.000Z',
      }),
      makeJob({
        jobId: 'job-2',
        label: 'build',
        kind: 'command',
        status: 'running',
        argv: ['pnpm', 'build'],
      }),
    ];
    act(() => root.render(<Harness jobs={jobs} onStop={vi.fn()} onViewLogs={vi.fn()} />));
    const chips = container.querySelectorAll('[data-testid="active-job-chip"]');
    expect(chips.length).toBe(2);
    const labels = container.querySelectorAll('.composer-active-job-label');
    expect(labels.length).toBe(2);
    expect(labels[0]?.textContent).toBe('api');
    expect(labels[1]?.textContent).toBe('build');
  });

  it('shows the port when a ready service exposes one', () => {
    const jobs = [
      makeJob({
        label: 'dev server',
        status: 'ready',
        argv: ['vite', '--port', '5173'],
      }),
    ];
    act(() => root.render(<Harness jobs={jobs} onStop={vi.fn()} onViewLogs={vi.fn()} />));
    const meta = container.querySelector('.composer-active-job-meta');
    expect(meta?.textContent).toBe(':5173');
  });

  it('stop button calls onStop without opening logs', () => {
    const onStop = vi.fn();
    const onViewLogs = vi.fn();
    act(() =>
      root.render(
        <Harness jobs={[makeJob({ label: 'api' })]} onStop={onStop} onViewLogs={onViewLogs} />,
      ),
    );
    const stop = container.querySelector('[data-testid="active-job-stop"]');
    if (!(stop instanceof HTMLElement)) {
      throw new Error('stop button was not rendered');
    }
    act(() => {
      stop.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onStop).toHaveBeenCalledWith('job-1');
    expect(onViewLogs).not.toHaveBeenCalled();
  });

  it('clicking the chip body opens logs', () => {
    const onViewLogs = vi.fn();
    act(() =>
      root.render(
        <Harness jobs={[makeJob({ label: 'api' })]} onStop={vi.fn()} onViewLogs={onViewLogs} />,
      ),
    );
    const main = container.querySelector('.composer-active-job-main');
    if (!(main instanceof HTMLElement)) {
      throw new Error('chip body button was not rendered');
    }
    act(() => {
      main.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onViewLogs).toHaveBeenCalledWith('job-1');
  });
});
