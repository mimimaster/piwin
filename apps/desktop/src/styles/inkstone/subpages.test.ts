import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const subpages = readFileSync(join(here, 'subpages.css'), 'utf8');

describe('Inkstone knowledge titleband contrast', () => {
  it('paints vault-bar title and back control with face text tokens', () => {
    expect(subpages).toMatch(
      /\.vault-stage \.vault-bar-context \{[\s\S]*?color:\s*var\(--t1, var\(--text-1\)\)/,
    );
    expect(subpages).toMatch(
      /\.vault-stage \.vault-back \{[\s\S]*?color:\s*var\(--t2, var\(--text-2\)\)/,
    );
  });
});

describe('Inkstone Live bar (proto-06)', () => {
  it('pins mute/hang ActionIcons to the 26px proto chip, not the 44px hit target', () => {
    expect(subpages).toMatch(/\.live-icon-btn \{[\s\S]*?min-width:\s*26px\s*!important/);
    expect(subpages).toContain('--ai-size: 26px');
    expect(subpages).toContain('--ai-icon-size: 12px');
  });

  it('does not let region-live scale the hang/mute chips on hover', () => {
    expect(subpages).toMatch(/\.live-icon-btn:hover[\s\S]*?transform:\s*none\s*!important/);
  });
});
