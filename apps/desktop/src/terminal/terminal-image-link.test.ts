import { describe, expect, it } from 'vitest';
import { findTerminalImageLink } from './terminal-image-link.js';

const screen = (rows: string[]) => (row: number): string | undefined => rows[row];
const grok = [
  '  ◆ imagine girl',
  '  /Users/me/.grok/sessions//Volumes/BigDisk/Pro...in/01a129a2-9607/images/1.jpg',
  '',
  '                         [Open Image]',
  '',
  '  The image has been generated and saved to images/1.jpg.',
];

describe('findTerminalImageLink', () => {
  it('resolves the button to the file printed above it', () => {
    expect(findTerminalImageLink(screen(grok), 3, 30)).toEqual({ fileName: '1.jpg', startCol: 25, endCol: 37 });
  });

  it('only reacts on the button cells', () => {
    expect(findTerminalImageLink(screen(grok), 3, 24)).toBeNull();
    expect(findTerminalImageLink(screen(grok), 3, 37)).toBeNull();
    expect(findTerminalImageLink(screen(grok), 1, 30)).toBeNull();
    expect(findTerminalImageLink(screen(grok), 99, 0)).toBeNull();
  });

  it('never borrows the path of an earlier image', () => {
    const rows = [' .../images/first.png', '  [Open Image]', ' text only', '  [Open Image]'];
    expect(findTerminalImageLink(screen(rows), 1, 4)?.fileName).toBe('first.png');
    expect(findTerminalImageLink(screen(rows), 3, 4)).toBeNull();
  });

  it('does not search beyond the rows right above the button', () => {
    const rows = [' .../images/old.png', ...Array.from({ length: 9 }, () => ''), '  [Open Image]'];
    expect(findTerminalImageLink(screen(rows), 10, 4)).toBeNull();
  });

  it('returns a base name, never a path', () => {
    const rows = [' images/../../etc/passwd images/ok-2.webp', '  [Open Image]'];
    expect(findTerminalImageLink(screen(rows), 1, 4)?.fileName).toBe('ok-2.webp');
  });
});
