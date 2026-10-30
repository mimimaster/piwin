import { describe, expect, it } from 'vitest';
import { isLocalFilesystemMarkdownMediaSrc, localMarkdownImagePath } from './media-path.js';

describe('isLocalFilesystemMarkdownMediaSrc', () => {
  it('suppresses vault, file, and OS-absolute media paths', () => {
    expect(isLocalFilesystemMarkdownMediaSrc('/Users/me/.piwin/media/session/a.jpg')).toBe(true);
    expect(isLocalFilesystemMarkdownMediaSrc('file:///Users/me/.piwin/media/session/a.jpg')).toBe(
      true,
    );
    expect(isLocalFilesystemMarkdownMediaSrc('~/.piwin/media/session/a.jpg')).toBe(true);
    expect(isLocalFilesystemMarkdownMediaSrc('/tmp/generated.mp4')).toBe(true);
    expect(isLocalFilesystemMarkdownMediaSrc('C:\\Users\\me\\.piwin\\media\\a.png')).toBe(true);
  });

  it('leaves remote and site-relative images alone', () => {
    expect(isLocalFilesystemMarkdownMediaSrc('https://example.com/cat.jpg')).toBe(false);
    expect(isLocalFilesystemMarkdownMediaSrc('/images/hero.png')).toBe(false);
    expect(isLocalFilesystemMarkdownMediaSrc('docs/shot.png')).toBe(false);
  });
});

describe('localMarkdownImagePath', () => {
  it('returns raster image paths under allowed host roots', () => {
    expect(localMarkdownImagePath('/Volumes/BigDisk/Downloads/qr.png')).toBe(
      '/Volumes/BigDisk/Downloads/qr.png',
    );
    expect(localMarkdownImagePath('file:///Users/me/Downloads/a.JPG')).toBe('/Users/me/Downloads/a.JPG');
  });

  it('also allows svg and video paths', () => {
    expect(localMarkdownImagePath('/Users/me/a.svg')).toBe('/Users/me/a.svg');
    expect(localMarkdownImagePath('/tmp/a.mp4')).toBe('/tmp/a.mp4');
  });

  it('rejects vault, traversal, remote and non-image paths', () => {
    expect(localMarkdownImagePath('/Users/me/.piwin/media/s/a.png')).toBeNull();
    expect(localMarkdownImagePath('/Users/me/../../etc/a.png')).toBeNull();
    expect(localMarkdownImagePath('/etc/passwd.png')).toBeNull();
    expect(localMarkdownImagePath('https://example.com/a.png')).toBeNull();
    expect(localMarkdownImagePath('/Users/me/notes.txt')).toBeNull();
  });
});
