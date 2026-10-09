import { describe, expect, it } from 'vitest';
import { isPrintFlag, printModeArgv } from './print-mode.js';

describe('printModeArgv', () => {
  it('turns -p into a chat with the same words and flags', () => {
    expect(printModeArgv(['-p', '解释', '一下', '--mock'], undefined)).toEqual(['chat', '解释', '一下', '--mock']);
  });

  it('appends piped text to the prompt as one message', () => {
    expect(printModeArgv(['-p', 'review this', '--output-format', 'json'], 'diff --git a b\n')).toEqual([
      'chat',
      '--output-format',
      'json',
      'review this\n\ndiff --git a b',
    ]);
  });

  it('uses the piped text alone when no prompt was given', () => {
    expect(printModeArgv(['-p', '--mock'], 'just stdin')).toEqual(['chat', '--mock', 'just stdin']);
  });

  it('ignores whitespace-only input on stdin', () => {
    expect(printModeArgv(['-p', 'hi'], '  \n')).toEqual(['chat', 'hi']);
  });
});

describe('isPrintFlag', () => {
  it('accepts -p and --print only', () => {
    expect([isPrintFlag('-p'), isPrintFlag('--print'), isPrintFlag('chat'), isPrintFlag(undefined)]).toEqual([true, true, false, false]);
  });
});
