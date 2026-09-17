import {
  FOCUSED_RESTORE_HYSTERESIS_PX,
  STAGE_BROWSER_CANVAS_MIN,
  STAGE_GROUP_HARD_LIMIT,
  STAGE_SESSION_MIN,
  STAGE_TOOL_MIN,
} from './constants.js';
import { listStageGroupIds, stageGroupCount } from './topology.js';
import type {
  GroupRect,
  Size,
  StageNode,
  WorkspacePresentation,
  WorkspaceState,
  WorkspaceViewKind,
} from './types.js';

export function viewMinSize(kind: WorkspaceViewKind): Size {
  if (kind === 'session') return { width: STAGE_SESSION_MIN.width, height: STAGE_SESSION_MIN.height };
  if (kind === 'browser' || kind === 'canvas') {
    return { width: STAGE_BROWSER_CANVAS_MIN.width, height: STAGE_BROWSER_CANVAS_MIN.height };
  }
  return { width: STAGE_TOOL_MIN.width, height: STAGE_TOOL_MIN.height };
}

export function groupMinSize(state: WorkspaceState, groupId: string): Size {
  const group = state.groups[groupId];
  if (!group || group.viewIds.length === 0) {
    return { width: STAGE_SESSION_MIN.width, height: STAGE_SESSION_MIN.height };
  }
  let width = 0;
  let height = 0;
  for (const viewId of group.viewIds) {
    const view = state.views[viewId];
    if (!view) continue;
    const min = viewMinSize(view.kind);
    width = Math.max(width, min.width);
    height = Math.max(height, min.height);
  }
  return { width, height };
}

export function stageMinSize(state: WorkspaceState, node: StageNode = state.stage): Size {
  if (node.kind === 'group') return groupMinSize(state, node.groupId);
  const first = stageMinSize(state, node.first);
  const second = stageMinSize(state, node.second);
  return node.orientation === 'row'
    ? { width: first.width + second.width, height: Math.max(first.height, second.height) }
    : { width: Math.max(first.width, second.width), height: first.height + second.height };
}

export function clampSplitWeight(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0.5;
  return Math.min(0.99, Math.max(0.01, ratio));
}

/**
 * Display allocation only. Does not rewrite stored weights.
 */
export function allocateSplitSize(
  available: number,
  ratio: number,
  minFirst: number,
  minSecond: number,
): { first: number; second: number } {
  if (!Number.isFinite(available) || available <= 0) {
    return { first: 0, second: 0 };
  }
  if (available < minFirst + minSecond) {
    // Neither pane can keep its minimum. Preserve the user's weight instead of
    // silently re-balancing, so the seam stays where they put it and the pane
    // springs back the moment the viewport grows again.
    const first = available * clampSplitWeight(ratio);
    return { first, second: available - first };
  }
  let first = available * clampSplitWeight(ratio);
  let second = available - first;
  if (first < minFirst) {
    first = minFirst;
    second = available - first;
  } else if (second < minSecond) {
    second = minSecond;
    first = available - second;
  }
  return { first, second };
}

export function listStageRects(
  state: WorkspaceState,
  bounds: { left: number; top: number; width: number; height: number },
  node: StageNode = state.stage,
): GroupRect[] {
  if (node.kind === 'group') {
    return [
      {
        groupId: node.groupId,
        left: bounds.left,
        top: bounds.top,
        width: bounds.width,
        height: bounds.height,
      },
    ];
  }
  const firstMin = stageMinSize(state, node.first);
  const secondMin = stageMinSize(state, node.second);
  if (node.orientation === 'row') {
    const allocated = allocateSplitSize(bounds.width, node.ratio, firstMin.width, secondMin.width);
    return [
      ...listStageRects(state, { ...bounds, width: allocated.first }, node.first),
      ...listStageRects(
        state,
        { left: bounds.left + allocated.first, top: bounds.top, width: allocated.second, height: bounds.height },
        node.second,
      ),
    ];
  }
  const allocated = allocateSplitSize(bounds.height, node.ratio, firstMin.height, secondMin.height);
  return [
    ...listStageRects(state, { ...bounds, height: allocated.first }, node.first),
    ...listStageRects(
      state,
      { left: bounds.left, top: bounds.top + allocated.first, width: bounds.width, height: allocated.second },
      node.second,
    ),
  ];
}

export function canSplitFurther(state: WorkspaceState, available: Size): boolean {
  if (stageGroupCount(state.stage) >= STAGE_GROUP_HARD_LIMIT) return false;
  const min = stageMinSize(state);
  return (
    available.width >= min.width + STAGE_SESSION_MIN.width ||
    available.height >= min.height + STAGE_SESSION_MIN.height
  );
}

