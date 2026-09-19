import { describe, expect, it } from 'vitest';
import { expandGlobVariants, globMatch, globToRegExp, hasGlobMeta, matchesAnyGlob } from './glob-match.js';

describe('hasGlobMeta', () => {
  it('detects wildcards only', () => {
    expect(hasGlobMeta('*.ts')).toBe(true);
    expect(hasGlobMeta('file?.ts')).toBe(true);
    expect(hasGlobMeta('src/app.ts')).toBe(false);
  });
});

describe('globToRegExp', () => {
  it('anchors the pattern', () => {
    expect(globToRegExp('app.ts').test('app.ts')).toBe(true);
    expect(globToRegExp('app.ts').test('myapp.ts')).toBe(false);
  });

  it('keeps * within one path segment and lets ** cross separators', () => {
    expect(globMatch('src/app.ts', '*.ts')).toBe(false);
    expect(globMatch('src/app.ts', 'src/*.ts')).toBe(true);
    expect(globMatch('src/nested/app.ts', '**/*.ts')).toBe(true);
    expect(globMatch('src/nested/app.ts', 'src/**/*.ts')).toBe(true);
  });

  it('escapes regex metacharacters in the pattern', () => {
    expect(globMatch('a+b.ts', 'a+b.ts')).toBe(true);
    expect(globMatch('aab.ts', 'a+b.ts')).toBe(false);
  });

  it('normalizes backslashes and leading ./', () => {
    expect(globMatch('src\\app.ts', './src/app.ts')).toBe(true);
  });
});

describe('expandGlobVariants', () => {
  it('adds a nested variant for a bare name', () => {
    expect(expandGlobVariants('node_modules')).toEqual(['node_modules', '**/node_modules']);
  });

  it('leaves rooted and already-nested patterns alone', () => {
    expect(expandGlobVariants('**/node_modules')).toEqual(['**/node_modules']);
    expect(expandGlobVariants('/abs/path')).toEqual(['/abs/path']);
  });

  it('drops blanks', () => {
    expect(expandGlobVariants('   ')).toEqual([]);
  });

  it('still adds a nested variant when the pattern is not rooted', () => {
    // Only a leading `**/` or `/` suppresses the variant.
    expect(expandGlobVariants('a/**/a')).toEqual(['a/**/a', '**/a/**/a']);
  });

  it('leaves any leading ** alone, including a bare **', () => {
    expect(expandGlobVariants('**')).toEqual(['**']);
    expect(expandGlobVariants('**/')).toEqual(['**/']);
    expect(expandGlobVariants('**/*.ts')).toEqual(['**/*.ts']);
  });

  it('still expands a pattern that only starts with a single *', () => {
    expect(expandGlobVariants('*.min.*')).toEqual(['*.min.*', '**/*.min.*']);
  });
});

describe('matchesAnyGlob', () => {
  it('matches a noise directory at any depth by its bare name', () => {
    // Entries are tested by their own repo-relative path, so a nested
    // directory matches and the walk can prune it structurally.
    expect(matchesAnyGlob('node_modules', ['node_modules'])).toBe(true);
    expect(matchesAnyGlob('packages/app/node_modules', ['node_modules'])).toBe(true);
    expect(matchesAnyGlob('src/app.ts', ['node_modules', 'dist'])).toBe(false);
  });

  it('does not match a file merely because an ancestor is excluded', () => {
    // Pruning happens on the directory entry, not by re-testing every descendant.
    expect(matchesAnyGlob('packages/app/node_modules/dep/index.js', ['node_modules'])).toBe(false);
  });

  it('matches a trailing wildcard against nested paths', () => {
    expect(matchesAnyGlob('src/a/b/c.min.js', ['*.min.*'])).toBe(true);
  });

  it('is false for an empty pattern list', () => {
    expect(matchesAnyGlob('src/app.ts', [])).toBe(false);
  });
});
