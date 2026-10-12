import { visibleWidth } from '@earendil-works/pi-tui';
import { describe, expect, it } from 'vitest';
import { TranscriptMarkdown, wrapCodeLine } from './transcript-markdown.js';

const ANSI = /\x1b\[[0-9;]*m/g;
const plain = (lines: string[]): string[] => lines.map((line) => line.replace(ANSI, ''));
const FENCE = '```';

describe('TranscriptMarkdown', () => {
  const text = `说明\n\n${FENCE}ts\nfunction demo() {\n    const veryLongVariableName = someFunctionCall(argumentNumberOne, argumentNumberTwo);\n}\n${FENCE}\n\n结束`;

  it('drops the fence lines and labels the block with its language', () => {
    const lines = plain(new TranscriptMarkdown(text).render(50));
    expect(lines.some((line) => line.includes(FENCE))).toBe(false);
    expect(lines).toContain('   ts');
    expect(lines).toContain('   function demo() {');
  });

  it('wraps long code lines under their own indentation', () => {
    const lines = plain(new TranscriptMarkdown(text).render(50));
    const start = lines.findIndex((line) => line.includes('const veryLongVariableName'));
    expect(lines[start]).toBe('       const veryLongVariableName =');
    expect(lines[start + 1]).toMatch(/^ {9}someFunctionCall/);
    for (const line of new TranscriptMarkdown(text).render(50)) expect(visibleWidth(line)).toBeLessThanOrEqual(50);
  });

  it('never pads lines with trailing spaces', () => {
    for (const line of new TranscriptMarkdown(text).render(80)) expect(line).not.toMatch(/ $/);
  });

  it('drops an unlabelled fence entirely', () => {
    const lines = plain(new TranscriptMarkdown(`${FENCE}\nplain code\n${FENCE}`).render(40));
    expect(lines).toEqual(['   plain code']);
  });
});

describe('wrapCodeLine', () => {
  it('leaves short lines alone and keeps a usable width when deeply indented', () => {
    expect(wrapCodeLine('  x = 1', 20)).toEqual(['  x = 1']);
    const wrapped = wrapCodeLine(`${' '.repeat(14)}alpha beta gamma delta`, 20);
    expect(wrapped.length).toBeGreaterThan(1);
    for (const line of wrapped) expect(visibleWidth(line)).toBeLessThanOrEqual(20);
  });
});
