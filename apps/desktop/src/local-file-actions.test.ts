// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import {
  fileNameFromLocalPath,
  parentDirectoryOf,
  resolveLocalFileAbsolutePath,
  revealLocalFileInFolder,
  saveLocalFileAs,
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

describe('revealLocalFileInFolder', () => {
  it('does not open a file manager outside the desktop window', async () => {
    await expect(revealLocalFileInFolder('/Users/me/proj/a.zip')).resolves.toEqual({
      ok: false,
      reason: 'not-desktop',
    });
  });
});

describe('fileNameFromLocalPath', () => {
  it('returns the basename', () => {
    expect(fileNameFromLocalPath('/Users/me/a.zip')).toBe('a.zip');
    expect(fileNameFromLocalPath('cropped-portraits/')).toBe('cropped-portraits');
  });
});

describe('saveLocalFileAs with Host reader', () => {
  it('downloads bytes from the Host reader when asset protocol is unavailable', async () => {
    const click = vi.fn();
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      const element = originalCreateElement(tagName);
      if (tagName === 'a') {
        Object.defineProperty(element, 'click', { value: click });
      }
      return element;
    });

    const result = await saveLocalFileAs('/Users/me/proj/out.zip', {
      readBytes: async () => ({
        fileName: 'out.zip',
        mimeType: 'application/zip',
        bytes: new Uint8Array([1, 2, 3, 4]),
      }),
    });

    expect(result).toEqual({ kind: 'downloaded' });
    expect(click).toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
