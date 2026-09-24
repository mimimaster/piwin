import { describe, expect, it } from 'vitest';
import { RepositorySubdirError, normalizeRepositorySubdir } from './repository-subdir.js';

describe('normalizeRepositorySubdir', () => {
  it('keeps the repository root for empty input', () => {
    expect(normalizeRepositorySubdir(undefined)).toBe('');
    expect(normalizeRepositorySubdir('')).toBe('');
    expect(normalizeRepositorySubdir('.')).toBe('');
  });

  it('normalizes separators and dot segments inside the repository', () => {
    expect(normalizeRepositorySubdir('skills/review')).toBe('skills/review');
    expect(normalizeRepositorySubdir('./skills//review/')).toBe('skills/review');
    expect(normalizeRepositorySubdir('skills\\review')).toBe('skills/review');
  });

  it.each(['../outside', 'skills/../../outside', 'a/..', '/tmp/outside', '\\\\server\\share', 'C:\\x', 'C:/x', 'a\0b'])(
    'rejects %j',
    (subdir) => {
      expect(() => normalizeRepositorySubdir(subdir)).toThrow(RepositorySubdirError);
    },
  );
});
