import { describe, expect, it } from 'vitest';

import { cutLineRange } from './line-range-cut.js';

const TEXT = ['import a', '', 'function one() {', '  return 1;', '}', '', 'function two() {', '  return 2;', '}', ''].join('\n');

describe('cutLineRange', () => {
  it('cuts a range whose first and last lines match what the caller quoted', () => {
    const cut = cutLineRange({
      text: TEXT,
      startLine: 3,
      endLine: 5,
      startText: 'function one() {',
      endText: '}',
    });
    expect(cut).toEqual({
      ok: true,
      remaining: ['import a', '', '', 'function two() {', '  return 2;', '}', ''].join('\n'),
      block: 'function one() {\n  return 1;\n}\n',
      lineCount: 3,
    });
  });

  it('leaves the replacement where the range was', () => {
    const cut = cutLineRange({
      text: TEXT,
      startLine: 3,
      endLine: 5,
      startText: 'function one() {',
      endText: '}',
      replacement: "export { one } from './one.js';",
    });
    expect(cut.ok && cut.remaining.split('\n').slice(0, 4)).toEqual([
      'import a',
      '',
      "export { one } from './one.js';",
      '',
    ]);
  });

  it('ignores indentation and a trailing carriage return when comparing the quoted lines', () => {
    const cut = cutLineRange({
      text: 'a\r\n  b\r\nc\r\n',
      startLine: 2,
      endLine: 2,
      startText: 'b',
      endText: 'b',
    });
    expect(cut).toMatchObject({ ok: true, remaining: 'a\r\nc\r\n', block: '  b\r\n' });
  });

  it('refuses a mis-numbered range and says where the quoted line is', () => {
    const cut = cutLineRange({
      text: TEXT,
      startLine: 2,
      endLine: 5,
      startText: 'function one() {',
      endText: '}',
    });
    expect(cut).toMatchObject({ ok: false });
    expect(cut.ok ? '' : cut.message).toContain('startText does not match line 2');
    expect(cut.ok ? '' : cut.message).toContain('it appears at line 3');
    expect(cut.ok ? '' : cut.message).toContain('Nothing was changed');
  });

  it('refuses when the last quoted line is not there', () => {
    const cut = cutLineRange({
      text: TEXT,
      startLine: 3,
      endLine: 4,
      startText: 'function one() {',
      endText: '}',
    });
    expect(cut.ok ? '' : cut.message).toContain('endText does not match line 4');
    expect(cut.ok ? '' : cut.message).toContain('it appears at line 5, 9');
  });

  it('refuses ranges outside the file or out of order', () => {
    expect(cutLineRange({ text: TEXT, startLine: 0, endLine: 2, startText: 'x', endText: 'x' }).ok).toBe(false);
    expect(cutLineRange({ text: TEXT, startLine: 5, endLine: 3, startText: 'x', endText: 'x' }).ok).toBe(false);
    const past = cutLineRange({ text: TEXT, startLine: 8, endLine: 40, startText: '  return 2;', endText: '}' });
    expect(past.ok ? '' : past.message).toContain('past the end of the file, which has 9 lines');
  });

  it('keeps a file without a final newline that way while its last line stays last', () => {
    const cut = cutLineRange({ text: 'a\nb\nc', startLine: 1, endLine: 1, startText: 'a', endText: 'a' });
    expect(cut).toMatchObject({ ok: true, remaining: 'b\nc' });
    const tail = cutLineRange({ text: 'a\nb\nc', startLine: 3, endLine: 3, startText: 'c', endText: 'c' });
    expect(tail).toMatchObject({ ok: true, remaining: 'a\nb\n', block: 'c\n' });
  });

  it('empties the file when the whole of it is cut', () => {
    expect(cutLineRange({ text: 'only\n', startLine: 1, endLine: 1, startText: 'only', endText: 'only' })).toMatchObject({
      ok: true,
      remaining: '',
    });
  });
});
