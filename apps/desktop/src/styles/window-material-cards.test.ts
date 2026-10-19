import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const read = (name: string): string => readFileSync(join(here, name), 'utf8');
const cards = read('window-material-cards.css');
const regions = read('window-material.css');
const pages = read('window-material-pages.css');

describe('window-material card ramp (ink)', () => {
  it('captures the solid ramp on the root before remapping it', () => {
    expect(cards).toMatch(/html\[data-window-material\] \{[\s\S]*?--wm-solid-s2: var\(--s2, var\(--surface-2\)\);/);
    expect(cards).toMatch(
      /\[data-theme-mode='dark'\]:has\(\.app-shell:not\(\[data-layout='phone'\]\)\)\s+:is\(\.app-shell, \.settings-overlay-host, \.vault-stage\) \{[\s\S]*?--s3: color-mix\(in srgb, var\(--wm-solid-s3\) 56%, transparent\);[\s\S]*?--slab: color-mix[\s\S]*?--surface-3: var\(--s3\);/,
    );
  });

  it('keeps region fills on the captured solid ramp so the stage is not thinned twice', () => {
    for (const css of [regions, pages]) {
      expect(css).not.toMatch(/var\(--(void|s1|s2)\) var\(--window-material-/);
      expect(css).toMatch(/var\(--wm-solid-(void|s1|s2)\) var\(--window-material-/);
    }
  });

  it('keeps sticky heads dense over the rows scrolling under them', () => {
    expect(cards).toMatch(/\.usage-calls-scroll thead th[\s\S]*?background-color: color-mix\(in srgb, var\(--wm-solid-s2\) 94%, transparent\);/);
  });
});
