// @vitest-environment happy-dom
/**
 * ContextBar presentation coverage for slice R2.
 * Uses the same happy-dom + createRoot pattern as chat-thread.test.tsx.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens.js';
import { ContextBar, type ContextBarProps } from './context-bar.js';
import type { RunStatusView } from './run-status.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function createIdleRunStatus(): RunStatusView {
  return {
    kind: 'idle',
    label: 'Idle',
    summary: 'Ready',
    completedToolCount: 0,
    runningProcessCount: 0,
    canStop: false,
  };
}

function createWorkingRunStatus(): RunStatusView {
  return {
    kind: 'working',
    label: 'Working',
    summary: 'Running read_file',
    activeToolName: 'read_file',
    completedToolCount: 1,
    runningProcessCount: 0,
    primaryAction: 'view-activity',
    canStop: true,
    elapsedMs: 12_500,
  };
}

function createFailedRunStatus(): RunStatusView {
  return {
    kind: 'failed',
    label: 'Run failed',
    summary: 'Model unavailable',
    completedToolCount: 0,
    runningProcessCount: 0,
    primaryAction: 'retry',
    canStop: false,
  };
}

function createStoppingRunStatus(): RunStatusView {
  return {
    kind: 'stopping',
    label: 'Stopping',
    summary: 'Stopping the current agent run…',
    completedToolCount: 0,
    runningProcessCount: 0,
    canStop: false,
    elapsedMs: 3_000,
  };
}

function createBaseProps(
  overrides: Partial<ContextBarProps> & { runState: RunStatusView },
): ContextBarProps {
  return {
    session: {
      title: 'Session Alpha',
      scopeLabel: 'Project',
    },
    onStop: vi.fn(),
    onViewActivity: vi.fn(),
    onReviewPermission: vi.fn(),
    onViewPlan: vi.fn(),
    onCancelCompact: vi.fn(),
    locale: 'en',
    ...overrides,
  };
}

function renderContextBar(props: ContextBarProps, root: Root): void {
  const tree: ReactElement = (
    <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
      <ContextBar {...props} />
    </PiwinUiProvider>
  );
  act(() => {
    root.render(tree);
  });
}

describe('ContextBar', () => {
  let container: HTMLElement;
  let root: Root;
  let previousActEnvironment: boolean | undefined;

  beforeEach(() => {
    previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  it('renders a single status region while idle', () => {
    renderContextBar(createBaseProps({ runState: createIdleRunStatus() }), root);

    const statusRegions = container.querySelectorAll('[data-testid="run-status-strip"]');
    expect(statusRegions).toHaveLength(1);
    expect(statusRegions[0]?.getAttribute('data-kind')).toBe('idle');
    expect(container.querySelector('[data-testid="workspace-context-header"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="run-status-stop"]')).toBeNull();
    expect(container.querySelector('[data-testid="run-status-stopping"]')).toBeNull();
    expect(container.querySelector('.context-bar-status-label')).toBeNull();
    expect(container.textContent).toContain('Session Alpha');
    expect(container.textContent).toContain('Project');
  });

  it('renders exactly one role="status" region', () => {
    renderContextBar(createBaseProps({ runState: createWorkingRunStatus() }), root);

    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
  });

  it('formats elapsed time over one minute as "1m 15s"', () => {
    renderContextBar(
      createBaseProps({ runState: { ...createWorkingRunStatus(), elapsedMs: 75_000 } }),
      root,
    );

    expect(container.querySelector('.context-bar-elapsed')?.textContent).toBe('1m 15s');
  });

  it('shows stop when primary run can be stopped', () => {
    const onStop = vi.fn();
    renderContextBar(createBaseProps({ runState: createWorkingRunStatus(), onStop }), root);

    const statusRegions = container.querySelectorAll('[data-testid="run-status-strip"]');
    expect(statusRegions).toHaveLength(1);
    expect(statusRegions[0]?.getAttribute('data-kind')).toBe('working');
    expect(container.textContent).toContain('Running read_file');
    expect(container.textContent).toContain('12s');

    const stopButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="run-status-stop"]',
    );
    expect(stopButton).not.toBeNull();
    expect(stopButton?.textContent).toMatch(/Stop/i);

    act(() => {
      stopButton?.click();
    });
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('shows retry when failed and onRetry is provided', () => {
    const onRetry = vi.fn();
    renderContextBar(createBaseProps({ runState: createFailedRunStatus(), onRetry }), root);

    expect(container.querySelectorAll('[data-testid="run-status-strip"]')).toHaveLength(1);
    expect(
      container.querySelector('[data-testid="run-status-strip"]')?.getAttribute('data-kind'),
    ).toBe('failed');
    expect(container.querySelector('.context-bar-phase-dot.is-error')).not.toBeNull();
    expect(container.querySelector('[data-testid="run-status-stop"]')).toBeNull();

    const retryButton = Array.from(container.querySelectorAll('button')).find((button) =>
      /Retry/i.test(button.textContent ?? ''),
    );
    expect(retryButton).toBeDefined();

    act(() => {
      retryButton?.click();
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('does not show retry when failed without onRetry', () => {
    renderContextBar(createBaseProps({ runState: createFailedRunStatus() }), root);

    const retryButton = Array.from(container.querySelectorAll('button')).find((button) =>
      /Retry/i.test(button.textContent ?? ''),
    );
    expect(retryButton).toBeUndefined();
  });

  it('shows stopping label and hides stop while stopping', () => {
    renderContextBar(createBaseProps({ runState: createStoppingRunStatus() }), root);

    expect(container.querySelectorAll('[data-testid="run-status-strip"]')).toHaveLength(1);
    expect(
      container.querySelector('[data-testid="run-status-strip"]')?.getAttribute('data-kind'),
    ).toBe('stopping');
    expect(container.querySelector('[data-testid="run-status-stop"]')).toBeNull();
    const stoppingLabel = container.querySelector('[data-testid="run-status-stopping"]');
    expect(stoppingLabel).not.toBeNull();
    expect(stoppingLabel?.textContent).toMatch(/Stopping/i);
  });

  it('does not host the work-panel toggle (lives on titleband)', () => {
    renderContextBar(createBaseProps({ runState: createIdleRunStatus() }), root);

    expect(container.querySelector('[data-testid="right-panel-open-btn"]')).toBeNull();
    expect(container.querySelector('.context-bar-inspector-btn')).toBeNull();
  });

  it('renders a permission mode badge when permissionMode is provided', () => {
    const onOpenPermissions = vi.fn();
    renderContextBar(
      createBaseProps({
        runState: createIdleRunStatus(),
        permissionMode: 'auto',
        onOpenPermissions,
      }),
      root,
    );

    const badge = container.querySelector<HTMLButtonElement>(
      '[data-testid="context-bar-mode-badge"]',
    );
    expect(badge).not.toBeNull();
    expect(badge?.getAttribute('data-mode')).toBe('auto');
    expect(badge?.classList.contains('is-warning')).toBe(false);

    act(() => {
      badge?.click();
    });
    expect(onOpenPermissions).toHaveBeenCalledTimes(1);
  });

  it('applies the warning tone to the bypass mode badge', () => {
    renderContextBar(
      createBaseProps({ runState: createIdleRunStatus(), permissionMode: 'bypass' }),
      root,
    );

    const badge = container.querySelector<HTMLButtonElement>(
      '[data-testid="context-bar-mode-badge"]',
    );
    expect(badge).not.toBeNull();
    expect(badge?.getAttribute('data-mode')).toBe('bypass');
    expect(badge?.classList.contains('is-warning')).toBe(true);
  });

  it('omits the permission mode badge when permissionMode is null', () => {
    renderContextBar(
      createBaseProps({ runState: createIdleRunStatus(), permissionMode: null }),
      root,
    );

    expect(container.querySelector('[data-testid="context-bar-mode-badge"]')).toBeNull();
  });
});
