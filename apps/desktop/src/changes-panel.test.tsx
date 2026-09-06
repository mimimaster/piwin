// @vitest-environment happy-dom
import { act, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import type {
  GitDiffSummary,
  GitFileDiff,
  GitStatusSnapshot,
  HostResponse,
} from '@piwin/contracts';
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

  const sampleSnapshot: GitStatusSnapshot = {
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

  const sampleDiffSummary: GitDiffSummary = {
    repository: sampleSnapshot.repository,
    files: [{ path: 'src/App.tsx', status: 'modified', additions: 3, deletions: 1 }],
    totalAdditions: 3,
    totalDeletions: 1,
    truncated: false,
    totalFiles: 1,
  };

  const sampleFileDiff: GitFileDiff = {
    repository: sampleSnapshot.repository,
    path: 'src/App.tsx',
    scope: 'combined',
    isBinary: false,
    patch: [
      '@@ -1,3 +1,5 @@',
      ' import React from "react";',
      '-const oldVar = 1;',
      '+const newVar = 2;',
      '+const addedVar = 3;',
    ].join('\n'),
    truncated: false,
    additions: 2,
    deletions: 1,
  };

  it('lists uncommitted files with directory and filename parts', async () => {
    const request = vi.fn<ChangesPanelProps['request']>(async (command) => {
      if (command.type === 'git/status') {
        return createResponse(command.type, { snapshot: sampleSnapshot });
      }
      if (command.type === 'git/diff-summary') {
        return createResponse(command.type, { summary: sampleDiffSummary });
      }
      if (command.type === 'git/diff-file') {
        return createResponse(command.type, { diff: sampleFileDiff });
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
          <ChangesPanel projectPath="/workspace" request={request} locale="zh-CN" />
        </PiwinUiProvider>,
      );
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.querySelector('[data-testid="changes-list"]')?.getAttribute('data-changes-count')).toBe('2');
    expect(container.textContent).toContain('App.tsx');
    expect(container.textContent).toContain('src/');
    expect(container.textContent).toContain('README.md');
    expect(container.textContent).toContain('已暂存');
    expect(container.textContent).toContain('暂存全部');
    expect(container.querySelector('.changes-sec-h')).toBeNull();

    const appDir = container.querySelector('.changes-path-dir');
    expect(appDir?.textContent).toBe('src/');
    const appFile = container.querySelector('.changes-path-file');
    expect(appFile?.textContent).toBe('App.tsx');
  });

  it('does not refetch when the parent re-renders with an equal-props object', async () => {
    // Regression: reload used to depend on the props object identity, so every
    // composer keystroke (parent re-render) re-ran the effect — flashing the
    // loading state and spamming git requests into the open right panel.
    const request = vi.fn<ChangesPanelProps['request']>(async (command) => {
      if (command.type === 'git/status') {
        return createResponse(command.type, { snapshot: sampleSnapshot });
      }
      if (command.type === 'git/diff-summary') {
        return createResponse(command.type, { summary: sampleDiffSummary });
      }
      if (command.type === 'git/diff-file') {
        return createResponse(command.type, { diff: sampleFileDiff });
      }
      return {
        id: 'unexpected-response',
        type: 'response',
        command: command.type,
        success: false,
        error: 'unexpected command',
      };
    });

    const mount = (): ReactElement => (
      <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
        <ChangesPanel projectPath="/workspace" request={request} locale="zh-CN" />
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

    // Re-evaluated JSX: React passes a fresh element/props object with
    // identical field values — exactly what a composer keystroke produces
    // upstream. Rendering the SAME element object would bail out and prove
    // nothing, so this must build a new element per render call.
    act(() => {
      root.render(mount());
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(request.mock.calls.length).toBe(callsAfterMount);
  });

  it('enters in-tab file review on click without leaving Changes tab', async () => {
    const onOpenFile = vi.fn();
    const request = vi.fn<ChangesPanelProps['request']>(async (command) => {
      if (command.type === 'git/status') {
        return createResponse(command.type, { snapshot: sampleSnapshot });
      }
      if (command.type === 'git/diff-summary') {
        return createResponse(command.type, { summary: sampleDiffSummary });
      }
      if (command.type === 'git/diff-file') {
        return createResponse(command.type, { diff: sampleFileDiff });
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
          <ChangesPanel
            projectPath="/workspace"
            request={request}
            onOpenFile={onOpenFile}
            locale="zh-CN"
          />
        </PiwinUiProvider>,
      );
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const appRow = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.changes-row-main'),
    ).find((row) => row.textContent?.includes('App.tsx'));

    act(() => {
      appRow?.click();
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // Does NOT call the legacy onOpenFile (which would switch to Document tab)
    expect(onOpenFile).not.toHaveBeenCalled();

    // List stays up; the selected file's diff sits under it.
    expect(container.querySelector('[data-testid="changes-list"]')).not.toBeNull();
    const review = container.querySelector('[data-testid="change-file-review"]');
    expect(review).not.toBeNull();
    expect(container.querySelector('[data-testid="change-file-header"]')).not.toBeNull();
    expect(container.textContent).toContain('src/');
    expect(container.textContent).toContain('App.tsx');
    expect(container.querySelector('[data-testid="change-file-status-badge"]')?.textContent).toBe('M');

    const backBtn = container.querySelector<HTMLButtonElement>('[data-testid="change-file-back"]');
    expect(backBtn).not.toBeNull();
    act(() => {
      backBtn?.click();
    });

    expect(container.querySelector('[data-testid="change-file-review"]')).toBeNull();
    expect(container.querySelector('[data-testid="changes-list"]')).not.toBeNull();
  });

  it('restores list view on Escape key in file review mode', async () => {
    const request = vi.fn<ChangesPanelProps['request']>(async (command) => {
      if (command.type === 'git/status') {
        return createResponse(command.type, { snapshot: sampleSnapshot });
      }
      if (command.type === 'git/diff-summary') {
        return createResponse(command.type, { summary: sampleDiffSummary });
      }
      if (command.type === 'git/diff-file') {
        return createResponse(command.type, { diff: sampleFileDiff });
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
          <ChangesPanel projectPath="/workspace" request={request} />
        </PiwinUiProvider>,
      );
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const appRow = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.changes-row-main'),
    ).find((row) => row.textContent?.includes('App.tsx'));

    act(() => {
      appRow?.click();
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.querySelector('[data-testid="change-file-review"]')).not.toBeNull();

    // Trigger Escape key event
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(container.querySelector('[data-testid="change-file-review"]')).toBeNull();
    expect(container.querySelector('[data-testid="changes-list"]')).not.toBeNull();
  });
});
