import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const composer = readFileSync(join(here, 'composer.css'), 'utf8');
const proto = readFileSync(
  join(here, '../../../../../docs/design/inkstone/shell-composer.css'),
  'utf8',
);

describe('Inkstone composer.css context capsules', () => {
  it('copies proto-00 .ref paint onto the live composer chips', () => {
    expect(proto).toMatch(/\.ref \{[\s\S]*?color: var\(--slab-t\);/);
    expect(composer).toContain('background: var(--slab-chip)');
    expect(composer).toContain('font: 11.5px var(--mono)');
    expect(composer).toContain('color: var(--slab-t)');
    expect(composer).toContain('height: 22px');
    expect(composer).toContain('border-radius: 3px');
    expect(composer).toContain('.composer-v2-context-chip');
    expect(composer).toContain('--slab-text: var(--t1)');
    expect(composer).not.toMatch(
      /\.slab[\s\S]{0,80}\.composer-v2-context-chip[\s\S]{0,120}iris-wash/,
    );
  });

  it('keeps the slab sheen track idle-invisible and lamp-lit when active', () => {
    expect(composer).toMatch(
      /\.slab::before \{[\s\S]*?background: transparent;/,
    );
    expect(composer).not.toMatch(
      /\.slab::before \{[\s\S]*?background: var\(--slab-line\);/,
    );
    expect(composer).toMatch(
      /\.slab\.is-streaming::before[\s\S]*?animation: sheen/,
    );
  });

  it('keeps focus-within on --sh3 without a Deck iris/zhu ring', () => {
    expect(composer).toMatch(
      /\.slab:is\(:focus-within, :hover:focus-within\) \{\s*box-shadow: var\(--sh3\);/,
    );
    expect(composer).not.toMatch(
      /\.slab:is\(:focus-within[\s\S]{0,80}0 0 0 1px var\(--(?:iris|zhu)\)/,
    );
  });

  it('pins toolbar icon buttons to proto-02 .sb-chip.ic, including Mantine --ai-size', () => {
    expect(composer).toMatch(
      /\.composer-v2-icon-btn \{[\s\S]*?width: 28px;[\s\S]*?height: 26px;[\s\S]*?--ai-size: 26px;/,
    );
  });
});
