export {
  CANVAS_VIEW_HARD_LIMIT,
  DEFAULT_RIGHT_PANEL_WIDTH_PX,
  DOCKING_WORKSPACE_FLAG_KEY,
  DROP_EDGE_BAND_MAX_PX,
  DROP_EDGE_BAND_RATIO,
  LIVE_SUBSCRIPTION_LIMIT,
  MOVABLE_TOOL_KINDS,
  PERSIST_DEBOUNCE_MS,
  REOPEN_STACK_LIMIT,
  STAGE_GROUP_HARD_LIMIT,
  STAGE_SESSION_MIN,
  WORKSPACE_LAYOUT_SCHEMA_VERSION,
  WORKSPACE_LAYOUT_STORAGE_KEY,
  WORKSPACE_VIEW_HARD_LIMIT,
} from './constants.js';
export { DOCKING_COPY } from './copy.js';
export { isDockingWorkspaceEnabled, setDockingWorkspaceEnabled } from './flag.js';
export { createSequentialIdFactory, createWorkspaceIdFactory } from './ids.js';
export type { WorkspaceIdFactory, WorkspaceIdKind } from './ids.js';
export {
  applyWorkspaceTemplate,
  closeView,
  createWorkspaceState,
  moveViewToEdge,
  moveViewToGroup,
  openSessionView,
  openToolView,
  reopenLastView,
  restoreDefaultLayout,
  setSplitRatio,
  splitGroupAtEdge,
  swapGroups,
} from './commands.js';
export { proposeDrop, splitPreviewLabel } from './drop.js';
export type { DropContext } from './drop.js';
export {
  allocateSplitSize,
  canSplitFurther,
  groupMinSize,
  listStageRects,
  listStageSeparatorRects,
  listStageSplitRects,
  resolveWorkspacePresentation,
  shouldExitFocusedMode,
  stageMinSize,
  viewMinSize,
} from './geometry.js';
export { focusView, maximizeGroup, resolveSessionTargetId, setDisplayMode } from './identity.js';
export { selectLiveSessionIds } from './live-budget.js';
export { migrateConversationPaneLayout, migrateDamagedLayout } from './migrate.js';
export {
  backupConversationPaneV1,
  loadWorkspaceState,
  parseWorkspaceState,
  saveWorkspaceState,
  serializeWorkspaceState,
  workspaceLayoutStorageKey,
} from './persist.js';
export {
  findSessionViewId,
  findViewGroupId,
  isLegalStageTopology,
  isRightGroupId,
  isStageGroupId,
  listStageGroupIds,
  stageDepth,
  stageGroupCount,
} from './topology.js';
export type {
  DockRejectCode,
  DropDecision,
  DropEdge,
  DropSource,
  DropZone,
  GroupRect,
  MovableToolKind,
  ReopenRecord,
  Size,
  StageNode,
  WorkspaceDisplayMode,
  WorkspaceGroup,
  WorkspaceOpResult,
  WorkspacePresentation,
  WorkspaceState,
  WorkspaceTemplate,
  WorkspaceView,
  WorkspaceViewKind,
} from './types.js';
export { isMovableToolKind } from './types.js';
export { DOCK_BAND_PX, buildHitTestInput, collectTabAreas, relativeRect, resolveDockDrag, toLocalPoint } from './docking-drop-resolver.js';
export { edgeBand, isInsideRect, resolveDropZone, resolveGroupEdge } from './drag-hit-test.js';
export type { HitTestInput, Point as DockingPoint, Rect as DockingRect, TabHitArea } from './drag-hit-test.js';
export { resolveDropHighlight } from './drag-preview.js';
export type { DropHighlight } from './drag-preview.js';
export { DockingDragOverlay } from './docking-drag-overlay.js';
export { DockingGroupView } from './docking-group-view.js';
export { DockingRightPanel } from './docking-right-panel.js';
export { DockingSeparator } from './docking-separator.js';
export { DockViewContent, resolveViewTitle } from './docking-surface-content.js';
export type { DockViewRenderContext } from './docking-surface-content.js';
export { useDockingDrag } from './use-docking-drag.js';
export type { DockDragController, DockDragResolution, DockDragState, DragPreview } from './use-docking-drag.js';
export {
  SURFACE_HOST_ATTRIBUTE,
  acquireSurfaceHosts,
  placeSurfaceHosts,
  useDockingSurfaceHosts,
} from './surface-pool.js';
export { inspectorTabToToolKind, tryOpenDockingTool } from './docking-tool-bridge.js';
export {
  DockToolHostsProvider,
  DockToolSurface,
  DockingOwnedToolNotice,
  useDockToolHosts,
} from './dock-tool-hosts.js';
export type { DockToolHosts } from './dock-tool-hosts.js';
