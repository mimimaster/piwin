import { describe, expect, it } from 'vitest';
import { highlightCode } from './code-highlight.js';

const ANSI = /\x1b\[[0-9;]*m/g;
const plain = (lines: string[]): string => lines.map((line) => line.replace(ANSI, '')).join('\n');

describe('highlightCode', () => {
  it('never changes the text, only colors it', () => {
    const code = 'def f(n: int) -> str:\n    """doc\n    more"""\n    return "x" # tail\n';
    expect(plain(highlightCode(code, 'python'))).toBe(code);
  });

  it('colors keywords, strings, numbers and comments', () => {
    const [line] = highlightCode('return "a" + 42 # note', 'python');
    expect(line).toContain('\x1b[35mreturn\x1b[39m');
    expect(line).toContain('\x1b[32m"a"\x1b[39m');
    expect(line).toContain('\x1b[33m42\x1b[39m');
    expect(line).toContain('\x1b[90m# note\x1b[39m');
  });

  it('does not color keywords inside identifiers or strings', () => {
    const [line] = highlightCode('classify("if")', 'python');
    expect(line).not.toContain('\x1b[35m');
  });

  it('paints a block comment on every line it spans, one line per line of code', () => {
    const lines = highlightCode('a /* x\ny */ b', 'javascript');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('\x1b[90m/* x\x1b[39m');
    expect(lines[1]).toContain('\x1b[90my */\x1b[39m');
  });

  it('treats // as code in Python but as a comment in Rust', () => {
    expect(highlightCode('a // b', 'python')[0]).not.toContain('\x1b[90m');
    expect(highlightCode('a // b', 'rust')[0]).toContain('\x1b[90m');
  });

  it('survives an unterminated string', () => {
    expect(plain(highlightCode('x = "open\ny = 1', 'python'))).toBe('x = "open\ny = 1');
  });

  it('answers aliases and leaves unknown languages uncolored', () => {
    expect(highlightCode('let x = 1', 'ts')[0]).toContain('\x1b[35mlet');
    expect(highlightCode('let x = 1', 'brainfuck')).toEqual(['let x = 1']);
    expect(highlightCode('let x = 1')).toEqual(['let x = 1']);
  });
});
