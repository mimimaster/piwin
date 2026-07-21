import { describe, expect, it } from 'vitest';
import {
  assertSafeBranchName,
  assertSafeCommitMessage,
  assertSafeRef,
  assertSafeRepoRelativePaths,
} from './path-safety.js';

describe('assertSafeRepoRelativePaths', () => {
  it('accepts relative paths', () => {
    expect(assertSafeRepoRelativePaths('/tmp/repo', ['src/a.ts', './b.ts'])).toEqual([
      'src/a.ts',
      'b.ts',
    ]);
  });

  it('rejects absolute and parent escapes', () => {
    expect(() => assertSafeRepoRelativePaths('/tmp/repo', ['/etc/passwd'])).toThrow(/absolute/);
    expect(() => assertSafeRepoRelativePaths('/tmp/repo', ['../secret'])).toThrow(/escapes/);
  });
});

describe('assertSafeBranchName / ref / message', () => {
  it('validates branch names', () => {
    expect(assertSafeBranchName('feature/x')).toBe('feature/x');
    expect(() => assertSafeBranchName('../x')).toThrow();
    expect(() => assertSafeBranchName('-bad')).toThrow();
  });

  it('validates refs and messages', () => {
    expect(assertSafeRef('main')).toBe('main');
    expect(assertSafeCommitMessage('hello')).toBe('hello');
    expect(() => assertSafeCommitMessage('  ')).toThrow();
  });
});
