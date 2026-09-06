import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, 'tool-timeline.css'), 'utf8');

describe('Inkstone tool-call row padding', () => {
  it('sits the verb on the row edge so the node-to-label gap is not a blank column', () => {
    expect(css).toMatch(
      /\.turn-work-details \.tool-call-card\.density-compact \.tool-call-summary \{[\s\S]*?padding: 0 var\(--row-pad\) 0 0;/,
    );
    expect(css).toMatch(/\.tool-call-card \.tool-call-kind-icon \{ display: none !important; \}/);
  });
});
