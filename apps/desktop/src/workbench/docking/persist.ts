import {
  conversationPaneStorageKey,
  parseConversationPaneLayout,
} from '../../conversation-pane-storage.js';
import {
  CONVERSATION_PANE_V1_BACKUP_SUFFIX,
  DEFAULT_RIGHT_PANEL_WIDTH_PX,
  RIGHT_PANEL_GROUP_LIMIT_V1,
  STAGE_GROUP_HARD_LIMIT,
  WORKSPACE_LAYOUT_SCHEMA_VERSION,
  WORKSPACE_LAYOUT_STORAGE_KEY,
  WORKSPACE_VIEW_HARD_LIMIT,
} from './constants.js';
import type { WorkspaceIdFactory } from './ids.js';
import { migrateConversationPaneLayout, migrateDamagedLayout, type WorkspaceMigrationResult } from './migrate.js';
import { isLegalStageTopology, listStageGroupIds } from './topology.js';
import type {
  StageNode,
  WorkspaceGroup,
  WorkspaceState,
  WorkspaceView,
  WorkspaceViewKind,
} from './types.js';
import { createWorkspaceState } from './view-commands.js';

type StorageReader = Pick<Storage, 'getItem'>;
type StorageWriter = Pick<Storage, 'setItem'>;

const MAX_ID_LENGTH = 256;
const VIEW_KINDS: readonly WorkspaceViewKind[] = [
  'session',
  'browser',
  'changes',
  'canvas',
  'doc',
  'invalid',
];

export function workspaceLayoutStorageKey(scopeKey?: string): string {
  const normalized = scopeKey?.trim();
  return normalized && normalized !== 'general'
    ? `${WORKSPACE_LAYOUT_STORAGE_KEY}:${encodeURIComponent(normalized)}`
    : WORKSPACE_LAYOUT_STORAGE_KEY;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const id = value.trim();
  return id.length > 0 && id.length <= MAX_ID_LENGTH ? id : null;
}

function parseStage(value: unknown, depth: number, groupIds: Set<string>, splitIds: Set<string>): StageNode | null {
  if (!isRecord(value) || depth > 2) return null;
  if (value.kind === 'group') {
    const groupId = readId(value.groupId);
    if (!groupId || groupIds.has(groupId) || groupIds.size >= STAGE_GROUP_HARD_LIMIT) return null;
    groupIds.add(groupId);
    return { kind: 'group', groupId };
  }
  if (value.kind !== 'split') return null;
  const splitId = readId(value.splitId);
  if (
    !splitId ||
    splitIds.has(splitId) ||
    (value.orientation !== 'row' && value.orientation !== 'column') ||
    typeof value.ratio !== 'number' ||
    !Number.isFinite(value.ratio)
  ) {
    return null;
  }
  splitIds.add(splitId);
  const first = parseStage(value.first, depth + 1, groupIds, splitIds);
  const second = parseStage(value.second, depth + 1, groupIds, splitIds);
  if (!first || !second) return null;
  return {
    kind: 'split',
    splitId,
    orientation: value.orientation,
    ratio: value.ratio,
    first,
    second,
  };
}

function parseView(value: unknown, viewIds: Set<string>): WorkspaceView | null {
  if (!isRecord(value)) return null;
  const viewId = readId(value.viewId);
  const kind = value.kind;
  if (!viewId || viewIds.has(viewId) || typeof kind !== 'string' || !VIEW_KINDS.includes(kind as WorkspaceViewKind)) {
    return null;
  }
  viewIds.add(viewId);
  const view: WorkspaceView = { viewId, kind: kind as WorkspaceViewKind };
  if (typeof value.sessionId === 'string') view.sessionId = value.sessionId;
  if (value.boundSessionId === null || typeof value.boundSessionId === 'string') {
    view.boundSessionId = value.boundSessionId;
  }
  if (typeof value.title === 'string') view.title = value.title;
  if (value.invalid === true) view.invalid = true;
  return view;
}

function parseGroup(value: unknown, knownViews: Set<string>): WorkspaceGroup | null {
  if (!isRecord(value)) return null;
  const groupId = readId(value.groupId);
  if (!groupId || !Array.isArray(value.viewIds)) return null;
  const viewIds: string[] = [];
  for (const entry of value.viewIds) {
    if (typeof entry !== 'string' || !knownViews.has(entry) || viewIds.includes(entry)) continue;
    viewIds.push(entry);
  }
  const activeViewId =
    typeof value.activeViewId === 'string' && viewIds.includes(value.activeViewId) ? value.activeViewId : (viewIds[0] ?? null);
  return { groupId, viewIds, activeViewId };
}

