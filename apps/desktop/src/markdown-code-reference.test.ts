import { describe, expect, it } from 'vitest';
import {
  dedentCodeLines,
  fileNameFromCodeReferencePath,
  parseCodeReferenceFence,
} from './markdown-code-reference';

describe('parseCodeReferenceFence', () => {
  it('reads start:end:path and infers the language from the extension', () => {
    expect(parseCodeReferenceFence('574:583:apps/desktop/src/workbench-app.tsx')).toEqual({
      startLine: 574,
      endLine: 583,
      path: 'apps/desktop/src/workbench-app.tsx',
      language: 'tsx',
    });
    expect(parseCodeReferenceFence('10:12:tools/build.py')?.language).toBe('python');
  });

  it('ignores ordinary languages and malformed ranges', () => {
    expect(parseCodeReferenceFence('typescript')).toBeNull();
    expect(parseCodeReferenceFence('artifact-html')).toBeNull();
    expect(parseCodeReferenceFence('20:10:src/a.ts')).toBeNull();
    expect(parseCodeReferenceFence('0:3:src/a.ts')).toBeNull();
    expect(parseCodeReferenceFence('12:src/a.ts')).toBeNull();
  });

  it('takes the basename for downloads', () => {
    expect(fileNameFromCodeReferencePath('apps/desktop/src/workbench-app.tsx')).toBe(
      'workbench-app.tsx',
    );
  });
});

describe('dedentCodeLines', () => {
  it('strips the indentation shared by non-blank lines', () => {
    expect(dedentCodeLines(['      if (a) {', '', '        run();', '      }'])).toEqual([
      'if (a) {',
      '',
      '  run();',
      '}',
    ]);
  });

  it('leaves blocks without shared indentation or with mixed tabs untouched', () => {
    const flush = ['def f():', '    return 1'];
    expect(dedentCodeLines(flush)).toEqual(flush);
    const mixed = ['\tfoo', '    bar'];
    expect(dedentCodeLines(mixed)).toEqual(mixed);
  });
});
