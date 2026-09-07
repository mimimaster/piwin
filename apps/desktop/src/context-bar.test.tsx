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
    runningJobCount: 0,
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
    runningJobCount: 0,
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
    runningJobCount: 0,
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
    runningJobCount: 0,
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
    expect(container.querySelector('[data-testid="status-seg-idle"]')?.classList.contains('on')).toBe(true);
    expect(container.querySelector('[data-testid="status-seg-running"]')?.classList.contains('on')).toBe(false);
    expect(container.querySelector('[data-testid="status-seg-waiting"]')?.classList.contains('on')).toBe(false);
    expect(container.textContent).toContain('Session Alpha');
    expect(container.textContent).toContain('Project');
  });

  it('renders exactly one role="status" region', () => {
    renderContextBar(createBaseProps({ runState: createWorkingRunStatus() }), root);

    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
  });

  it('renders the persistent session-tree control beside the session title', () => {
    renderContextBar(
      createBaseProps({
        runState: createIdleRunStatus(),
        sessionTreeControl: (
          <button type="button" data-testid="context-session-tree-control">
            Session tree
          </button>
        ),
      }),
      root,
    );

    const identity = container.querySelector('.context-bar-identity');
    const title = identity?.querySelector('.context-bar-title');
    const treeControl = identity?.querySelector('[data-testid="context-session-tree-control"]');
    expect(title?.textContent).toBe('Session Alpha');
    expect(treeControl?.textContent).toBe('Session tree');
    expect(title?.nextElementSibling?.classList.contains('context-bar-session-tree-slot')).toBe(
      true,
    );
  });

  it('highlights the running segment during active work', () => {
    renderContextBar(createBaseProps({ runState: createWorkingRunStatus() }), root);

    const statusRegions = container.querySelectorAll('[data-testid="run-status-strip"]');
    expect(statusRegions).toHaveLength(1);
    expect(statusRegions[0]?.getAttribute('data-kind')).toBe('working');
    expect(container.querySelector('[data-testid="status-seg-running"]')?.classList.contains('on')).toBe(true);
    expect(container.querySelector('[data-testid="status-seg-idle"]')?.classList.contains('on')).toBe(false);
  });

  it('highlights the waiting segment and supports reviewing permission', () => {
    const onReviewPermission = vi.fn();
    renderContextBar(
      createBaseProps({
        runState: {
          kind: 'waiting-permission',
          label: 'Waiting for approval',
          summary: 'Reviewing permission request',
          completedToolCount: 0,
          runningJobCount: 0,
          elapsedMs: 0,
          canStop: false,
          primaryAction: 'review-permission',
        },
        onReviewPermission,
      }),
      root,
    );

    const waitingBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="status-seg-waiting"]',
    );
    expect(waitingBtn?.classList.contains('on')).toBe(true);
    act(() => {
      waitingBtn?.click();
    });
    expect(onReviewPermission).toHaveBeenCalledTimes(1);
  });

  it('shows retry when failed and onRetry is provided', () => {
    const onRetry = vi.fn();
    renderContextBar(createBaseProps({ runState: createFailedRunStatus(), onRetry }), root);

    expect(container.querySelectorAll('[data-testid="run-status-strip"]')).toHaveLength(1);
    expect(
      container.querySelector('[data-testid="run-status-strip"]')?.getAttribute('data-kind'),
    ).toBe('failed');
    expect(container.querySelector('[data-testid="status-seg-idle"]')?.classList.contains('on')).toBe(true);

    const retryButton = Array.from(container.querySelectorAll('button')).find((button) =>
      /Retry|重试/i.test(button.textContent ?? ''),
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
      /Retry|重试/i.test(button.textContent ?? ''),
    );
    expect(retryButton).toBeUndefined();
  });

  it('highlights running segment during stopping transition', () => {
    renderContextBar(createBaseProps({ runState: createStoppingRunStatus() }), root);

    expect(container.querySelectorAll('[data-testid="run-status-strip"]')).toHaveLength(1);
    expect(
      container.querySelector('[data-testid="run-status-strip"]')?.getAttribute('data-kind'),
    ).toBe('stopping');
    expect(container.querySelector('[data-testid="status-seg-running"]')?.classList.contains('on')).toBe(true);
  });

  it('does not host the work-panel toggle until shell chrome props are provided', () => {
    renderContextBar(createBaseProps({ runState: createIdleRunStatus() }), root);

    expect(container.querySelector('[data-testid="right-panel-open-btn"]')).toBeNull();
    expect(container.querySelector('.context-bar-inspector-btn')).toBeNull();
  });

  it('keeps window controls in the titleband whether the sidebar is open or not', () => {
    for (const sessionsExpanded of [true, false]) {
      renderContextBar(
        createBaseProps({
          runState: createIdleRunStatus(),
          sessionsExpanded,
          onToggleSessions: vi.fn(),
          canGoBack: true,
          canGoForward: false,
          onGoBack: vi.fn(),
          onGoForward: vi.fn(),
        }),
        root,
      );

      const toggle = container.querySelector('[data-testid="rail-chats-btn"]');
      expect(toggle).not.toBeNull();
      expect(toggle?.getAttribute('aria-expanded')).toBe(String(sessionsExpanded));
      expect(container.querySelector('[data-testid="titlebar-back-btn"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="titlebar-forward-btn"]')).not.toBeNull();
    }
  });

  it('hosts shell chrome controls when titleband props are provided', () => {
    const onToggleSessions = vi.fn();
    const onToggleWorkPanel = vi.fn();
    const onToggleAppearance = vi.fn();
    renderContextBar(
      createBaseProps({
        runState: createIdleRunStatus(),
        appearanceMode: 'dark',
        sessionsExpanded: false,
        onToggleSessions,
        onToggleWorkPanel,
        onToggleAppearance,
        workPanelOpen: false,
      }),
      root,
    );

    const sessionsToggle = container.querySelector<HTMLButtonElement>(
      '[data-testid="rail-chats-btn"]',
    );
    const workPanelToggle = container.querySelector<HTMLButtonElement>(
      '[data-testid="right-panel-open-btn"]',
    );
    const themeToggle = container.querySelector<HTMLButtonElement>(
      '[data-testid="titlebar-theme-toggle"]',
    );
    expect(sessionsToggle).not.toBeNull();
    expect(workPanelToggle).not.toBeNull();
    expect(themeToggle).not.toBeNull();

    act(() => {
      sessionsToggle?.click();
      workPanelToggle?.click();
      themeToggle?.click();
    });
    expect(onToggleSessions).toHaveBeenCalledTimes(1);
    expect(onToggleWorkPanel).toHaveBeenCalledTimes(1);
    expect(onToggleAppearance).toHaveBeenCalledTimes(1);
  });

  it('supports work-panel toggle even when isConversationSession is true', () => {
    const onToggleWorkPanel = vi.fn();
    renderContextBar(
      createBaseProps({
        runState: createIdleRunStatus(),
        onToggleWorkPanel,
        isConversationSession: true,
      }),
      root,
    );

    expect(container.querySelector('[data-testid="right-panel-open-btn"]')).not.toBeNull();
  });

  it('shows running segment and hides Agent actions', () => {
    renderContextBar(
      createBaseProps({
        runState: createWorkingRunStatus(),
        isConversationSession: true,
        permissionMode: 'auto',
      }),
      root,
    );

    expect(container.querySelector('[data-testid="status-seg-running"]')?.classList.contains('on')).toBe(true);
    expect(container.textContent).not.toContain('read_file');
    expect(container.textContent).not.toContain('Activity');
    expect(container.querySelector('[data-testid="context-bar-mode-badge"]')).not.toBeNull();
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

  it('applies the warning tone to the yolo mode badge', () => {
    renderContextBar(
      createBaseProps({ runState: createIdleRunStatus(), permissionMode: 'yolo' }),
      root,
    );

    const badge = container.querySelector<HTMLButtonElement>(
      '[data-testid="context-bar-mode-badge"]',
    );
    expect(badge).not.toBeNull();
    expect(badge?.getAttribute('data-mode')).toBe('yolo');
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
