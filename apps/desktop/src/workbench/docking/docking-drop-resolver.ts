import type { HitTestInput, Point, Rect, TabHitArea } from './drag-hit-test.js';
import { resolveDropZone } from './drag-hit-test.js';
import { resolveDropHighlight } from './drag-preview.js';
import { proposeDrop } from './drop.js';
import type { WorkspaceIdFactory } from './ids.js';
import type { DockDragResolution } from './use-docking-drag.js';
import type { DropSource, GroupRect, Size, WorkspaceState } from './types.js';

export const DOCK_BAND_PX = 72;

/**
 * The element whose box is the stage. The primary layout renders the
 * workspace as `display: contents` (the stage is the ordinary workbench chat),
 * so the root itself has no box and measures 0×0; its nearest boxed ancestor
 * is the column the stage fills.
 */
export function resolveStageBoxElement(root: HTMLElement): HTMLElement {
  let element: HTMLElement = root;
  while (element.parentElement && getComputedStyle(element).display === 'contents') {
    element = element.parentElement;
  }
  return element;
}

export function toLocalPoint(origin: HTMLElement, point: Point): Point {
  const rect = origin.getBoundingClientRect();
  return { x: point.x - rect.left, y: point.y - rect.top };
}

export function collectTabAreas(
  origin: HTMLElement,
  selector: string,
  groupAttribute: string,
  indexAttribute: string,
  searchRoot: HTMLElement = origin,
): TabHitArea[] {
  const rootRect = origin.getBoundingClientRect();
  const areas: TabHitArea[] = [];
  for (const element of searchRoot.querySelectorAll<HTMLElement>(selector)) {
    const groupId = element.getAttribute(groupAttribute);
    const index = Number(element.getAttribute(indexAttribute) ?? '0');
    if (!groupId || !Number.isFinite(index)) continue;
    const rect = element.getBoundingClientRect();
    areas.push({
      groupId,
      index,
      left: rect.left - rootRect.left,
      top: rect.top - rootRect.top,
      width: rect.width,
      height: rect.height,
    });
  }
  return areas;
}

export function relativeRect(root: HTMLElement, element: HTMLElement): Rect {
  const rootRect = root.getBoundingClientRect();
  const rect = element.getBoundingClientRect();
  return {
    left: rect.left - rootRect.left,
    top: rect.top - rootRect.top,
    width: rect.width,
    height: rect.height,
  };
}

export function buildHitTestInput(args: {
  point: Point;
  root: HTMLElement;
  stageSize: Size;
  groupRects: readonly GroupRect[];
  panelElement: HTMLElement | null;
  rightPanelVisible: boolean;
  /**
   * Whether the dragged item may dock into the hidden right panel. The band
   * covers the stage's right split edge, so it only exists for tools.
   */
  allowDockBand?: boolean;
}): HitTestInput {
  const stage: Rect = { left: 0, top: 0, width: args.stageSize.width, height: args.stageSize.height };
  const panelRect =
    args.rightPanelVisible && args.panelElement ? relativeRect(args.root, args.panelElement) : null;
  const tabAreas = collectTabAreas(
    args.root,
    '[data-docking-tab]',
    'data-docking-tab-group',
    'data-docking-tab-index',
  );
  const rightTabAreas = args.panelElement
    ? collectTabAreas(
        args.root,
        '[data-docking-right-tab]',
        'data-docking-right-tab-group',
        'data-docking-right-tab-index',
        args.panelElement,
      )
    : [];
  const dockBand: Rect | null =
    panelRect || args.allowDockBand === false
    ? null
    : { left: stage.width - DOCK_BAND_PX, top: 0, width: DOCK_BAND_PX, height: stage.height };
  return {
    point: toLocalPoint(args.root, args.point),
    stage,
    groupRects: args.groupRects,
    tabAreas,
    ...(panelRect ? { rightPanel: { rect: panelRect, tabAreas: rightTabAreas } } : {}),
    ...(dockBand ? { dockBand } : {}),
  };
}

function isSessionSource(state: WorkspaceState, source: DropSource): boolean {
  if (source.kind === 'unopened-session') return true;
  return state.views[source.viewId]?.kind === 'session';
}

export function resolveDockDrag(args: {
  state: WorkspaceState;
  source: DropSource;
  point: Point;
  root: HTMLElement;
  stageSize: Size;
  groupRects: readonly GroupRect[];
  panelElement: HTMLElement | null;
  rightPanelVisible: boolean;
  createId: WorkspaceIdFactory;
  /** Active sidebar scope; sidebar drags from another project are rejected. */
  activeProjectScopeKey?: string;
  apply: (state: WorkspaceState) => void;
}): DockDragResolution | null {
  const input = buildHitTestInput({
    point: args.point,
    root: args.root,
    stageSize: args.stageSize,
    groupRects: args.groupRects,
    panelElement: args.panelElement,
    rightPanelVisible: args.rightPanelVisible,
    // Sessions never live in the right panel; near the right edge they split.
    allowDockBand: !isSessionSource(args.state, args.source),
  });
  const zone = resolveDropZone(input);
  if (!zone) return null;

  const decision = proposeDrop(args.state, args.source, zone, {
    createId: args.createId,
    stageSize: { width: args.stageSize.width, height: args.stageSize.height },
    ...(args.activeProjectScopeKey !== undefined
      ? { activeProjectScopeKey: args.activeProjectScopeKey }
      : {}),
  });
  if (!decision.ok) {
    return {
      preview: { ok: false, label: null, message: decision.message, highlight: [] },
      commit: () => undefined,
    };
  }
  const nextState = decision.state;
  const highlight = resolveDropHighlight({
    zone,
    groupRects: args.groupRects,
    stage: input.stage,
    ...(input.rightPanel ? { rightPanel: input.rightPanel.rect } : {}),
  });
  return {
    preview: { ok: true, label: decision.label, message: null, highlight },
    commit: () => args.apply(nextState),
  };
}
