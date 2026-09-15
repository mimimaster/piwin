import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const sidebar = readFileSync(join(here, 'sidebar.css'), 'utf8');

describe('Inkstone sidebar pane switch', () => {
  it('paints the selected chat/code thumb with s4 surface and elevation', () => {
    expect(sidebar).toMatch(/\.sidebar-mode-btn\.on \{[\s\S]*?background:\s*var\(--s4\);/);
    expect(sidebar).toMatch(/\.sidebar-mode-btn\.on \{[\s\S]*?box-shadow:\s*var\(--sh1\);/);
  });
});
