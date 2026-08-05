// @vitest-environment happy-dom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import type { GitDiffSummary, GitStatusSnapshot, HostResponse } from '@piwin/contracts';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { ChangesPanel, type ChangesPanelProps } from './changes-panel';

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

describe('ChangesPanel', () => {
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

  it('lists every uncommitted file and opens a selected file through the shared preview flow', async () => {
    const snapshot: GitStatusSnapshot = {
      repository: { rootPath: '/workspace', isRepository: true },
      branch: {
        currentBranch: 'dev',
        isDetached: false,
        headCommit: 'abc1234',
        upstreamBranch: null,
        ahead: 0,
        behind: 0,
        dirty: true,
      },
      changedFiles: [
        { path: 'src/App.tsx', status: 'modified', staged: false, unstaged: true },
        { path: 'README.md', status: 'untracked', staged: false, unstaged: true },
      ],
      truncated: false,
      totalChangedFiles: 2,
    };
    const diffSummary: GitDiffSummary = {
      repository: snapshot.repository,
      files: [{ path: 'src/App.tsx', status: 'modified', additions: 3, deletions: 1 }],
      totalAdditions: 3,
      totalDeletions: 1,
      truncated: false,
      totalFiles: 1,
    };
    const onOpenFile = vi.fn();
    const request = vi.fn<ChangesPanelProps['request']>(async (command) => {
      if (command.type === 'git/status') {
        return createResponse(command.type, { snapshot });
      }
      if (command.type === 'git/diff-summary') {
        return createResponse(command.type, { summary: diffSummary });
      }
      return {
        id: 'unexpected-response',
        type: 'response',
        command: command.type,
        success: false,
        error: 'unexpected command',
      };
    });

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <ChangesPanel projectPath="/workspace" request={request} onOpenFile={onOpenFile} />
        </PiwinUiProvider>,
      );
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.querySelector('[data-testid="changes-count"]')?.textContent).toContain('2');
    expect(container.textContent).toContain('src/App.tsx');
    expect(container.textContent).toContain('README.md');
    expect(container.querySelector('[data-testid="changes-diff-pane"]')).toBeNull();

    const appRow = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.changes-row-main'),
    ).find((row) => row.textContent?.includes('src/App.tsx'));
    act(() => {
      appRow?.click();
    });

    expect(onOpenFile).toHaveBeenCalledWith('/workspace/src/App.tsx', 'src/App.tsx');
  });
});
