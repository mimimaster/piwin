// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactElement } from 'react';
import {
  MAX_GIT_DIFF_SUMMARY_CACHE_ENTRIES,
  clearGitDiffSummaryCacheForTests,
  FilesChangedBar,
  formatDisplayPathParts,
  getRelativeFilePath,
  gitDiffSummaryCacheSizeForTests,
} from './files-changed-bar';
import type { ToolCardUi } from './chat-reducer';

describe('formatDisplayPathParts', () => {
  it('formats absolute path with matching projectPath into relative filename and dirPath', () => {
    const full =
      '/Volumes/BigDisk/Projects/Projects/piwin/docs/plans/2026-08-11-desktop-package-size-reduction.md';
    const project = '/Volumes/BigDisk/Projects/Projects/piwin';

    expect(getRelativeFilePath(full, project)).toBe(
      'docs/plans/2026-08-11-desktop-package-size-reduction.md',
    );

    const parts = formatDisplayPathParts(full, project);
    expect(parts.fileName).toBe('2026-08-11-desktop-package-size-reduction.md');
    expect(parts.dirPath).toBe('docs/plans/');
  });

  it('handles root-level project files without dirPath', () => {
    const full = '/Volumes/BigDisk/Projects/Projects/piwin/package.json';
    const project = '/Volumes/BigDisk/Projects/Projects/piwin';

    const parts = formatDisplayPathParts(full, project);
    expect(parts.fileName).toBe('package.json');
    expect(parts.dirPath).toBe('');
  });

  it('handles missing projectPath gracefully', () => {
    const full = '/some/abs/path/file.ts';
    const parts = formatDisplayPathParts(full, null);
    expect(parts.fileName).toBe('file.ts');
    expect(parts.dirPath).toBe('/some/abs/path/');
  });
});

describe('FilesChangedBar DOM rendering', () => {
  const tools: ToolCardUi[] = [
    {
      toolCallId: 'c1',
      toolName: 'write_file',
      status: 'done',
      output: '',
      presentation: {
        kind: 'filesystem',
        title: 'write_file',
        targetPaths: [
          '/Volumes/BigDisk/Projects/Projects/piwin/docs/plans/2026-08-11-desktop-package-size-reduction.md',
          '/Volumes/BigDisk/Projects/Projects/piwin/scripts/lib/prune-host-node-modules.mjs',
        ],
      },
    },
  ];

  it('renders count and relative path directory when expanded', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    let root: Root | undefined = createRoot(container);

    const onReview = vi.fn();
    act(() => {
      root?.render(
        (
          <FilesChangedBar
            tools={tools}
            projectPath="/Volumes/BigDisk/Projects/Projects/piwin"
            locale="zh-CN"
            onReview={onReview}
          />
        ) as ReactElement,
      );
    });

    expect(container.textContent).toContain('2 个文件已更改');

    const toggle = container.querySelector('[data-testid="files-changed-bar-toggle"]');
    expect(toggle).not.toBeNull();
    act(() => {
      toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.textContent).toContain('2026-08-11-desktop-package-size-reduction.md');
    expect(container.textContent).toContain('docs/plans/');
    expect(container.textContent).toContain('prune-host-node-modules.mjs');
    expect(container.textContent).toContain('scripts/lib/');

    const row = container.querySelector('[data-testid="files-changed-bar-row"]');
    expect(row).not.toBeNull();
    act(() => {
      row?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onReview).toHaveBeenCalledTimes(1);

    act(() => {
      root?.unmount();
    });
    root = undefined;
    container.remove();
  });

  it('bounds cached git summaries across many projects', async () => {
    clearGitDiffSummaryCacheForTests();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const request = vi.fn(async () => ({
      type: 'response' as const,
      command: 'git/diff-summary' as const,
      success: true as const,
      data: { summary: { files: [] } },
    }));

    for (let index = 0; index < MAX_GIT_DIFF_SUMMARY_CACHE_ENTRIES + 5; index += 1) {
      await act(async () => {
        root.render(
          <FilesChangedBar
            tools={tools}
            projectPath={`/workspace-${index}`}
            request={request}
          />,
        );
        await Promise.resolve();
      });
    }

    expect(gitDiffSummaryCacheSizeForTests()).toBe(MAX_GIT_DIFF_SUMMARY_CACHE_ENTRIES);
    act(() => root.unmount());
    container.remove();
    clearGitDiffSummaryCacheForTests();
  });
});
