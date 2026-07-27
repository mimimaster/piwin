import { describe, expect, it } from 'vitest';
import { buildSplitRows, parseUnifiedDiff } from './diff-view';

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
