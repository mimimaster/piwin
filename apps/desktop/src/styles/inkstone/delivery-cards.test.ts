import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, 'delivery-cards.css'), 'utf8');

describe('Inkstone streaming caret', () => {
  it('attaches the streaming caret to the anchored text, falling back to the last block', () => {
    expect(css).toContain('.markdown.has-stream-caret [data-stream-caret]::after');
    // Fallback only while no anchor exists, or two carets would paint.
    expect(css).toMatch(
      /\.markdown\.has-stream-caret:not\(:has\(\[data-stream-caret\]\)\)\s*>\s*:last-child::after/,
    );
    expect(css).not.toMatch(/\.markdown\.has-stream-caret\s*>\s*:last-child::after/);
    expect(css).toMatch(/width:\s*2px;/);
    expect(css).toMatch(/background:\s*var\(--lamp\);/);
    expect(css).toMatch(/animation:\s*breath 1s ease-in-out infinite;/);
  });

  it('explicitly disables ::after on the outer .has-stream-caret container to avoid a second caret line', () => {
    expect(css).toMatch(/\.has-stream-caret::after[\s\S]*?content:\s*none;/);
  });
});
