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

describe('stdin for -p', () => {
  it('takes - and --no-stdin out of the arguments', async () => {
    const { takeStdinMode } = await import('./print-mode.js');
    expect(takeStdinMode(['-p', 'hi', '-'])).toEqual({ argv: ['-p', 'hi'], mode: 'wait' });
    expect(takeStdinMode(['-p', 'hi', '--no-stdin'])).toEqual({ argv: ['-p', 'hi'], mode: 'skip' });
    expect(takeStdinMode(['-p', 'hi'])).toEqual({ argv: ['-p', 'hi'], mode: 'probe' });
  });

  it('gives up on a stdin that stays open and silent', async () => {
    const { PassThrough } = await import('node:stream');
    const { readPrintStdin } = await import('./print-mode.js');
    const stream = new PassThrough();
    const started = Date.now();
    expect(await readPrintStdin(stream, 'probe', 30)).toBeUndefined();
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('reads piped data to the end, even past the probe window once it started', async () => {
    const { PassThrough } = await import('node:stream');
    const { readPrintStdin } = await import('./print-mode.js');
    const stream = new PassThrough();
    const pending = readPrintStdin(stream, 'probe', 30);
    stream.write('diff ');
    setTimeout(() => stream.end('--git'), 80);
    expect(await pending).toBe('diff --git');
  });

  it('waits for a slow writer with -, and ignores stdin with --no-stdin', async () => {
    const { PassThrough } = await import('node:stream');
    const { readPrintStdin } = await import('./print-mode.js');
    const slow = new PassThrough();
    const pending = readPrintStdin(slow, 'wait', 10);
    setTimeout(() => slow.end('late'), 60);
    expect(await pending).toBe('late');
    expect(await readPrintStdin(new PassThrough(), 'skip')).toBeUndefined();
  });
});
