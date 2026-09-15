import { describe, expect, it } from 'vitest';
import { edgeBand, resolveDropZone, resolveGroupEdge } from './drag-hit-test.js';
import type { GroupRect } from './types.js';

const left: GroupRect = { groupId: 'g1', left: 0, top: 0, width: 600, height: 800 };
const right: GroupRect = { groupId: 'g2', left: 600, top: 0, width: 600, height: 800 };
const stage = { left: 0, top: 0, width: 1200, height: 800 };

describe('docking drag hit test', () => {
  it('caps the edge band at 72px or 20% of the short side', () => {
    expect(edgeBand({ width: 1200, height: 800 })).toBe(72);
    expect(edgeBand({ width: 1200, height: 200 })).toBe(40);
    expect(edgeBand({ width: 0, height: 0 })).toBe(0);
  });

  it('resolves center, edges and tab strip', () => {
    expect(resolveDropZone({ point: { x: 300, y: 400 }, stage, groupRects: [left, right] })).toEqual({
      kind: 'group-center',
      groupId: 'g1',
    });
    expect(resolveDropZone({ point: { x: 20, y: 400 }, stage, groupRects: [left, right] })).toEqual({
      kind: 'group-edge',
      groupId: 'g1',
      edge: 'left',
    });
    expect(resolveDropZone({ point: { x: 1180, y: 400 }, stage, groupRects: [left, right] })).toEqual({
      kind: 'group-edge',
      groupId: 'g2',
      edge: 'right',
    });
    expect(
      resolveDropZone({
        point: { x: 640, y: 18 },
        stage,
        groupRects: [left, right],
        tabAreas: [{ groupId: 'g2', index: 1, left: 620, top: 0, width: 120, height: 36 }],
      }),
    ).toEqual({ kind: 'group-tab', groupId: 'g2', index: 1 });
  });

  it('breaks rect corners by nearest edge distance', () => {
    expect(resolveGroupEdge(left, { x: 10, y: 20 })).toBe('left');
    expect(resolveGroupEdge(left, { x: 20, y: 10 })).toBe('up');
    expect(resolveGroupEdge(left, { x: 300, y: 400 })).toBeNull();
  });

  it('resolves the right panel, its tabs and the dock band', () => {
    const rightPanel = {
      rect: { left: 960, top: 0, width: 240, height: 800 },
      tabAreas: [{ groupId: 'right', index: 0, left: 960, top: 0, width: 120, height: 36 }],
    };
    expect(
      resolveDropZone({ point: { x: 1000, y: 18 }, stage, groupRects: [left, right], rightPanel }),
    ).toEqual({ kind: 'right-tab', index: 0 });
    expect(
      resolveDropZone({ point: { x: 1100, y: 400 }, stage, groupRects: [left, right], rightPanel }),
    ).toEqual({ kind: 'right-center' });
    expect(
      resolveDropZone({
        point: { x: 1180, y: 400 },
        stage,
        groupRects: [left, right],
        dockBand: { left: 1128, top: 0, width: 72, height: 800 },
      }),
    ).toEqual({ kind: 'right-dock-band' });
  });

  it('returns null outside the workspace', () => {
    expect(resolveDropZone({ point: { x: -40, y: 400 }, stage, groupRects: [left, right] })).toBeNull();
  });
});
