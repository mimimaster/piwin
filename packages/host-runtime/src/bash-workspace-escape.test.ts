import { describe, expect, it } from 'vitest';
import { homedir } from 'node:os';
import { bashCommandEscapesProjectRoot, extractPathLikeTokens } from './bash-workspace-escape.js';

const PROJECT = '/home/u/project';

describe('extractPathLikeTokens', () => {
  it('picks absolute, home, and redirect targets', () => {
    expect(extractPathLikeTokens('cd /tmp')).toEqual(['/tmp']);
    expect(extractPathLikeTokens('cat ~/notes.txt')).toEqual(['~/notes.txt']);
    expect(extractPathLikeTokens('echo hi > /tmp/out')).toEqual(['/tmp/out']);
    expect(extractPathLikeTokens('echo hi>/tmp/out')).toEqual(['/tmp/out']);
    expect(extractPathLikeTokens('cmd --out=/tmp/x')).toEqual(['/tmp/x']);
  });

  it('keeps quoted paths and ignores http(s) URLs', () => {
    expect(extractPathLikeTokens("cat '/tmp/a b'")).toEqual(['/tmp/a b']);
    expect(extractPathLikeTokens('curl https://example.com/tmp')).toEqual([]);
  });
});

describe('bashCommandEscapesProjectRoot', () => {
  it('is false without a project root or for in-project paths', () => {
    expect(bashCommandEscapesProjectRoot('cd /tmp', '')).toBe(false);
    expect(bashCommandEscapesProjectRoot('cat src/index.ts', PROJECT)).toBe(false);
    expect(bashCommandEscapesProjectRoot(`cat ${PROJECT}/README.md`, PROJECT)).toBe(false);
    expect(bashCommandEscapesProjectRoot('pnpm test', PROJECT)).toBe(false);
  });

  it('detects leaving the workspace', () => {
    expect(bashCommandEscapesProjectRoot('cd /tmp', PROJECT)).toBe(true);
    expect(bashCommandEscapesProjectRoot('cat ~/notes.txt', PROJECT)).toBe(true);
    expect(bashCommandEscapesProjectRoot(`cat ${homedir()}/notes.txt`, PROJECT)).toBe(true);
    expect(bashCommandEscapesProjectRoot('ls ..', PROJECT)).toBe(true);
    expect(bashCommandEscapesProjectRoot('cd /tmp && pnpm test', PROJECT)).toBe(true);
  });

  it('does not flag redirects to /dev/null', () => {
    expect(bashCommandEscapesProjectRoot('echo hi > /dev/null', PROJECT)).toBe(false);
  });
});
