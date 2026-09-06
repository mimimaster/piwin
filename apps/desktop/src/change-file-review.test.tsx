// @vitest-environment happy-dom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import type { GitFileDiff, HostResponse } from '@piwin/contracts';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { ChangeFileReview } from './change-file-review';

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

describe('ChangeFileReview', () => {
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

  const sampleFileDiff: GitFileDiff = {
    repository: { rootPath: '/workspace', isRepository: true },
    path: 'src/App.tsx',
    scope: 'combined',
    isBinary: false,
    patch: [
      '@@ -1,2 +1,3 @@',
      ' import React from "react";',
      '-export function Old() {}',
      '+export function New() {}',
      '+export function Added() {}',
    ].join('\n'),
    truncated: false,
    additions: 2,
    deletions: 1,
  };

  it('loads and renders diff with unified lines and gutter +/- symbols', async () => {
    const onBack = vi.fn();
    const request = vi.fn(async () => createResponse('git/diff-file', { diff: sampleFileDiff }));

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <ChangeFileReview
            projectPath="/workspace"
            relativePath="src/App.tsx"
            status="modified"
            additions={2}
            deletions={1}
            request={request}
            onBack={onBack}
            locale="zh-CN"
          />
        </PiwinUiProvider>,
      );
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.querySelector('.change-file-header')).not.toBeNull();
    expect(container.querySelector('.diff-view')).not.toBeNull();
    expect(container.textContent).toContain('export function New()');
    expect(container.textContent).toContain('export function Old()');

    // Diff gutters include + and -
    const gutters = container.querySelectorAll('.diff-gutter');
    const gutterTexts = Array.from(gutters).map((g) => g.textContent?.trim());
    expect(gutterTexts).toContain('+');
    expect(gutterTexts).toContain('−');
  });

  it('renders binary file message when file is binary', async () => {
    const binaryDiff: GitFileDiff = {
      repository: { rootPath: '/workspace', isRepository: true },
      path: 'assets/logo.png',
      scope: 'combined',
      isBinary: true,
      patch: '',
      truncated: false,
    };
    const request = vi.fn(async () => createResponse('git/diff-file', { diff: binaryDiff }));

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <ChangeFileReview
            projectPath="/workspace"
            relativePath="assets/logo.png"
            status="added"
            request={request}
            onBack={vi.fn()}
            locale="zh-CN"
          />
        </PiwinUiProvider>,
      );
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).toContain('Binary file — no text diff');
  });

  it('renders unified diff only — no split mode toggle (proto-04 b09)', async () => {
    const request = vi.fn(async () => createResponse('git/diff-file', { diff: sampleFileDiff }));

    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <ChangeFileReview
            projectPath="/workspace"
            relativePath="src/App.tsx"
            status="modified"
            additions={2}
            deletions={1}
            request={request}
            onBack={vi.fn()}
            locale="zh-CN"
          />
        </PiwinUiProvider>,
      );
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.querySelector('[data-testid="change-file-diff-mode"]')).toBeNull();
    expect(container.querySelector('.diff-unified')).not.toBeNull();
    expect(container.querySelector('.diff-split')).toBeNull();
  });
});
