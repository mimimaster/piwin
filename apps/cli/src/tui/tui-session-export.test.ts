import { describe, expect, it } from 'vitest';
import { parseExportArgument } from './tui-session-export.js';

describe('parseExportArgument', () => {
  it('defaults to markdown with no path', () => {
    expect(parseExportArgument('')).toEqual({ ok: true, format: 'md', allBranches: false });
  });

  it('reads format and path in either order after flags', () => {
    expect(parseExportArgument('json ./out/chat.json')).toEqual({
      ok: true,
      format: 'json',
      path: './out/chat.json',
      allBranches: false,
    });
    expect(parseExportArgument('notes.md')).toEqual({
      ok: true,
      format: 'md',
      path: 'notes.md',
      allBranches: false,
    });
    expect(parseExportArgument('html --all-branches /tmp/a.html')).toEqual({
      ok: true,
      format: 'html',
      path: '/tmp/a.html',
      allBranches: true,
    });
  });
});
