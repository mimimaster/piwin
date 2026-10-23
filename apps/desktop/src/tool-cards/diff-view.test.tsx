// @vitest-environment happy-dom
import { describe, expect, it, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { buildSplitRows, DiffView, isHighlightableDiffLine, parseUnifiedDiff } from './diff-view';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('diff-view parse', () => {
  it('parses unified lines', () => {
    const lines = parseUnifiedDiff(
      ['diff --git a/a b/a', '--- a/a', '+++ b/a', '@@ -1 +1 @@', '-old', '+new', ' same'].join(
        '\n',
      ),
    );
    expect(lines.map((line) => line.kind)).toEqual([
      'meta',
      'meta',
      'meta',
      'hunk',
      'del',
      'add',
      'context',
    ]);
  });

  it('pairs del/add into split rows', () => {
    const lines = parseUnifiedDiff(['@@ -1 +1 @@', '-a', '-b', '+c', ' keep'].join('\n'));
    const rows = buildSplitRows(lines);
    expect(rows).toHaveLength(3);
    expect(rows[0]?.left?.kind).toBe('del');
    expect(rows[0]?.right?.kind).toBe('add');
    expect(rows[2]?.left?.text).toBe('keep');
  });

  it('only sends source lines through syntax highlighting', () => {
    expect(isHighlightableDiffLine({ kind: 'hunk', text: '@@ -1 +1 @@' })).toBe(false);
    expect(isHighlightableDiffLine({ kind: 'meta', text: 'diff --git a/a b/a' })).toBe(false);
    expect(isHighlightableDiffLine({ kind: 'add', text: 'const next = true;' })).toBe(true);
  });
});

describe('DiffView render', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    if (root && container) {
      act(() => {
        root?.unmount();
      });
      container.remove();
    }
    root = undefined;
    container = undefined;
  });

  it('renders one contextual line-number gutter in unified mode', () => {
    const patch = ['@@ -10,2 +12,3 @@', ' same', '-old', '+new', '+new2'].join('\n');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(<DiffView patch={patch} mode="unified" path="foo.ts" />);
    });

    const numbers = Array.from(container.querySelectorAll('.diff-lineno'));
    expect(numbers.map((number) => number.textContent)).toEqual(['12', '11', '13', '14']);
    expect(numbers.map((number) => number.getAttribute('data-line-source'))).toEqual([
      'new',
      'old',
      'new',
      'new',
    ]);
  });

  it('hides redundant metadata and replaces raw hunk headers with localized summaries', () => {
    const patch = [
      'diff --git a/foo.ts b/foo.ts',
      'index 1111111..2222222 100644',
      '--- a/foo.ts',
      '+++ b/foo.ts',
      '@@ -1,2 +1,2 @@',
      '-old',
      '+new',
      ' same',
      '@@ -10 +10 @@',
      ' later',
    ].join('\n');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <DiffView
          patch={patch}
          mode="unified"
          path="foo.ts"
          hideHeader
          hideMetadata
          locale="zh-CN"
        />,
      );
    });

    expect(container.querySelector('.diff-line.kind-meta')).toBeNull();
    expect(container.querySelectorAll('.diff-line.kind-hunk')).toHaveLength(1);
    expect(container.querySelector('.diff-hunk-summary')?.textContent).toBe('未修改 7 行');
    expect(container.textContent).not.toContain('@@');
  });
});
