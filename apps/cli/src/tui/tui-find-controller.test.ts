import { describe, expect, it } from 'vitest';
import { markMatches } from './tui-find-controller.js';

const ANSI = /\x1b\[[0-9;]*m/g;

describe('markMatches', () => {
  it('inverts every occurrence of every query word, ignoring case', () => {
    const [line] = markMatches('Login failed; login again', ['login']);
    expect(line?.match(/\x1b\[7mLogin\x1b\[27m/g)).toHaveLength(1);
    expect(line?.match(/\x1b\[7mlogin\x1b\[27m/g)).toHaveLength(1);
  });

  it('leaves the text itself untouched', () => {
    const lines = markMatches('a.b (c)\nsecond line', ['a.b', '(c)']);
    expect(lines.map((line) => line.replace(ANSI, ''))).toEqual(['a.b (c)', 'second line']);
  });

  it('wraps long lines to a reading width and keeps blank lines', () => {
    const lines = markMatches(`${'字'.repeat(120)}\n\nend`, []);
    expect(lines.length).toBeGreaterThan(3);
    expect(lines).toContain('');
  });
});
