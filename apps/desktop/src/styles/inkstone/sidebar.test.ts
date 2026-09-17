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

describe('Inkstone sidebar leading section', () => {
  it('compacts the first tree row in both flow and virtual lists', () => {
    // >60 conversation rows wrap as .sidebar-tree-virtual-item. The old
    // .sidebar-tree-flow-item:first-child-only rule left the 12px+6px
    // conversations divider in place and looked like a revert.
    expect(sidebar).toMatch(
      /:is\(\s*\.sidebar-tree-flow-item,\s*\.sidebar-tree-virtual-item\s*\):first-child/,
    );
    expect(sidebar).toMatch(
      /:is\(\s*\.sidebar-tree-flow-item,\s*\.sidebar-tree-virtual-item\s*\):first-child\s+\.sidebar-section-label-row--conversations \{[\s\S]*?border-top:\s*0/,
    );
  });
});
