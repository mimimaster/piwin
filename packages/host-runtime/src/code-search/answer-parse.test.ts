import { describe, expect, it } from 'vitest';
import { join, resolve } from 'node:path';
import { extractAnswerXml, parseCodeSearchAnswer } from './answer-parse.js';

const ROOT = resolve('/tmp/piwin-answer-root');

function parse(answerXml: string, maxResults = 10) {
  return parseCodeSearchAnswer({ root: ROOT, answerXml, maxResults });
}

describe('parseCodeSearchAnswer', () => {
  it('parses the observed Devin answer shape', () => {
    const result = parse(`<ANSWER>
  <file path="/codebase/info_theory/formulas/entropy.py">
    <range>10-60</range>
    <range>150-210</range>
  </file>
  <file path="/codebase/data_structures/bits.py">
    <range>1-40</range>
  </file>
</ANSWER>`);
    expect(result.malformed).toBe(false);
    expect(result.rejectedPaths).toEqual([]);
    expect(result.files).toEqual([
      {
        path: 'info_theory/formulas/entropy.py',
        absolutePath: join(ROOT, 'info_theory/formulas/entropy.py'),
        ranges: [
          { start: 10, end: 60 },
          { start: 150, end: 210 },
        ],
      },
      {
        path: 'data_structures/bits.py',
        absolutePath: join(ROOT, 'data_structures/bits.py'),
        ranges: [{ start: 1, end: 40 }],
      },
    ]);
  });

  it('treats an empty ANSWER as a valid "nothing relevant" answer', () => {
    const result = parse('<ANSWER></ANSWER>');
    expect(result).toEqual({ files: [], rejectedPaths: [], malformed: false });
  });

  it('flags a response with no ANSWER element as malformed', () => {
    const result = parse('I could not find anything useful.');
    expect(result.malformed).toBe(true);
    expect(result.files).toEqual([]);
  });

  it('accepts bare repo-relative paths when the model drops the prefix', () => {
    const result = parse('<ANSWER><file path="src/app.ts"><range>1-5</range></file></ANSWER>');
    expect(result.files.map((file) => file.path)).toEqual(['src/app.ts']);
  });

  it('accepts single-quoted paths and whitespace in ranges', () => {
    const result = parse(`<ANSWER><file path='src/app.ts'><range> 3 - 9 </range></file></ANSWER>`);
    expect(result.files[0]?.ranges).toEqual([{ start: 3, end: 9 }]);
  });

  it('refuses escaping and foreign paths instead of silently dropping them', () => {
    const result = parse(`<ANSWER>
  <file path="/codebase/../../etc/passwd"><range>1-5</range></file>
  <file path="/etc/hosts"><range>1-5</range></file>
  <file path="../../secrets.ts"><range>1-5</range></file>
  <file path="/codebase/src/ok.ts"><range>1-5</range></file>
</ANSWER>`);
    expect(result.files.map((file) => file.path)).toEqual(['src/ok.ts']);
    expect(result.rejectedPaths).toEqual([
      '/codebase/../../etc/passwd',
      '/etc/hosts',
      '../../secrets.ts',
    ]);
  });

  it('merges duplicate file elements and dedupes ranges', () => {
    const result = parse(`<ANSWER>
  <file path="/codebase/src/app.ts"><range>1-5</range><range>1-5</range></file>
  <file path="/codebase/src/app.ts"><range>20-30</range></file>
</ANSWER>`);
    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.ranges).toEqual([
      { start: 1, end: 5 },
      { start: 20, end: 30 },
    ]);
  });

  it('normalizes reversed and non-positive ranges', () => {
    const result = parse(`<ANSWER>
  <file path="/codebase/src/app.ts"><range>60-10</range><range>0-4</range></file>
</ANSWER>`);
    expect(result.files[0]?.ranges).toEqual([
      { start: 10, end: 60 },
      { start: 1, end: 4 },
    ]);
  });

  it('drops files that carry no usable range', () => {
    const result = parse(`<ANSWER>
  <file path="/codebase/src/empty.ts"></file>
  <file path="/codebase/src/ok.ts"><range>1-2</range></file>
</ANSWER>`);
    expect(result.files.map((file) => file.path)).toEqual(['src/ok.ts']);
  });

  it('caps the returned files at maxResults in model order', () => {
    const result = parse(
      `<ANSWER>${Array.from(
        { length: 5 },
        (_, index) => `<file path="/codebase/src/f${index}.ts"><range>1-2</range></file>`,
      ).join('')}</ANSWER>`,
      2,
    );
    expect(result.files.map((file) => file.path)).toEqual(['src/f0.ts', 'src/f1.ts']);
  });

  it('ignores blank path attributes', () => {
    const result = parse('<ANSWER><file path="  "><range>1-2</range></file></ANSWER>');
    expect(result.files).toEqual([]);
    expect(result.rejectedPaths).toEqual([]);
  });

  it('parses an unclosed ANSWER that custom models often emit', () => {
    const result = parse(`<ANSWER>
  <file path="/codebase/src/app.ts">
    <range>1-5</range>
  </file>
`);
    expect(result.malformed).toBe(false);
    expect(result.files.map((file) => file.path)).toEqual(['src/app.ts']);
  });

  it('prefers the answer tool argument over response text', () => {
    expect(
      extractAnswerXml({
        toolArguments: { answer: '<ANSWER><file path="src/a.ts"><range>1-1</range></file></ANSWER>' },
        text: 'ignore me',
      }),
    ).toContain('src/a.ts');
  });

  it('falls back to response text when the answer tool is missing', () => {
    expect(
      extractAnswerXml({
        text: '<ANSWER><file path="/codebase/src/app.ts"><range>1-2</range></file></ANSWER>',
      }),
    ).toContain('/codebase/src/app.ts');
  });

  it('parses bare file elements when the ANSWER wrapper is missing', () => {
    const result = parse('<file path="/codebase/src/app.ts"><range>1-5</range></file>');
    expect(result.malformed).toBe(false);
    expect(result.files.map((file) => file.path)).toEqual(['src/app.ts']);
  });
});
