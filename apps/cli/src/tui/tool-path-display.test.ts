import { describe, expect, it } from 'vitest';
import { shortenPaths } from './tool-path-display.js';

describe('shortenPaths', () => {
  const roots = ['/work/proj'];

  it('drops the project root from a path', () => {
    expect(shortenPaths('/work/proj/src/a.ts', roots)).toBe('src/a.ts');
  });

  it('shortens every path in a command line', () => {
    expect(shortenPaths('cat /work/proj/a.md /work/proj/docs/b.md', roots)).toBe('cat a.md docs/b.md');
  });

  it('names the root itself as the current directory', () => {
    expect(shortenPaths('ls /work/proj', roots)).toBe('ls .');
  });

  it('leaves a sibling that only shares the root’s prefix alone', () => {
    expect(shortenPaths('/work/proj-old/a.ts', roots)).toBe('/work/proj-old/a.ts');
  });

  it('prefers the longer root when roots nest', () => {
    expect(shortenPaths('/work/proj/wt/a.ts', ['/work/proj', '/work/proj/wt'])).toBe('a.ts');
  });

  it('keeps text without paths unchanged', () => {
    expect(shortenPaths('python3 fizz.py', roots)).toBe('python3 fizz.py');
  });
});
