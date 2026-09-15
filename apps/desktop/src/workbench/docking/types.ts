import type { WORKSPACE_LAYOUT_SCHEMA_VERSION } from './constants.js';
import { MOVABLE_TOOL_KINDS } from './constants.js';

export type MovableToolKind = (typeof MOVABLE_TOOL_KINDS)[number];
export type WorkspaceViewKind = 'session' | MovableToolKind | 'invalid';
export type SplitOrientation = 'row' | 'column';
export type DropEdge = 'left' | 'right' | 'up' | 'down';
export type WorkspaceTemplate = 'single' | 'columns' | 'rows' | 'quad';
export type WorkspaceDisplayMode = 'normal' | 'maximized' | 'tool-expanded' | 'focused';
export type WorkspacePresentation = 'normal' | 'block-split' | 'right-drawer' | 'focused';

export type WorkspaceView = {
  viewId: string;
  kind: WorkspaceViewKind;
  sessionId?: string;
  boundSessionId?: string | null;
  title?: string;
  invalid?: boolean;
};

export type WorkspaceGroup = {
  groupId: string;
  viewIds: string[];
  activeViewId: string | null;
};

export type StageGroupNode = {
  kind: 'group';
  groupId: string;
};

export type StageSplitNode = {
  kind: 'split';
  splitId: string;
  orientation: SplitOrientation;
  /** User weight in (0, 1). Never rewritten by viewport constrain. */
  ratio: number;
  first: StageNode;
  second: StageNode;
};

export type StageNode = StageGroupNode | StageSplitNode;

export type ReopenRecord = {
  kind: WorkspaceViewKind;
  sourceGroupId: string;
  sessionId?: string;
  boundSessionId?: string | null;
  title?: string;
};

export type RightPanelState = {
  groupIds: string[];
  collapsed: boolean;
  width: number;
};

export type WorkspaceState = {
  version: typeof WORKSPACE_LAYOUT_SCHEMA_VERSION;
  stage: StageNode;
  groups: Record<string, WorkspaceGroup>;
  views: Record<string, WorkspaceView>;
  rightPanel: RightPanelState;
  activeGroupId: string;
  focusedViewId: string | null;
  sessionTargetId: string | null;
  displayMode: WorkspaceDisplayMode;
  maximizedGroupId: string | null;
  reopenStack: ReopenRecord[];
};

export type Size = {
  width: number;
  height: number;
};

export type GroupRect = {
  groupId: string;
  left: number;
  top: number;
  width: number;
  height: number;
};

export type DockRejectCode =
  | 'insufficient-space'
  | 'stage-group-limit'
  | 'cross-project'
  | 'illegal-topology'
  | 'tool-not-movable'
  | 'session-not-in-right-panel'
  | 'view-limit'
  | 'no-op'
  | 'singleton-exists'
  | 'canvas-limit'
  | 'missing-target';

export type WorkspaceOpFailure = {
  ok: false;
  state: WorkspaceState;
  code: DockRejectCode;
  message: string;
};

export type WorkspaceOpSuccess = {
  ok: true;
  state: WorkspaceState;
};

export type WorkspaceOpResult = WorkspaceOpSuccess | WorkspaceOpFailure;

export type DropZone =
  | { kind: 'group-center'; groupId: string }
  | { kind: 'group-tab'; groupId: string; index: number }
  | { kind: 'group-edge'; groupId: string; edge: DropEdge }
  | { kind: 'right-center' }
  | { kind: 'right-tab'; index: number }
  | { kind: 'right-edge'; edge: DropEdge }
  | { kind: 'right-dock-band' }
  | { kind: 'empty-stage' };

export type DropSource =
  | { kind: 'unopened-session'; sessionId: string; projectScopeKey?: string }
  | { kind: 'view'; viewId: string; projectScopeKey?: string };

export type DropDecision =
  | { ok: true; state: WorkspaceState; label: string }
  | { ok: false; code: DockRejectCode; message: string };

export function isMovableToolKind(kind: WorkspaceViewKind): kind is MovableToolKind {
  return (MOVABLE_TOOL_KINDS as readonly string[]).includes(kind);
}
