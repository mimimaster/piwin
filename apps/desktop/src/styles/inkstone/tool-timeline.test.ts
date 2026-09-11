import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, 'tool-timeline.css'), 'utf8');

describe('Inkstone tool-call timeline spine and row layout', () => {
  it('restores the vertical spine and 22px gutter on .thread and .turn-tool-sequence', () => {
    expect(css).toMatch(
      /\.turn-tool-sequence \{[\s\S]*?padding-left: 22px;/,
    );
    expect(css).toMatch(
      /\.thread::before,[\s\S]*?\.turn-tool-sequence::before \{[\s\S]*?left: 8px;[\s\S]*?width: 1\.5px;[\s\S]*?background: var\(--l3\);/,
    );
  });

  it('keeps proto .tr padding and positions status nodes on the ink spine', () => {
    expect(css).toMatch(
      /\.turn-work-details \.tool-call-card\.density-compact \.tool-call-summary \{[\s\S]*?padding: 0 var\(--row-pad\) 0 4px;/,
    );
    expect(css).toMatch(
      /\.tool-call-card \.tool-call-summary > \.node \{[\s\S]*?display: block !important;[\s\S]*?position: absolute;[\s\S]*?left: -18px;[\s\S]*?width: 9px;[\s\S]*?height: 9px;/,
    );
    expect(css).toMatch(
      /\.explore-flow-capsule > \.node,[\s\S]*?\.tool-batch-capsule > \.node \{[\s\S]*?display: block !important;[\s\S]*?left: -18px;[\s\S]*?top: 14px;/,
    );
    expect(css).toMatch(
      /\.tool-call-card \.tool-call-kind-icon \{[\s\S]*?display: block !important;[\s\S]*?position: static;[\s\S]*?color: var\(--t3\);/,
    );
    expect(css).toMatch(
      /\.turn-work-details \.tool-call-card \.tool-call-action-verb \{[\s\S]*?font: 600 12\.5px \/ 1\.5 var\(--sans\);/,
    );
    expect(css).toMatch(
      /\.turn-work-details \.tool-call-card \.tool-call-file-pill \{[\s\S]*?font: 11\.5px var\(--mono\);[\s\S]*?background: var\(--code\);[\s\S]*?padding: 1px 5px;/,
    );
    expect(css).toMatch(/max-width: min\(240px, 48%\);/);
  });

  it('binds mineral status colors to nodes on the spine', () => {
    expect(css).toMatch(/\.node\.done,[\s\S]*?background: var\(--pine\);/);
    expect(css).toMatch(/\.node\.fail,[\s\S]*?background: var\(--crimson\);/);
    expect(css).toMatch(/\.node\.wait,[\s\S]*?background: var\(--zhu\);/);
    expect(css).toMatch(/\.node\.run,[\s\S]*?background: var\(--lamp\);[\s\S]*?animation: breath/);
  });

  it('defines proto-01 inline diff card (.dc) layout and colors', () => {
    expect(css).toMatch(
      /\.tool-call-card \.tool-call-body:has\(\.diff-card\)[^{]*\{[\s\S]*?background: transparent;[\s\S]*?padding: 0;/,
    );
    expect(css).toMatch(
      /\.dc,[\s\S]*?\.diff-card \{[\s\S]*?border-radius: 8px;[\s\S]*?background: var\(--s3\);[\s\S]*?box-shadow: var\(--sh1\);/,
    );
    expect(css).toMatch(
      /\.dc-h,[\s\S]*?\.diff-head \{[\s\S]*?height: 32px;[\s\S]*?border-bottom: 1px solid var\(--l1\);/,
    );
    expect(css).toMatch(
      /\.dc-b,[\s\S]*?\.diff-card \.diff-body \{[\s\S]*?font: 11\.5px\/1\.75 var\(--mono\);[\s\S]*?background: var\(--code\);/,
    );
    expect(css).toMatch(
      /\.dc-f,[\s\S]*?\.diff-card \.diff-footer \{[\s\S]*?height: 36px;[\s\S]*?border-top: 1px solid var\(--l1\);/,
    );
  });

  it('bounds thinking draft box in squeezed stage and expands only at >=960px', () => {
    expect(css).toMatch(
      /\.turn-work-details-body,\s*\n[^{]*\.conversation-thinking-body\s*\{[\s\S]*?margin-left:\s*0;[\s\S]*?width:\s*100%;/,
    );
    expect(css).toMatch(
      /@container transcript-stage \(min-width: 960px\)[\s\S]*?\.turn-work-details-body,[\s\S]*?\.conversation-thinking-body\s*\{[\s\S]*?margin-left:\s*calc\(-1 \* var\(--row-pad\)\);[\s\S]*?width:\s*calc\(100% \+ var\(--row-pad\) \* 2\);/,
    );
  });
});
