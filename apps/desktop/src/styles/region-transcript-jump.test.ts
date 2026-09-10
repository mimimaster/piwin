import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, 'region-transcript.css'), 'utf8');

describe('jump-to-latest chrome', () => {
  it('does not center or enter with transform, which snaps the control on mount', () => {
    const jumpRule = css.match(/\.jump-to-latest-btn \{[^}]+\}/)?.[0];
    expect(jumpRule).toBeDefined();
    expect(jumpRule).not.toContain('transform:');
    expect(jumpRule).not.toContain('animation:');
    expect(jumpRule).toContain('margin: 0 0 0 calc(var(--h-md) / -2)');
  });
});

