import type { Rect } from './drag-hit-test.js';
import type { DropEdge, DropZone, GroupRect } from './types.js';

export type DropHighlight = Rect & { kind: 'target' | 'split'; edge?: DropEdge };

function halfRect(rect: Rect, edge: DropEdge): Rect {
  if (edge === 'left') {
    return { left: rect.left, top: rect.top, width: rect.width / 2, height: rect.height };
  }
  if (edge === 'right') {
    return {
      left: rect.left + rect.width / 2,
      top: rect.top,
      width: rect.width / 2,
      height: rect.height,
    };
  }
  if (edge === 'up') {
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height / 2 };
  }
  return {
    left: rect.left,
    top: rect.top + rect.height / 2,
    width: rect.width,
    height: rect.height / 2,
  };
}

export function resolveDropHighlight(args: {
  zone: DropZone;
  groupRects: readonly GroupRect[];
  stage: Rect;
  rightPanel?: Rect;
}): DropHighlight[] {
  const { zone } = args;
  if (zone.kind === 'group-edge') {
    const rect = args.groupRects.find((item) => item.groupId === zone.groupId);
    if (!rect) return [];
    return [{ ...halfRect(rect, zone.edge), kind: 'split', edge: zone.edge }];
  }
  if (zone.kind === 'group-center' || zone.kind === 'group-tab') {
    const rect = args.groupRects.find((item) => item.groupId === zone.groupId);
    return rect ? [{ ...rect, kind: 'target' }] : [];
  }
  if (zone.kind === 'right-center' || zone.kind === 'right-tab') {
    const rect = args.rightPanel ?? {
      left: args.stage.left + args.stage.width * 0.72,
      top: args.stage.top,
      width: args.stage.width * 0.28,
      height: args.stage.height,
    };
    return [{ ...rect, kind: 'target' }];
  }
  if (zone.kind === 'right-dock-band') {
    const width = Math.min(120, Math.max(48, args.stage.width * 0.08));
    return [
      {
        kind: 'target',
        left: args.stage.left + args.stage.width - width,
        top: args.stage.top,
        width,
        height: args.stage.height,
      },
    ];
  }
  if (zone.kind === 'empty-stage') {
    return [{ ...args.stage, kind: 'target' }];
  }
  return [];
}