export function resolveWorkspacePresentation(input: {
  stageSize: Size;
  rightPanelOpen: boolean;
  rightPanelWidth: number;
  state: WorkspaceState;
}): WorkspacePresentation {
  const min = stageMinSize(input.state);
  const reservedRight = input.rightPanelOpen ? input.rightPanelWidth : 0;
  const withRight = {
    width: input.stageSize.width - reservedRight,
    height: input.stageSize.height,
  };
  const fits = (size: Size): boolean => size.width >= min.width && size.height >= min.height;
  if (fits(withRight)) {
    return canSplitFurther(input.state, withRight) ? 'normal' : 'block-split';
  }
  if (input.rightPanelOpen && fits(input.stageSize)) {
    return 'right-drawer';
  }
  if (listStageGroupIds(input.state.stage).length > 1) {
    return 'focused';
  }
  return 'block-split';
}

export function shouldExitFocusedMode(available: Size, layoutMin: Size): boolean {
  return (
    available.width >= layoutMin.width + FOCUSED_RESTORE_HYSTERESIS_PX &&
    available.height >= layoutMin.height + FOCUSED_RESTORE_HYSTERESIS_PX
  );
}

export function edgeBandPx(shortSide: number): number {
  return Math.min(72, Math.max(0, shortSide * 0.2));
}

export type StageSplitRect = {
  splitId: string;
  orientation: 'row' | 'column';
  left: number;
  top: number;
  width: number;
  height: number;
};

export function listStageSplitRects(
  state: WorkspaceState,
  bounds: { left: number; top: number; width: number; height: number },
  node: StageNode = state.stage,
): StageSplitRect[] {
  if (node.kind === 'group') return [];
  const firstMin = stageMinSize(state, node.first);
  const secondMin = stageMinSize(state, node.second);
  const current: StageSplitRect = {
    splitId: node.splitId,
    orientation: node.orientation,
    left: bounds.left,
    top: bounds.top,
    width: bounds.width,
    height: bounds.height,
  };
  if (node.orientation === 'row') {
    const allocated = allocateSplitSize(bounds.width, node.ratio, firstMin.width, secondMin.width);
    return [
      current,
      ...listStageSplitRects(state, { ...bounds, width: allocated.first }, node.first),
      ...listStageSplitRects(
        state,
        { left: bounds.left + allocated.first, top: bounds.top, width: allocated.second, height: bounds.height },
        node.second,
      ),
    ];
  }
  const allocated = allocateSplitSize(bounds.height, node.ratio, firstMin.height, secondMin.height);
  return [
    current,
    ...listStageSplitRects(state, { ...bounds, height: allocated.first }, node.first),
    ...listStageSplitRects(
      state,
      { left: bounds.left, top: bounds.top + allocated.first, width: bounds.width, height: allocated.second },
      node.second,
    ),
  ];
}

export type StageSeparatorRect = {
  splitId: string;
  orientation: 'row' | 'column';
  ratio: number;
  rect: { left: number; top: number; width: number; height: number };
  /** px offset of the split boundary inside `rect`, in the same space as `bounds`. */
  boundary: number;
};

/**
 * Handle geometry is derived from the allocated display sizes, never from the
 * stored weight, so a constrained split keeps its handle on the visible seam.
 */
export function listStageSeparatorRects(
  state: WorkspaceState,
  bounds: { left: number; top: number; width: number; height: number },
  node: StageNode = state.stage,
): StageSeparatorRect[] {
  if (node.kind === 'group') return [];
  const firstMin = stageMinSize(state, node.first);
  const secondMin = stageMinSize(state, node.second);
  const isRow = node.orientation === 'row';
  const allocated = isRow
    ? allocateSplitSize(bounds.width, node.ratio, firstMin.width, secondMin.width)
    : allocateSplitSize(bounds.height, node.ratio, firstMin.height, secondMin.height);
  const current: StageSeparatorRect = {
    splitId: node.splitId,
    orientation: node.orientation,
    ratio: node.ratio,
    rect: bounds,
    boundary: (isRow ? bounds.left : bounds.top) + allocated.first,
  };
  const firstBounds = isRow
    ? { ...bounds, width: allocated.first }
    : { ...bounds, height: allocated.first };
  const secondBounds = isRow
    ? { left: bounds.left + allocated.first, top: bounds.top, width: allocated.second, height: bounds.height }
    : { left: bounds.left, top: bounds.top + allocated.first, width: bounds.width, height: allocated.second };
  return [
    current,
    ...listStageSeparatorRects(state, firstBounds, node.first),
    ...listStageSeparatorRects(state, secondBounds, node.second),
  ];
}
