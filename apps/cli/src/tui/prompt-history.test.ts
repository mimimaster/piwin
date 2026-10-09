import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PromptHistory, promptHistoryFile } from './prompt-history.js';

const sandboxes: string[] = [];
function sandbox(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'piwin-history-'));
  sandboxes.push(directory);
  return directory;
}
afterEach(() => {
  for (const directory of sandboxes.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('PromptHistory', () => {
  it('keeps prompts across runs, oldest first', () => {
    const file = path.join(sandbox(), 'h', 'p.jsonl');
    const first = new PromptHistory(file);
    first.add('第一条');
    first.add('line one\nline two');
    expect(new PromptHistory(file).all()).toEqual(['第一条', 'line one\nline two']);
  });

  it('skips blanks and an immediate repeat', () => {
    const history = new PromptHistory(undefined);
    history.add('  ');
    history.add('a');
    history.add('a');
    history.add('b');
    history.add('a');
    expect(history.all()).toEqual(['a', 'b', 'a']);
  });

  it('does not keep a pasted wall of text', () => {
    const history = new PromptHistory(undefined);
    history.add('x'.repeat(9_000));
    expect(history.all()).toEqual([]);
  });

  it('survives a torn last line and a missing file', () => {
    const directory = sandbox();
    const file = path.join(directory, 'p.jsonl');
    writeFileSync(file, `${JSON.stringify('ok')}\n{"broken`);
    expect(new PromptHistory(file).all()).toEqual(['ok']);
    expect(new PromptHistory(path.join(directory, 'absent.jsonl')).all()).toEqual([]);
  });

  it('trims the file once it has grown to twice the limit', () => {
    const file = path.join(sandbox(), 'p.jsonl');
    const history = new PromptHistory(file);
    for (let index = 0; index < 1_001; index += 1) history.add(`prompt ${index}`);
    expect(history.all()).toHaveLength(500);
    expect(history.all()[0]).toBe('prompt 501');
    expect(readFileSync(file, 'utf8').trim().split('\n')).toHaveLength(500);
  });

  it('finds entries containing every word, newest first', () => {
    const history = new PromptHistory(undefined);
    ['fix the login bug', 'write docs', 'login page styling', 'Login Bug again'].forEach((text) => history.add(text));
    expect(history.search('login bug')).toEqual(['Login Bug again', 'fix the login bug']);
    expect(history.search('')).toHaveLength(4);
    expect(history.search('zzz')).toEqual([]);
  });
});

describe('promptHistoryFile', () => {
  it('keeps one file per project and cannot be steered out of the directory', () => {
    expect(promptHistoryFile('/root', 'proj-1')).toBe('/root/tui-history/proj-1.jsonl');
    expect(promptHistoryFile('/root', undefined)).toBe('/root/tui-history/general.jsonl');
    expect(promptHistoryFile('/root', '../../etc')).toBe('/root/tui-history/.._.._etc.jsonl');
  });
});
