import { describe, expect, it } from 'vitest';
import { escapeRawHtmlInMarkdown } from './markdown-html-escape.js';

describe('escapeRawHtmlInMarkdown', () => {
  it('escapes tag-like brackets in prose and leaves comparisons alone', () => {
    expect(escapeRawHtmlInMarkdown('Use the <div> element and </div> to wrap.')).toBe(
      'Use the &lt;div> element and &lt;/div> to wrap.',
    );
    expect(escapeRawHtmlInMarkdown('keep a < b and 3 < 4')).toBe('keep a < b and 3 < 4');
  });

  it('does not escape HTML inside fenced or inline code', () => {
    const fenced = ['Before', '```html', '<div>keep</div>', '```', 'After <span>x</span>'].join(
      '\n',
    );
    expect(escapeRawHtmlInMarkdown(fenced)).toBe(
      ['Before', '```html', '<div>keep</div>', '```', 'After &lt;span>x&lt;/span>'].join('\n'),
    );
    expect(escapeRawHtmlInMarkdown('See `<div>` and `Array<T>`')).toBe(
      'See `<div>` and `Array<T>`',
    );
  });
});
