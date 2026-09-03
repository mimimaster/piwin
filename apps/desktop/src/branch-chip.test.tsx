// @vitest-environment happy-dom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import type { HostResponse } from '@piwin/contracts';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { BranchChip, type BranchChipRequest } from './branch-chip';
import { DesktopLocaleProvider } from './desktop-locale-context';
import { MockHostBackend } from './host-client-mock';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function renderChip(node: ReactElement): { container: HTMLElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <DesktopLocaleProvider locale="en" onLocaleChange={() => undefined}>
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>{node}</PiwinUiProvider>
      </DesktopLocaleProvider>,
    );
  });
  return { container, root };
}

describe('BranchChip', () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    if (container?.parentNode) {
      container.parentNode.removeChild(container);
    }
    root = null;
    container = null;
  });

  it('renders current branch from git/status as plain text link', async () => {
    const request = vi.fn(async (command: { type: string }): Promise<HostResponse> => {
      if (command.type === 'git/status') {
        return {
          id: '1',
          type: 'response',
          command: 'git/status',
          success: true,
          data: {
            snapshot: {
              repository: { rootPath: '/repo', isRepository: true },
              branch: {
                currentBranch: 'feat/demo',
                isDetached: false,
                headCommit: 'abc1234',
                upstreamBranch: null,
                ahead: 0,
                behind: 0,
                dirty: false,
              },
              changedFiles: [],
              truncated: false,
              totalChangedFiles: 0,
            },
          },
        };
      }
      return {
        id: '1',
        type: 'response',
        command: command.type,
        success: false,
        error: 'unexpected',
      };
    });

    const rendered = renderChip(<BranchChip projectPath="/repo" request={request} />);
    root = rendered.root;
    container = rendered.container;

    await act(async () => {
      await Promise.resolve();
    });

    const chip = container.querySelector(
      '[data-testid="composer-branch-chip"]',
    ) as HTMLButtonElement | null;
    expect(chip).not.toBeNull();
    expect(chip?.className).toContain('composer-context-link');
    expect(chip?.textContent).toContain('feat/demo');
    expect(request).toHaveBeenCalledWith({ type: 'git/status', projectPath: '/repo' });
  });

  it('hides when projectPath is null', () => {
    const request = vi.fn(async (): Promise<HostResponse> => ({
      id: '1',
      type: 'response',
      command: 'git/status',
      success: true,
      data: {},
    }));
    const rendered = renderChip(<BranchChip projectPath={null} request={request} />);
    root = rendered.root;
    container = rendered.container;
    expect(container.querySelector('[data-testid="composer-branch-chip"]')).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });

  it('checks out the selected branch after confirmation', async () => {
    const backend = new MockHostBackend(
      () => {},
      () => 'sdk',
    );
    let requestId = 0;
    const request = vi.fn((command: BranchChipRequest) =>
      backend.handle(command, `branch-${++requestId}`),
    );

    const rendered = renderChip(<BranchChip projectPath="/repo" request={request} />);
    root = rendered.root;
    container = rendered.container;

    await act(async () => {
      await Promise.resolve();
    });

    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-testid="composer-branch-chip"]',
    );
    expect(trigger).not.toBeNull();
    act(() => {
      trigger?.dispatchEvent(
        new window.PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }),
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const target = document.querySelector<HTMLButtonElement>(
      '[data-testid="branch-chip-item-feat/demo"]',
    );
    expect(target).not.toBeNull();
    act(() => {
      target?.click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    const confirmButton = document.querySelector<HTMLButtonElement>(
      '[data-testid="confirm-dialog-confirm"]',
    );
    expect(confirmButton).not.toBeNull();
    act(() => {
      confirmButton?.click();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(request).toHaveBeenCalledWith({
      type: 'git/checkout',
      input: { projectPath: '/repo', ref: 'feat/demo' },
    });
    expect(container.querySelector('[data-testid="composer-branch-chip"]')?.textContent).toContain(
      'feat/demo',
    );
  });

  it('surfaces checkout failures through onError instead of staying silent', async () => {
    const onError = vi.fn();
    const request = vi.fn(async (command: BranchChipRequest): Promise<HostResponse> => {
      if (command.type === 'git/status') {
        return {
          id: '1',
          type: 'response',
          command: 'git/status',
          success: true,
          data: {
            snapshot: {
              repository: { rootPath: '/repo', isRepository: true },
              branch: {
                currentBranch: 'main',
                isDetached: false,
                headCommit: 'abc1234',
                upstreamBranch: null,
                ahead: 0,
                behind: 0,
                dirty: false,
              },
              changedFiles: [],
              truncated: false,
              totalChangedFiles: 0,
            },
          },
        };
      }
      if (command.type === 'git/branch-list') {
        return {
          id: '2',
          type: 'response',
          command: 'git/branch-list',
          success: true,
          data: {
            branches: {
              repository: { rootPath: '/repo', isRepository: true },
              branches: [
                { name: 'main', current: true, shortHash: 'abc1234' },
                { name: 'feat/demo', current: false, shortHash: 'def5678' },
              ],
              truncated: false,
              totalBranches: 2,
            },
          },
        };
      }
      return {
        id: '3',
        type: 'response',
        command: 'git/checkout',
        success: false,
        error: 'Your local changes would be overwritten by checkout',
      };
    });

    const rendered = renderChip(
      <BranchChip projectPath="/repo" request={request} onError={onError} />,
    );
    root = rendered.root;
    container = rendered.container;

    await act(async () => {
      await Promise.resolve();
    });
    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-testid="composer-branch-chip"]',
    );
    act(() => {
      trigger?.dispatchEvent(
        new window.PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }),
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => {
      document.querySelector<HTMLButtonElement>('[data-testid="branch-chip-item-feat/demo"]')?.click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    act(() => {
      document.querySelector<HTMLButtonElement>('[data-testid="confirm-dialog-confirm"]')?.click();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onError).toHaveBeenCalledWith('Your local changes would be overwritten by checkout');
  });

  it('opens the occupying worktree instead of checking out', async () => {
    const onOpenWorktreeProject = vi.fn(async () => undefined);
    const request = vi.fn(async (command: BranchChipRequest): Promise<HostResponse> => {
      if (command.type === 'git/status') {
        return {
          id: '1',
          type: 'response',
          command: 'git/status',
          success: true,
          data: {
            snapshot: {
              repository: { rootPath: '/repo', isRepository: true },
              branch: {
                currentBranch: 'main',
                isDetached: false,
                headCommit: 'abc1234',
                upstreamBranch: null,
                ahead: 0,
                behind: 0,
                dirty: false,
              },
              changedFiles: [],
              truncated: false,
              totalChangedFiles: 0,
            },
          },
        };
      }
      if (command.type === 'git/branch-list') {
        return {
          id: '2',
          type: 'response',
          command: 'git/branch-list',
          success: true,
          data: {
            branches: {
              repository: { rootPath: '/repo', isRepository: true },
              branches: [
                { name: 'main', current: true, shortHash: 'abc1234' },
                {
                  name: 'plan/concurrency-convergence',
                  current: false,
                  shortHash: 'def5678',
                  checkedOutWorktreePath: '/Volumes/BigDisk/piwin-cc',
                },
              ],
              truncated: false,
              totalBranches: 2,
            },
          },
        };
      }
      return {
        id: '3',
        type: 'response',
        command: command.type,
        success: false,
        error: 'unexpected',
      };
    });

    const rendered = renderChip(
      <BranchChip
        projectPath="/repo"
        request={request}
        onOpenWorktreeProject={onOpenWorktreeProject}
      />,
    );
    root = rendered.root;
    container = rendered.container;

    await act(async () => {
      await Promise.resolve();
    });
    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-testid="composer-branch-chip"]',
    );
    act(() => {
      trigger?.dispatchEvent(
        new window.PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }),
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => {
      document
        .querySelector<HTMLButtonElement>(
          '[data-testid="branch-chip-item-plan/concurrency-convergence"]',
        )
        ?.click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    const confirmButton = document.querySelector<HTMLButtonElement>(
      '[data-testid="confirm-dialog-confirm"]',
    );
    expect(confirmButton?.textContent).toContain('Work there');
    act(() => {
      confirmButton?.click();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onOpenWorktreeProject).toHaveBeenCalledWith('/Volumes/BigDisk/piwin-cc');
    expect(request).not.toHaveBeenCalledWith({
      type: 'git/checkout',
      input: { projectPath: '/repo', ref: 'plan/concurrency-convergence' },
    });
  });
});
