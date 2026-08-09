import { describe, expect, it } from 'vitest';
import { resolveProjectEntryAbsolutePath } from './file-tree-path';

describe('resolveProjectEntryAbsolutePath', () => {
  it('joins posix project paths and normalizes separators', () => {
    expect(resolveProjectEntryAbsolutePath('/workspace/', 'src\\index.ts')).toBe(
      '/workspace/src/index.ts',
    );
  });

  it('preserves Windows separators for Windows project paths', () => {
    expect(resolveProjectEntryAbsolutePath('C:\\workspace\\', 'src/index.ts')).toBe(
      'C:\\workspace\\src\\index.ts',
    );
  });

  it('handles a filesystem root without adding a duplicate separator', () => {
    expect(resolveProjectEntryAbsolutePath('/', 'README.md')).toBe('/README.md');
  });
});
