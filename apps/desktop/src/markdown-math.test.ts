import { describe, expect, it } from 'vitest';
import {
  extractStandaloneDisplayMath,
  isMathFenceLanguage,
  isMermaidFenceLanguage,
  renderKatex,
  tokenizeInlineWithMath,
} from './markdown-math';

describe('markdown-math', () => {
  it('classifies math and mermaid fence languages', () => {
    expect(isMathFenceLanguage('math')).toBe(true);
    expect(isMathFenceLanguage('LaTeX')).toBe(true);
    expect(isMathFenceLanguage('katex')).toBe(true);
    expect(isMathFenceLanguage('js')).toBe(false);
    expect(isMermaidFenceLanguage('mermaid')).toBe(true);
    expect(isMermaidFenceLanguage('Mermaid dark')).toBe(true);
    expect(isMermaidFenceLanguage('js')).toBe(false);
  });

  it('renders display and inline KaTeX', () => {
    const display = renderKatex('E = mc^2', true);
    expect(display.ok).toBe(true);
    if (display.ok) {
      expect(display.html).toContain('katex');
      expect(display.html).toContain('E');
    }

    const inline = renderKatex('a+b', false);
    expect(inline.ok).toBe(true);
    if (inline.ok) {
      expect(inline.html).toContain('katex');
    }
  });

  it('soft-fails invalid TeX without throwing', () => {
    const result = renderKatex('\\unknowncommand{zzz}', false);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.length).toBeGreaterThan(0);
      expect(result.source).toContain('unknowncommand');
    }
  });

  it('tokenizes $ and $$ and leaves code spans alone', () => {
    const segments = tokenizeInlineWithMath('value `$not$` and $x^2$ plus $$y$$');
    expect(segments.some((segment) => segment.kind === 'code' && segment.value === '$not$')).toBe(
      true,
    );
    expect(
      segments.some(
        (segment) => segment.kind === 'math' && !segment.display && segment.value === 'x^2',
      ),
    ).toBe(true);
    expect(
      segments.some(
        (segment) => segment.kind === 'math' && segment.display && segment.value === 'y',
      ),
    ).toBe(true);
  });

  it('extracts standalone display math paragraphs', () => {
    expect(extractStandaloneDisplayMath('$$E=mc^2$$')).toBe('E=mc^2');
    expect(extractStandaloneDisplayMath('\\[a+b\\]')).toBe('a+b');
    expect(extractStandaloneDisplayMath('not only math $$x$$')).toBeNull();
  });
});
