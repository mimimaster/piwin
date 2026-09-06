import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const live = readFileSync(join(here, 'region-live.css'), 'utf8');

describe('Live bar capsule (proto-06)', () => {
  it('keeps mute/hang chips at 26px so they fit the 40px pill', () => {
    expect(live).toMatch(/\.live-bar \{[\s\S]*?height:\s*40px\s*!important/);
    expect(live).toMatch(/\.live-icon-btn \{[\s\S]*?min-width:\s*26px\s*!important/);
    expect(live).not.toMatch(/min-width:\s*44px/);
  });

  it('paints proto live-btn fill instead of an empty 44px ActionIcon', () => {
    expect(live).toContain('background: rgba(255, 255, 255, 0.1)');
    expect(live).not.toContain('--ai-size');
  });
});
