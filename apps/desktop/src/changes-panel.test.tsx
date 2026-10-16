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


  function makeRequest(snapshot: GitStatusSnapshot) {
    return vi.fn<ChangesPanelProps['request']>(async (command) => {
      switch (command.type) {
        case 'git/status':
          return createResponse(command.type, { snapshot });
        case 'git/diff-summary':
          return createResponse(command.type, { summary: sampleDiffSummary });
        case 'git/diff-file':
          return createResponse(command.type, {
            diff: { ...sampleFileDiff, path: command.path, scope: command.scope ?? 'combined' },
          });
        case 'git/stage':
        case 'git/unstage':
        case 'git/commit':
          return createResponse(command.type, { result: { ok: true } });
      }
    });
  }

  async function settle(): Promise<void> {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  function mountPanel(props: Partial<ChangesPanelProps> & Pick<ChangesPanelProps, 'request'>): ReactElement {
    return (
      <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
        <ChangesPanel projectPath="/workspace" locale="zh-CN" {...props} />
      </PiwinUiProvider>
    );
  }

  const q = (testId: string): HTMLElement | null =>
    container.querySelector(`[data-testid="${testId}"]`);
  const all = (testId: string): HTMLElement[] =>
    [...container.querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`)];
  const section = (path: string): HTMLElement | null =>
    container.querySelector(`[data-testid="changes-file"][data-path="${path}"]`);

  it('stacks every uncommitted file with its diff open under one toolbar', async () => {
    const request = makeRequest(sampleSnapshot);
    act(() => root.render(mountPanel({ request })));
    await settle();

    expect(q('changes-files')?.getAttribute('data-changes-count')).toBe('2');
    expect(q('changes-scope-trigger')?.textContent).toContain('未提交');
    expect(q('changes-scope-trigger')?.textContent).toContain('+3');
    const app = section('src/App.tsx');
    expect(app?.querySelector('.changes-path-dir')?.textContent).toBe('src/');
    expect(app?.querySelector('.changes-path-file')?.textContent).toBe('App.tsx');
    // Both files open by default, each with its own patch against HEAD.
    expect(all('changes-file').every((node) => node.classList.contains('expanded'))).toBe(true);
    expect(container.querySelectorAll('.diff-view').length).toBe(2);
    const diffCalls = request.mock.calls.filter(([command]) => command.type === 'git/diff-file');
    expect(diffCalls.map(([command]) => (command as { scope?: string }).scope)).toEqual([
      'combined',
      'combined',
    ]);
    expect(q('changes-commit-trigger')).not.toBeNull();
  });

  it('does not refetch when the parent re-renders with an equal-props object', async () => {
    // Regression: reload used to depend on the props object identity, so every
    // composer keystroke (parent re-render) re-ran the effect — flashing the
    // loading state and spamming git requests into the open right panel.
    const request = makeRequest(sampleSnapshot);

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

  it('collapses a section without dropping it from the stack', async () => {
    const request = makeRequest(sampleSnapshot);
    act(() => root.render(mountPanel({ request })));
    await settle();

    const toggle = section('README.md')?.querySelector<HTMLButtonElement>('[data-testid="changes-file-toggle"]');
    act(() => toggle?.click());
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(section('README.md')?.querySelector('.changes-file-body')).toBeNull();
    expect(section('src/App.tsx')?.querySelector('.changes-file-body')).not.toBeNull();
  });

  it('stages and unstages a single file from its checkbox without a confirm step', async () => {
    const snapshot: GitStatusSnapshot = {
      ...sampleSnapshot,
      changedFiles: [
        { path: 'src/App.tsx', status: 'modified', staged: true, unstaged: false },
        { path: 'README.md', status: 'untracked', staged: false, unstaged: true },
        { path: 'src/half.ts', status: 'modified', staged: true, unstaged: true },
      ],
      totalChangedFiles: 3,
    };
    const request = makeRequest(snapshot);
    act(() => root.render(mountPanel({ request })));
    await settle();

    const check = (path: string) =>
      section(path)?.querySelector<HTMLInputElement>('[data-testid="changes-stage-check"]');
    expect(check('src/App.tsx')?.checked).toBe(true);
    expect(check('README.md')?.checked).toBe(false);
    expect(check('src/half.ts')?.indeterminate).toBe(true);

    act(() => check('README.md')?.click());
    await settle();
    act(() => check('src/App.tsx')?.click());
    await settle();

    const mutations = request.mock.calls
      .map(([command]) => command)
      .filter((command) => command.type === 'git/stage' || command.type === 'git/unstage');
    expect(mutations).toEqual([
      { type: 'git/stage', input: { projectPath: '/workspace', paths: ['README.md'] } },
      { type: 'git/unstage', input: { projectPath: '/workspace', paths: ['src/App.tsx'] } },
    ]);
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it('shows an empty staged scope that points at the scopes with changes', async () => {
    const request = makeRequest(sampleSnapshot);
    act(() => root.render(mountPanel({ request, scope: 'staged' })));
    await settle();

    expect(q('changes-panel')?.getAttribute('data-changes-scope')).toBe('staged');
    expect(q('changes-empty')?.textContent).toContain('「已暂存」中没有变更');
    expect(q('changes-empty-scope-staged')).toBeNull();
    expect(q('changes-empty-scope-unstaged')?.textContent).toContain('2');

    act(() => q('changes-empty-scope-unstaged')?.click());
    await settle();
    expect(q('changes-panel')?.getAttribute('data-changes-scope')).toBe('unstaged');
    const lastDiff = request.mock.calls.filter(([command]) => command.type === 'git/diff-file').at(-1);
    expect((lastDiff?.[0] as { scope?: string }).scope).toBe('worktree');
  });

  it('commits through the popover, staging everything first when nothing is staged', async () => {
    const request = makeRequest(sampleSnapshot);
    act(() => root.render(mountPanel({ request })));
    await settle();

    act(() => q('changes-commit-trigger')?.click());
    await settle();
    expect(document.querySelector('[data-testid="changes-commit-consequence"]')?.textContent).toContain(
      '将暂存全部 2 个文件并提交',
    );
    const textarea = document.querySelector<HTMLTextAreaElement>('[data-testid="changes-commit-message"] textarea, textarea[data-testid="changes-commit-message"]');
    expect(textarea).not.toBeNull();
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(textarea, 'feat: scope picker');
      textarea?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => document.querySelector<HTMLButtonElement>('[data-testid="changes-commit-submit"]')?.click());
    await settle();

    const mutations = request.mock.calls
      .map(([command]) => command)
      .filter((command) => command.type === 'git/stage' || command.type === 'git/commit');
    expect(mutations).toEqual([
      { type: 'git/stage', input: { projectPath: '/workspace', paths: [] } },
      { type: 'git/commit', input: { projectPath: '/workspace', message: 'feat: scope picker' } },
    ]);
  });

  it('renders a requested slot scope and falls back to the tree when the slot is absent', async () => {
    const request = makeRequest(sampleSnapshot);
    act(() =>
      root.render(
        mountPanel({
          request,
          scope: 'turn',
          turn: { content: <div data-testid="turn-body">turn</div>, tally: { files: 4, additions: 9, deletions: 2 } },
        }),
      ),
    );
    await settle();
    expect(q('turn-body')).not.toBeNull();
    expect(q('changes-scope-trigger')?.textContent).toContain('本轮变更');
    expect(q('changes-scope-trigger')?.textContent).toContain('+9');
    expect(q('changes-commit-trigger')).toBeNull();

    act(() => root.render(mountPanel({ request, scope: 'turn' })));
    await settle();
    expect(q('turn-body')).toBeNull();
    expect(q('changes-panel')?.getAttribute('data-changes-scope')).toBe('uncommitted');
  });
});
