import { describe, expect, it } from 'vitest';
import { extractOutlineFromHtml, extractOutlineFromMarkdown } from './readable-extract.js';

describe('extractOutline', () => {
  it('reads html headings in document order', () => {
    const html = '<h1>Intro</h1><p>x</p><h2>API <em>Ref</em></h2><h3></h3>';
    expect(extractOutlineFromHtml(html)).toEqual(['Intro', 'API Ref']);
  });

  it('reads markdown headings', () => {
    expect(extractOutlineFromMarkdown('# Title\n\n## Setup\nbody\n### Notes')).toEqual([
      'Title',
      'Setup',
      'Notes',
    ]);
  });
});
