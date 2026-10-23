import { describe, expect, it } from 'vitest';
import { isLocalFilesystemMarkdownMediaSrc } from './media-path.js';

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
