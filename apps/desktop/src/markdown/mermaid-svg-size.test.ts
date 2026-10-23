import { describe, expect, it } from 'vitest';
import { withIntrinsicMermaidSvgSize } from './mermaid-svg-size.js';

describe('withIntrinsicMermaidSvgSize', () => {
  it('writes the viewBox back as the intrinsic size', () => {
    const svg =
      '<svg id="d" width="100%" xmlns="http://www.w3.org/2000/svg" style="max-width: 329.5px;" viewBox="0 0 329.5 782.25" role="graphics-document"><g><rect width="10" height="20"/></g></svg>';
    const sized = withIntrinsicMermaidSvgSize(svg);
    expect(sized.startsWith('<svg width="330" height="783" id="d"')).toBe(true);
    expect(sized).not.toContain('width="100%"');
    expect(sized).toContain('viewBox="0 0 329.5 782.25"');
    // Only the root tag is rewritten.
    expect(sized).toContain('<rect width="10" height="20"/>');
  });

  it('replaces an existing root height and accepts comma-separated viewBox values', () => {
    const sized = withIntrinsicMermaidSvgSize('<svg width="100%" height="40" viewBox="0,0,120,60"></svg>');
    expect(sized).toBe('<svg width="120" height="60" viewBox="0,0,120,60"></svg>');
  });

  it('leaves an SVG it cannot measure untouched', () => {
    for (const svg of [
      '<svg width="100%"></svg>',
      '<svg viewBox="0 0 0 10"></svg>',
      '<svg viewBox="0 0 a b"></svg>',
      '<div>not svg</div>',
    ]) {
      expect(withIntrinsicMermaidSvgSize(svg)).toBe(svg);
    }
  });
});
