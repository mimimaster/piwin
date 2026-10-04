import {
  DROP_EDGE_BAND_MAX_PX,
  DROP_EDGE_BAND_RATIO,
  SIDEBAR_SESSION_EDGE_HYSTERESIS,
  SIDEBAR_SESSION_INTENT_THRESHOLD,
} from './constants.js';
import type { DropEdge, DropZone, GroupRect } from './types.js';

export type Rect = { left: number; top: number; width: number; height: number };
export type Point = { x: number; y: number };
export type TabHitArea = Rect & { groupId: string; index: number };

export type HitTestInput = {
  point: Point;
  stage: Rect;
  groupRects: readonly GroupRect[];
  tabAreas?: readonly TabHitArea[];
  rightPanel?: { rect: Rect; tabAreas?: readonly TabHitArea[] };
  dockBand?: Rect;
  sidebarSessionIntent?: {
    groupId: string;
    allowedEdges: readonly DropEdge[];
    previousEdge?: DropEdge | null;
  };
};

export function isInsideRect(rect: Rect, point: Point): boolean {
  return (
    point.x >= rect.left &&
    point.x <= rect.left + rect.width &&
    point.y >= rect.top &&
    point.y <= rect.top + rect.height
  );
}

export function edgeBand(size: { width: number; height: number }): number {
  const shortSide = Math.min(size.width, size.height);
  if (!Number.isFinite(shortSide) || shortSide <= 0) return 0;
  return Math.min(DROP_EDGE_BAND_MAX_PX, shortSide * DROP_EDGE_BAND_RATIO);
}

const ALL_DROP_EDGES: readonly DropEdge[] = ['left', 'right', 'up', 'down'];

function directionalScore(rect: Rect, point: Point, edge: DropEdge): number {
  if (rect.width <= 0 || rect.height <= 0) return Number.NEGATIVE_INFINITY;
  const horizontal = ((point.x - rect.left) / rect.width - 0.5) * 2;
  const vertical = ((point.y - rect.top) / rect.height - 0.5) * 2;
  if (edge === 'left') return -horizontal;
  if (edge === 'right') return horizontal;
  if (edge === 'up') return -vertical;
  return vertical;
}

/**
 * Sidebar sessions use broad directional intent areas: the strongest normalized
 * direction wins, while the center remains a deliberate replace/focus target.
 */
export function resolveSidebarSessionEdge(
  rect: Rect,
  point: Point,
  allowedEdges: readonly DropEdge[],
  previousEdge?: DropEdge | null,
): DropEdge | null {
  const candidates = allowedEdges.length > 0 ? allowedEdges : ALL_DROP_EDGES;
  let best: DropEdge | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const edge of candidates) {
    const score = directionalScore(rect, point, edge);
    if (score > bestScore) {
      best = edge;
      bestScore = score;
    }
  }
  if (!best || bestScore < SIDEBAR_SESSION_INTENT_THRESHOLD) return null;
  if (previousEdge && candidates.includes(previousEdge)) {
    const previousScore = directionalScore(rect, point, previousEdge);
    if (
      previousScore >= SIDEBAR_SESSION_INTENT_THRESHOLD &&
      bestScore - previousScore <= SIDEBAR_SESSION_EDGE_HYSTERESIS
    ) {
      return previousEdge;
    }
  }
  return best;
}

/** Nearest edge wins so a corner resolves deterministically to one drop intent. */
export function resolveGroupEdge(rect: Rect, point: Point): DropEdge | null {
  const band = edgeBand(rect);
  if (band <= 0) return null;
  const candidates: ReadonlyArray<readonly [DropEdge, number]> = [
    ['left', point.x - rect.left],
    ['right', rect.left + rect.width - point.x],
    ['up', point.y - rect.top],
    ['down', rect.top + rect.height - point.y],
  ];
  let best: DropEdge | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const [edge, distance] of candidates) {
    if (distance > band) continue;
    if (distance < bestDistance) {
      best = edge;
      bestDistance = distance;
    }
  }
  return best;
}

function findTab(areas: readonly TabHitArea[] | undefined, point: Point): TabHitArea | null {
  if (!areas) return null;
  for (const area of areas) {
    if (isInsideRect(area, point)) return area;
  }
  return null;
}

function findGroupRect(rects: readonly GroupRect[], point: Point): GroupRect | null {
  for (const rect of rects) {
    if (isInsideRect(rect, point)) return rect;
  }
  return null;
}

export function resolveDropZone(input: HitTestInput): DropZone | null {
  const { point } = input;
  const tab = findTab(input.tabAreas, point);
  if (tab) return { kind: 'group-tab', groupId: tab.groupId, index: tab.index };

  if (input.rightPanel) {
    const rightTab = findTab(input.rightPanel.tabAreas, point);
    if (rightTab) return { kind: 'right-tab', index: rightTab.index };
    if (input.dockBand && isInsideRect(input.dockBand, point)) return { kind: 'right-dock-band' };
    if (isInsideRect(input.rightPanel.rect, point)) return { kind: 'right-center' };
  } else if (input.dockBand && isInsideRect(input.dockBand, point)) {
    return { kind: 'right-dock-band' };
  }

  const group = findGroupRect(input.groupRects, point);
  if (group) {
    const sidebarIntent = input.sidebarSessionIntent;
    const edge =
      sidebarIntent?.groupId === group.groupId
        ? resolveSidebarSessionEdge(
            group,
            point,
            sidebarIntent.allowedEdges,
            sidebarIntent.previousEdge,
          )
        : resolveGroupEdge(group, point);
    return edge
      ? { kind: 'group-edge', groupId: group.groupId, edge }
      : { kind: 'group-center', groupId: group.groupId };
  }

  if (isInsideRect(input.stage, point)) return { kind: 'empty-stage' };
  return null;
}
