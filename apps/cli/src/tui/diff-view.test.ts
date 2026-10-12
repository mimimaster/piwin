import { describe, expect, it } from 'vitest';
import { countPatch, patchBody, renderFileChange } from './diff-view.js';

const ANSI = /\x1b\[[0-9;]*m/g;
const PATCH = [
  'diff --git a/a.ts b/a.ts',
  'index 1..2 100644',
  '--- a/a.ts',
  '+++ b/a.ts',
  '@@ -1,3 +1,9 @@',
  ' keep',
  '-old',
  ...Array.from({ length: 8 }, (_, index) => `+new ${index}`),
  '',
].join('\n');

describe('diff view', () => {
  it('drops file headers and counts changed lines', () => {
    expect(patchBody(PATCH)[0]).toBe('@@ -1,3 +1,9 @@');
    expect(countPatch(PATCH)).toEqual({ additions: 8, deletions: 1 });
  });

  it('folds to a few coloured lines with a hint, and shows everything expanded', () => {
    const change = { path: 'a.ts', status: 'modified' as const, additions: 8, deletions: 1, binary: false, patch: PATCH };
    const folded = renderFileChange(change, 80, false);
    const plain = folded.map((line) => line.replace(ANSI, ''));
    expect(plain[0]).toBe('   修改 a.ts +8 −1');
    expect(plain).toHaveLength(1 + 6 + 1);
    expect(plain.at(-1)).toContain('还有 5 行 · Ctrl+O 展开');
    expect(folded.join('\n')).toContain('\x1b[32m+new 0');
    expect(folded.join('\n')).toContain('\x1b[31m-old');
    const expanded = renderFileChange(change, 80, true).map((line) => line.replace(ANSI, ''));
    expect(expanded).toHaveLength(1 + 11);
    expect(expanded.at(-1)).toContain('+new 7');
  });

  it('shows only the stat line for a binary change without a patch', () => {
    const lines = renderFileChange({ path: 'logo.png', status: 'added', additions: null, deletions: null, binary: true }, 80, false);
    expect(lines.map((line) => line.replace(ANSI, ''))).toEqual(['   新建 logo.png 二进制文件']);
  });
});
