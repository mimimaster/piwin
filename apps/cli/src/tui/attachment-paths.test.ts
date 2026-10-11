import { homedir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findAbsolutePathTokens, parsePathArgument, parsePathArguments } from './attachment-paths.js';

describe('path arguments', () => {
  it('resolves relative, home and absolute paths', () => {
    expect(parsePathArgument('shots/a.png', '/work')).toBe('/work/shots/a.png');
    expect(parsePathArgument('~/a.png', '/work')).toBe(path.join(homedir(), 'a.png'));
    expect(parsePathArgument('/tmp/a.png', '/work')).toBe('/tmp/a.png');
  });

  it('reads the forms a terminal produces for a dropped file', () => {
    expect(parsePathArgument('/tmp/My\\ Shot\\ \\(1\\).png', '/')).toBe('/tmp/My Shot (1).png');
    expect(parsePathArgument("'/tmp/My Shot.png'", '/')).toBe('/tmp/My Shot.png');
    expect(parsePathArgument('"/tmp/My Shot.png"', '/')).toBe('/tmp/My Shot.png');
    expect(parsePathArgument('file:///tmp/My%20Shot.png', '/')).toBe('/tmp/My Shot.png');
  });

  it('wants exactly one path where one is expected, and reads several otherwise', () => {
    expect(parsePathArgument('a.png b.png', '/work')).toBeUndefined();
    expect(parsePathArgument('', '/work')).toBeUndefined();
    expect(parsePathArguments("a.png '/tmp/b c.png'", '/work')).toEqual(['/work/a.png', '/tmp/b c.png']);
  });
});

describe('findAbsolutePathTokens', () => {
  it('finds dropped paths inside a sentence and remembers their exact text', () => {
    expect(findAbsolutePathTokens('看这张图 /tmp/My\\ Shot.png 哪里不对')).toEqual([
      { raw: '/tmp/My\\ Shot.png', path: '/tmp/My Shot.png' },
    ]);
    expect(findAbsolutePathTokens("对比 '/tmp/a b.png' 和 ~/c.png")).toEqual([
      { raw: "'/tmp/a b.png'", path: '/tmp/a b.png' },
      { raw: '~/c.png', path: path.join(homedir(), 'c.png') },
    ]);
  });

  it('ignores relative words, slash commands in prose and repeats', () => {
    expect(findAbsolutePathTokens('改 src/a.ts 里的 and/or 逻辑')).toEqual([]);
    expect(findAbsolutePathTokens('/tmp/a.png 和 /tmp/a.png')).toHaveLength(1);
  });
});
