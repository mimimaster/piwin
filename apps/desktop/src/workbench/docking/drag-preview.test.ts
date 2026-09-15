import { describe, expect, it } from 'vitest';
import { resolveDropHighlight } from './drag-preview.js';
import type { GroupRect } from './types.js';

const g1: GroupRect = { groupId: 'g1', left: 0, top: 0, width: 600, height: 800 };
const g2: GroupRect = { groupId: 'g2', left: 600, top: 0, width: 600, height: 800 };
const stage = { left: 0, top: 0, width: 1200, height: 800 };

describe('docking drop preview', () => {
  it('previews a half rect for an edge split', () => {
    const highlights = resolveDropHighlight({
      zone: { kind: 'group-edge', groupId: 'g2', edge: 'right' },
      groupRects: [g1, g2],
      stage,
    });
    expect(highlights).toEqual([
      { kind: 'split', edge: 'right', left: 900, top: 0, width: 300, height: 800 },
    ]);
  });

  it('previews the whole group for center and tab drops', () => {
    expect(
      resolveDropHighlight({ zone: { kind: 'group-center', groupId: 'g1' }, groupRects: [g1, g2], stage }),
    ).toEqual([{ ...g1, kind: 'target' }]);
  });

  it('previews a dock band strip when no right panel is mounted', () => {
    const highlights = resolveDropHighlight({ zone: { kind: 'right-dock-band' }, groupRects: [g1, g2], stage });
    expect(highlights).toHaveLength(1);
    expect(highlights[0]?.width).toBe(96);
    expect(highlights[0]?.left).toBe(1104);
  });

  it('returns nothing for an unknown group', () => {
    expect(
      resolveDropHighlight({ zone: { kind: 'group-center', groupId: 'ghost' }, groupRects: [g1], stage }),
    ).toEqual([]);
  });
});
