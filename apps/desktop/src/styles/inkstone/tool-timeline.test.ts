import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, 'tool-timeline.css'), 'utf8');

describe('Inkstone tool-call row padding', () => {
  it('keeps proto .tr padding and puts kind icons on the ink rail', () => {
    expect(css).toMatch(
      /\.turn-work-details \.tool-call-card\.density-compact \.tool-call-summary \{[\s\S]*?padding: 0 var\(--row-pad\);/,
    );
    expect(css).toMatch(/\.tool-call-card \.tool-call-summary > \.node \{\s*display: none;/);
    expect(css).toMatch(
      /\.tool-call-card \.tool-call-kind-icon \{[\s\S]*?display: block !important;[\s\S]*?position: static;/,
    );
    expect(css).toMatch(
      /\.turn-work-details \.tool-call-card \.tool-call-action-verb \{[\s\S]*?font: 600 12\.5px \/ 1\.5 var\(--sans\);/,
    );
    expect(css).toMatch(
      /\.turn-work-details \.tool-call-card \.tool-call-file-pill \{[\s\S]*?font: 11\.5px var\(--mono\);[\s\S]*?background: var\(--code\);[\s\S]*?padding: 1px 5px;/,
    );
    expect(css).toMatch(/max-width: min\(240px, 48%\);/);
  });
});
