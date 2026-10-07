import { describe, expect, it } from 'vitest';
import { splitEnhancedMarkdownSegments } from './enhanced-markdown-segments.js';
import { parseEnhancedDiffHeader, parseEnhancedDiffHeaderLines } from './enhanced-markdown-diff-header.js';

describe('splitEnhancedMarkdownSegments', () => {
  it('keeps a document without disclosures as one Markdown segment', () => {
    const text = '# Title\n\nA paragraph\nwrapped over two lines.\n';
    expect(splitEnhancedMarkdownSegments(text)).toEqual([
      { type: 'markdown', text, startLine: 0 },
    ]);
  });

  it('lifts a top-level disclosure out between its neighbours', () => {
    const segments = splitEnhancedMarkdownSegments(
      ['Intro', '', '<details>', '<summary>Evidence</summary>', '', 'Body **text**', '</details>', '', 'Outro'].join('\n'),
    );
    expect(segments).toEqual([
      { type: 'markdown', text: 'Intro\n', startLine: 0 },
      { type: 'details', summary: 'Evidence', content: 'Body **text**', startLine: 2 },
      { type: 'markdown', text: '\nOutro', startLine: 7 },
    ]);
  });

  it('treats a mention of the tag in prose or code as ordinary Markdown', () => {
    const text = [
      '- `_em_` copies as `*em*`; `<details>` copies its inner blocks.',
      '',
      '```html',
      '<details>',
      '<summary>not a block</summary>',
      '</details>',
      '```',
    ].join('\n');
    expect(splitEnhancedMarkdownSegments(text)).toEqual([{ type: 'markdown', text, startLine: 0 }]);
  });

  it('reads a one-line summary and a nested disclosure', () => {
    const segments = splitEnhancedMarkdownSegments(
      ['<details open><summary>Outer</summary>', 'a', '<details>', '<summary>Inner</summary>', 'b', '</details>', 'c', '</details>'].join('\n'),
    );
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ type: 'details', summary: 'Outer' });
    expect(segments[0]?.type === 'details' ? segments[0].content : '').toContain('<summary>Inner</summary>');
  });

  it('does not close a disclosure on a tag inside its own code fence', () => {
    const segments = splitEnhancedMarkdownSegments(
      ['<details>', '<summary>S</summary>', '```', '</details>', '```', 'tail', '</details>', 'after'].join('\n'),
    );
    expect(segments.map((segment) => segment.type)).toEqual(['details', 'markdown']);
    expect(segments[0]?.type === 'details' ? segments[0].content : '').toContain('tail');
  });

  it('runs an unclosed disclosure to the end and falls back to a default summary', () => {
    expect(splitEnhancedMarkdownSegments('<details>\nbody')).toEqual([
      { type: 'details', summary: 'Details', content: 'body', startLine: 0 },
    ]);
  });
});

describe('parseEnhancedDiffHeader', () => {
  it('reads action, kind badge and path', () => {
    expect(parseEnhancedDiffHeader('[MODIFY] TS run-activity-types.ts')).toEqual({
      action: 'MODIFY',
      ext: 'TS',
      path: 'run-activity-types.ts',
    });
    expect(parseEnhancedDiffHeader('[new] src/a/b.tsx')).toEqual({
      action: 'NEW',
      ext: 'TSX',
      path: 'src/a/b.tsx',
    });
    expect(parseEnhancedDiffHeader('[DELETE] [old.css](file:///repo/old.css)')).toEqual({
      action: 'DELETE',
      ext: 'CSS',
      path: 'old.css',
    });
  });

  it('rejects ordinary text and an action with nothing after it', () => {
    expect(parseEnhancedDiffHeader('Modify the parser')).toBeNull();
    expect(parseEnhancedDiffHeader('[MODIFY]')).toBeNull();
    expect(parseEnhancedDiffHeader('[TODO] src/a.ts')).toBeNull();
  });

  it('accepts a paragraph only when every line is a change line', () => {
    expect(parseEnhancedDiffHeaderLines('[MODIFY] a.ts\n[NEW] b.ts')).toHaveLength(2);
    expect(parseEnhancedDiffHeaderLines('[MODIFY] a.ts\nand some prose')).toBeNull();
    expect(parseEnhancedDiffHeaderLines('  \n')).toBeNull();
  });
});
