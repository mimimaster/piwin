import { describe, expect, it } from 'vitest';
import { findTrailingRepetition } from './text-repetition.js';

// The sentence session-muny5im0-8df7puba streamed 748 times in one reply.
const INCIDENT_SENTENCE =
  '`BUILTIN_SCHEMES` 和 `LEGACY_ULTRA_CODE_SCOUT_ROLE` 原来是模块私有的，barrel 不该把它们变成公开导出。改成各文件内部用，barrel 只转发原来就公开的名字。\n';

function prose(sentences: number): string {
  return Array.from(
    { length: sentences },
    (_, index) => `Step ${index}: inspect module-${index * 7} and record finding ${index ** 2}.`,
  ).join(' ');
}

describe('findTrailingRepetition', () => {
  it('finds the real 748-repeat incident and counts every repeat', () => {
    const text = INCIDENT_SENTENCE.repeat(748);
    const found = findTrailingRepetition(text);
    expect(found?.repeats).toBe(748);
    expect(found?.chars).toBe(text.length);
    expect(found?.unit).toBe(INCIDENT_SENTENCE);
  });

  it('reports the loop after normal prose, not the prose', () => {
    const intro = `${prose(30)}\n\n`;
    const text = intro + INCIDENT_SENTENCE.repeat(40);
    const found = findTrailingRepetition(text);
    expect(found?.repeats).toBe(40);
    // The intro's last character may coincide with the unit's, extending the run.
    expect(found?.chars).toBeGreaterThanOrEqual(INCIDENT_SENTENCE.length * 40);
    expect(found?.chars).toBeLessThan(INCIDENT_SENTENCE.length * 41);
    expect(found?.unit.trim()).toBe(INCIDENT_SENTENCE.trim());
  });

  it('needs the minimum number of back-to-back repeats', () => {
    expect(findTrailingRepetition(INCIDENT_SENTENCE.repeat(5))).toBeUndefined();
    expect(findTrailingRepetition(INCIDENT_SENTENCE.repeat(6))?.repeats).toBe(6);
  });

  it('measures a loop longer than the scan window', () => {
    const text = `${prose(10)}\n${INCIDENT_SENTENCE.repeat(2_000)}`;
    expect(INCIDENT_SENTENCE.length * 2_000).toBeGreaterThan(200_000);
    expect(findTrailingRepetition(text)?.repeats).toBe(2_000);
  });

  it('does not report a loop the reply has already left behind', () => {
    const text = `${INCIDENT_SENTENCE.repeat(50)}${prose(20)}`;
    expect(findTrailingRepetition(text)).toBeUndefined();
  });

  it('ignores short-period output however long it is', () => {
    expect(findTrailingRepetition('='.repeat(2_000))).toBeUndefined();
    expect(findTrailingRepetition('ab'.repeat(2_000))).toBeUndefined();
    expect(findTrailingRepetition('| --- | --- | --- |\n'.repeat(40))).toBeUndefined();
    expect(findTrailingRepetition('.'.repeat(30).repeat(30))).toBeUndefined();
  });

  it('stays silent on ordinary long output', () => {
    expect(findTrailingRepetition(prose(400))).toBeUndefined();
    const code = Array.from(
      { length: 300 },
      (_, index) => `export const value${index} = compute(${index}, 'label-${index}');`,
    ).join('\n');
    expect(findTrailingRepetition(code)).toBeUndefined();
    expect(findTrailingRepetition('short')).toBeUndefined();
  });

  it('scans a large non-repeating reply quickly', () => {
    const text = prose(20_000);
    expect(text.length).toBeGreaterThan(1_000_000);
    const started = performance.now();
    expect(findTrailingRepetition(text)).toBeUndefined();
    expect(performance.now() - started).toBeLessThan(500);
  });
});
