import { describe, expect, it } from 'vitest';
import { documentRelativePath, isAbsoluteDiskPath } from './doc-path-actions';

describe('documentRelativePath', () => {
  it('strips the project root', () => {
    expect(documentRelativePath('/repo/docs/plan.md', '/repo')).toBe('docs/plan.md');
    expect(documentRelativePath('/repo/docs/plan.md', '/repo/')).toBe('docs/plan.md');
  });

  it('is null for files outside the project, the root itself, and relative input', () => {
    expect(documentRelativePath('/elsewhere/plan.md', '/repo')).toBeNull();
    expect(documentRelativePath('/repo', '/repo')).toBeNull();
    expect(documentRelativePath('docs/plan.md', '/repo')).toBeNull();
    expect(documentRelativePath('/repo/docs/plan.md', undefined)).toBeNull();
  });

  it('does not treat a sibling directory with the same prefix as inside', () => {
    expect(documentRelativePath('/repo-two/a.md', '/repo')).toBeNull();
  });

  it('handles Windows separators', () => {
    expect(documentRelativePath('C:\\repo\\docs\\a.md', 'C:\\repo')).toBe('docs/a.md');
  });
});

describe('isAbsoluteDiskPath', () => {
  it('recognizes posix and drive paths only', () => {
    expect(isAbsoluteDiskPath('/a/b')).toBe(true);
    expect(isAbsoluteDiskPath('C:/a')).toBe(true);
    expect(isAbsoluteDiskPath('walkthroughs/x.md')).toBe(false);
  });
});
