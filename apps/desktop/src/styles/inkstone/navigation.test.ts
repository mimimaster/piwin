import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, 'navigation.css'), 'utf8');
const proto = readFileSync(
  join(here, '../../../../../docs/design/inkstone/proto-03-navigation.html'),
  'utf8',
);

describe('Inkstone empty-stage landing rows', () => {
  it('uses proto .land-row hover fill so the pill is visible on the s2 stage', () => {
    expect(proto).toContain('.land-row:hover{background:var(--s3)}');
    expect(css).toMatch(
      /\.empty-stage-landing-row:hover[\s\S]{0,200}?background: var\(--s3\);/,
    );
    expect(css).not.toMatch(
      /\.empty-stage-landing-row:hover[\s\S]{0,200}?background: var\(--s2\);/,
    );
  });
});
