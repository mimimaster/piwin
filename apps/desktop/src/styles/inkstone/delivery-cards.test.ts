import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, 'delivery-cards.css'), 'utf8');

describe('Inkstone streaming caret', () => {
  it('attaches the streaming caret to the last-child inline instead of the outer container', () => {
    expect(css).toContain('.markdown.has-stream-caret > :last-child::after');
    expect(css).toMatch(/width:\s*2px;/);
    expect(css).toMatch(/background:\s*var\(--lamp\);/);
    expect(css).toMatch(/animation:\s*breath 1s ease-in-out infinite;/);
  });

  it('explicitly disables ::after on the outer .has-stream-caret container to avoid a second caret line', () => {
    expect(css).toMatch(/\.has-stream-caret::after[\s\S]*?content:\s*none;/);
  });
});
