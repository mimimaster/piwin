// @vitest-environment happy-dom
import { act, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import type { GitCommitGraph, GitStatusSnapshot, HostResponse } from '@piwin/contracts';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { GitPanel, type GitPanelProps } from './GitPanel';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function createResponse(command: string, data: unknown): HostResponse {
  return {
    id: `${command}-response`,
    type: 'response',
    command,
    success: true,
    data,
  };
}

describe('GitPanel', () => {
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

  const sampleSnapshot: GitStatusSnapshot = {
    repository: { rootPath: '/workspace/project', isRepository: true },
    branch: {
      currentBranch: 'main',
      isDetached: false,
      headCommit: '507ab878123',
      upstreamBranch: 'origin/main',
      ahead: 0,
      behind: 0,
      dirty: false,
    },
    changedFiles: [],
    truncated: false,
    totalChangedFiles: 0,
  };

  const sampleGraph: GitCommitGraph = {
    repository: sampleSnapshot.repository,
    nodes: [
      {
        hash: '507ab878123',
        shortHash: '507ab87',
        subject: 'docs: first release notes',
        authorName: 'Yorick Jue',
                authorDateIso: new Date(Date.now() - 3600 * 1000 * 2).toISOString(),
        parentHashes: ['cc00fb6c456'],
      },
      {
        hash: 'cc00fb6c456',
        shortHash: 'cc00fb6',
        subject: 'feat: initial implementation',
        authorName: 'Yorick Jue',
                authorDateIso: new Date(Date.now() - 3600 * 1000 * 48).toISOString(),
        parentHashes: [],
      },
    ],
    truncated: false,
  };

  it('renders branch strip and commit timeline with HEAD tag in embedded mode', async () => {
    const request = vi.fn<GitPanelProps['request']>(async (command) => {
      if (command.type === 'git/status') {
        return createResponse(command.type, { snapshot: sampleSnapshot });
      }
      if (command.type === 'git/log-graph') {
        return createResponse(command.type, { graph: sampleGraph });
      }
      return {
        id: 'unexpected',
        type: 'response',
        command: command.type,
        success: false,
        error: 'unexpected',
      };
    });

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <GitPanel projectPath="/workspace/project" request={request} variant="embedded" locale="zh-CN" />
        </PiwinUiProvider>,
      );
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // Branch strip checks
    expect(container.querySelector('.git-branch-name')?.textContent).toBe('main');
    expect(container.querySelector('.git-branch-up')?.textContent).toContain('origin/main');

    // Timeline checks
    const timeline = container.querySelector('[data-testid="git-timeline"]');
    expect(timeline).not.toBeNull();
    expect(timeline?.textContent).toContain('docs: first release notes');
    expect(timeline?.textContent).toContain('HEAD');
    expect(timeline?.textContent).toContain('507ab87');

    // Selected commit card checks
    const card = container.querySelector('[data-testid="git-commit-card"]');
    expect(card).not.toBeNull();
    expect(card?.textContent).toContain('docs: first release notes');
    expect(card?.textContent).toContain('Yorick Jue');
  });

  it('selects a commit on click in timeline', async () => {
    const request = vi.fn<GitPanelProps['request']>(async (command) => {
      if (command.type === 'git/status') {
        return createResponse(command.type, { snapshot: sampleSnapshot });
      }
      if (command.type === 'git/log-graph') {
        return createResponse(command.type, { graph: sampleGraph });
      }
      return {
        id: 'unexpected',
        type: 'response',
        command: command.type,
        success: false,
        error: 'unexpected',
      };
    });

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <GitPanel projectPath="/workspace/project" request={request} variant="embedded" locale="zh-CN" />
        </PiwinUiProvider>,
      );
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const buttons = container.querySelectorAll<HTMLButtonElement>('.git-tl-btn');
    expect(buttons.length).toBe(2);

    // Click the second commit
    act(() => {
      buttons[1]?.click();
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const card = container.querySelector('[data-testid="git-commit-card"]');
    expect(card?.textContent).toContain('feat: initial implementation');
  });

  it('does not refetch when the parent re-renders with equal props', async () => {
    const request = vi.fn<GitPanelProps['request']>(async (command) => {
      if (command.type === 'git/status') {
        return createResponse(command.type, { snapshot: sampleSnapshot });
      }
      if (command.type === 'git/log-graph') {
        return createResponse(command.type, { graph: sampleGraph });
      }
      return {
        id: 'unexpected',
        type: 'response',
        command: command.type,
        success: false,
        error: 'unexpected',
      };
    });

    const mount = (): ReactElement => (
      <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
        <GitPanel projectPath="/workspace/project" request={request} variant="embedded" locale="zh-CN" />
      </PiwinUiProvider>
    );

    act(() => {
      root.render(mount());
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const callsAfterMount = request.mock.calls.length;
    expect(callsAfterMount).toBeGreaterThan(0);

    // Re-render fresh JSX (equal props)
    act(() => {
      root.render(mount());
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(request.mock.calls.length).toBe(callsAfterMount);
  });
});
