// @vitest-environment happy-dom
import { describe, expect, it, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { buildSplitRows, DiffView, parseUnifiedDiff } from './diff-view';

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

  it('renders real old/new line-number gutters in unified mode', () => {
    const patch = ['@@ -10,2 +12,3 @@', ' same', '-old', '+new', '+new2'].join('\n');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(<DiffView patch={patch} mode="unified" path="foo.ts" />);
    });

    const oldNums = container.querySelectorAll('.diff-lineno.old');
    const newNums = container.querySelectorAll('.diff-lineno.new');
    // context: old 10 / new 12 ; del: old 11 ; add: new 13 ; add: new 14
    expect(oldNums[1]?.textContent).toBe('10'); // context
    expect(newNums[1]?.textContent).toBe('12'); // context
    expect(oldNums[2]?.textContent).toBe('11'); // del
    expect(newNums[3]?.textContent).toBe('13'); // add
    expect(newNums[4]?.textContent).toBe('14'); // add
  });
});
