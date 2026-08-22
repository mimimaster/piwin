import { describe, expect, it } from 'vitest';
import {
  fileNameFromLocalPath,
  parentDirectoryOf,
  resolveLocalFileAbsolutePath,
} from './local-file-actions.js';

describe('resolveLocalFileAbsolutePath', () => {
  it('keeps absolute paths', () => {
    expect(resolveLocalFileAbsolutePath('/Users/me/a.zip')).toBe('/Users/me/a.zip');
    expect(resolveLocalFileAbsolutePath('C:\\Users\\me\\a.zip')).toBe('C:\\Users\\me\\a.zip');
  });

  it('joins relative paths to the project root', () => {
    expect(resolveLocalFileAbsolutePath('cropped-portraits-16.zip', '/Users/me/proj')).toBe(
      '/Users/me/proj/cropped-portraits-16.zip',
    );
    expect(resolveLocalFileAbsolutePath('./out/a.png', '/p')).toBe('/p/out/a.png');
  });

  it('strips file: scheme', () => {
    expect(resolveLocalFileAbsolutePath('file:///Users/me/a.zip')).toBe('/Users/me/a.zip');
  });
});

describe('parentDirectoryOf', () => {
  it('returns the parent folder', () => {
    expect(parentDirectoryOf('/Users/me/proj/a.zip')).toBe('/Users/me/proj');
    expect(parentDirectoryOf('/Users/me/proj/')).toBe('/Users/me');
  });
});

describe('fileNameFromLocalPath', () => {
  it('returns the basename', () => {
    expect(fileNameFromLocalPath('/Users/me/a.zip')).toBe('a.zip');
    expect(fileNameFromLocalPath('cropped-portraits/')).toBe('cropped-portraits');
  });
});
