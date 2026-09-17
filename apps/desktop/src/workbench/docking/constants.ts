export const WORKSPACE_LAYOUT_SCHEMA_VERSION = 2 as const;
export const STAGE_GROUP_HARD_LIMIT = 4;
export const RIGHT_PANEL_GROUP_LIMIT_V1 = 1;
export const WORKSPACE_VIEW_HARD_LIMIT = 24;
export const REOPEN_STACK_LIMIT = 20;
export const LIVE_SUBSCRIPTION_LIMIT = 8;
export const CANVAS_VIEW_HARD_LIMIT = 4;
export const SPLIT_WEIGHT_MIN = 0.01;
export const SPLIT_WEIGHT_MAX = 0.99;
export const FOCUSED_RESTORE_HYSTERESIS_PX = 32;
export const DROP_EDGE_BAND_RATIO = 0.2;
export const DROP_EDGE_BAND_MAX_PX = 72;
export const DRAG_ACTIVATION_THRESHOLD_PX = 4;
export const PERSIST_DEBOUNCE_MS = 500;

export const STAGE_SESSION_MIN = { width: 420, height: 320 } as const;
export const STAGE_TOOL_MIN = { width: 320, height: 220 } as const;
export const STAGE_BROWSER_CANVAS_MIN = { width: 360, height: 260 } as const;
export const RIGHT_FILE_TREE_MIN = { width: 240, height: 200 } as const;
export const RIGHT_TERMINAL_MIN = { width: 320, height: 220 } as const;

export const WORKSPACE_LAYOUT_STORAGE_KEY = 'piwin.desktop.workspaceLayout.v2';
export const DOCKING_WORKSPACE_FLAG_KEY = 'piwin.desktop.dockingWorkspace.enabled';
export const CONVERSATION_PANE_V1_BACKUP_SUFFIX = '.backup';

export const MOVABLE_TOOL_KINDS = ['browser', 'changes', 'canvas', 'doc'] as const;