export function parseWorkspaceState(value: unknown): WorkspaceState | null {
  if (!isRecord(value) || value.version !== WORKSPACE_LAYOUT_SCHEMA_VERSION) return null;
  const stageGroupIds = new Set<string>();
  const stage = parseStage(value.stage, 0, stageGroupIds, new Set());
  if (!stage || !isLegalStageTopology(stage)) return null;
  if (!isRecord(value.views) || !isRecord(value.groups) || !isRecord(value.rightPanel)) return null;

  const views: Record<string, WorkspaceView> = {};
  const viewIds = new Set<string>();
  for (const raw of Object.values(value.views)) {
    if (viewIds.size >= WORKSPACE_VIEW_HARD_LIMIT) break;
    const view = parseView(raw, viewIds);
    if (view) views[view.viewId] = view;
  }

  const groups: Record<string, WorkspaceGroup> = {};
  for (const raw of Object.values(value.groups)) {
    const group = parseGroup(raw, viewIds);
    if (group) groups[group.groupId] = group;
  }
  for (const groupId of listStageGroupIds(stage)) {
    if (!groups[groupId]) {
      groups[groupId] = { groupId, viewIds: [], activeViewId: null };
    }
  }

  const rightGroupIds: string[] = [];
  if (Array.isArray(value.rightPanel.groupIds)) {
    for (const entry of value.rightPanel.groupIds) {
      if (typeof entry !== 'string' || !groups[entry] || rightGroupIds.includes(entry)) continue;
      if (stageGroupIds.has(entry)) continue;
      rightGroupIds.push(entry);
      if (rightGroupIds.length >= RIGHT_PANEL_GROUP_LIMIT_V1) break;
    }
  }
  if (rightGroupIds.length === 0) return null;

  const width =
    typeof value.rightPanel.width === 'number' && Number.isFinite(value.rightPanel.width)
      ? value.rightPanel.width
      : DEFAULT_RIGHT_PANEL_WIDTH_PX;
  const activeGroupId =
    typeof value.activeGroupId === 'string' && groups[value.activeGroupId]
      ? value.activeGroupId
      : (listStageGroupIds(stage)[0] ?? rightGroupIds[0] ?? '');
  if (!activeGroupId) return null;
  const sessionTargetId = typeof value.sessionTargetId === 'string' ? value.sessionTargetId : null;

  return {
    version: WORKSPACE_LAYOUT_SCHEMA_VERSION,
    stage,
    groups,
    views,
    rightPanel: {
      groupIds: rightGroupIds,
      collapsed: value.rightPanel.collapsed === true,
      width,
    },
    activeGroupId,
    focusedViewId: null,
    sessionTargetId,
    displayMode: 'normal',
    maximizedGroupId: null,
    reopenStack: [],
  };
}

export function serializeWorkspaceState(state: WorkspaceState): unknown {
  return {
    version: state.version,
    stage: state.stage,
    groups: state.groups,
    views: state.views,
    rightPanel: {
      groupIds: state.rightPanel.groupIds,
      collapsed: state.rightPanel.collapsed,
      width: state.rightPanel.width,
    },
    activeGroupId: state.activeGroupId,
    sessionTargetId: state.sessionTargetId,
  };
}

export function backupConversationPaneV1(storage: StorageWriter & StorageReader, scopeKey?: string): void {
  const key = conversationPaneStorageKey(scopeKey);
  const current = storage.getItem(key);
  if (current === null) return;
  const backupKey = `${key}${CONVERSATION_PANE_V1_BACKUP_SUFFIX}`;
  if (storage.getItem(backupKey) === null) {
    storage.setItem(backupKey, current);
  }
}

export function loadWorkspaceState(
  createId: WorkspaceIdFactory,
  storage?: StorageReader,
  scopeKey?: string,
): WorkspaceMigrationResult {
  const resolved = storage ?? (typeof window === 'undefined' ? undefined : window.localStorage);
  const empty = createWorkspaceState(createId);
  if (!resolved) return { state: empty, migrated: false, notice: null };
  try {
    const rawV2 = resolved.getItem(workspaceLayoutStorageKey(scopeKey));
    if (rawV2 !== null) {
      const parsed = parseWorkspaceState(JSON.parse(rawV2));
      if (parsed) return { state: parsed, migrated: false, notice: null };
      return migrateDamagedLayout(JSON.parse(rawV2), createId);
    }
    const rawV1 = resolved.getItem(conversationPaneStorageKey(scopeKey));
    if (rawV1 === null) return { state: empty, migrated: false, notice: null };
    const json: unknown = JSON.parse(rawV1);
    const layout = parseConversationPaneLayout(json);
    if (layout) return migrateConversationPaneLayout(layout, createId);
    return migrateDamagedLayout(json, createId);
  } catch {
    return { state: empty, migrated: false, notice: null };
  }
}

export function saveWorkspaceState(
  state: WorkspaceState,
  storage?: StorageWriter,
  scopeKey?: string,
): void {
  const resolved = storage ?? (typeof window === 'undefined' ? undefined : window.localStorage);
  if (!resolved) return;
  try {
    resolved.setItem(workspaceLayoutStorageKey(scopeKey), JSON.stringify(serializeWorkspaceState(state)));
  } catch {
    // Persistence is best-effort and must not affect Host session authority.
  }
}
