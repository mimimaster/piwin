import { describe, expect, it } from 'vitest';
import { parseNumstat } from './diff-summary.js';

describe('parseNumstat', () => {
  it('parses additions/deletions and binary rows', () => {
    const files = parseNumstat(
      ['10\t2\tsrc/a.ts', '-\t-\tassets/logo.png', '0\t5\tsrc/b.ts'].join('\n'),
    );
    expect(files).toHaveLength(3);
    expect(files[0]).toMatchObject({ path: 'src/a.ts', additions: 10, deletions: 2 });
    expect(files[1]).toMatchObject({ path: 'assets/logo.png', additions: 0, deletions: 0 });
    expect(files[2]?.status).toBe('deleted');
  });
});
