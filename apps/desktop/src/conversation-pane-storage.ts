import {
  CONVERSATION_PANE_LAYOUT_VERSION,
  CONVERSATION_PANE_MAX_COUNT,
  PRIMARY_CONVERSATION_PANE_ID,
  clampConversationPaneRatio,
  createConversationPaneLayout,
  listConversationPaneLeaves,
  type ConversationPaneLayout,
  type ConversationPaneNode,
} from './conversation-pane-layout.js';

export const CONVERSATION_PANE_STORAGE_KEY = 'piwin.desktop.conversationPanes.v1';
const MAX_LAYOUT_DEPTH = 8;
const MAX_ID_LENGTH = 256;

type StorageReader = Pick<Storage, 'getItem'>;
type StorageWriter = Pick<Storage, 'setItem'>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readBoundedId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const id = value.trim();
  return id.length > 0 && id.length <= MAX_ID_LENGTH ? id : null;
}

function parsePaneNode(
  value: unknown,
  depth: number,
  paneIds: Set<string>,
  splitIds: Set<string>,
  sessionIds: Set<string>,
): ConversationPaneNode | null {
  if (!isRecord(value) || depth > MAX_LAYOUT_DEPTH) return null;
  if (value.kind === 'leaf') {
    const paneId = readBoundedId(value.paneId);
    if (paneId === null || paneIds.has(paneId) || paneIds.size >= CONVERSATION_PANE_MAX_COUNT) {
      return null;
    }
    const sessionId = value.sessionId === null ? null : readBoundedId(value.sessionId);
    if (value.sessionId !== null && sessionId === null) return null;
    if (sessionId !== null && sessionIds.has(sessionId)) return null;
    paneIds.add(paneId);
    if (sessionId !== null) sessionIds.add(sessionId);
    return { kind: 'leaf', paneId, sessionId };
  }
  if (value.kind !== 'split') return null;
  const splitId = readBoundedId(value.splitId);
  if (
    splitId === null ||
    splitIds.has(splitId) ||
    (value.orientation !== 'row' && value.orientation !== 'column') ||
    typeof value.ratio !== 'number' ||
    !Number.isFinite(value.ratio)
  ) {
    return null;
  }
  splitIds.add(splitId);
  const first = parsePaneNode(value.first, depth + 1, paneIds, splitIds, sessionIds);
  const second = parsePaneNode(value.second, depth + 1, paneIds, splitIds, sessionIds);
  if (first === null || second === null) return null;
  return {
    kind: 'split',
    splitId,
    orientation: value.orientation,
    ratio: clampConversationPaneRatio(value.ratio),
    first,
    second,
  };
}

export function parseConversationPaneLayout(value: unknown): ConversationPaneLayout | null {
  if (!isRecord(value) || value.version !== CONVERSATION_PANE_LAYOUT_VERSION) return null;
  const paneIds = new Set<string>();
  const root = parsePaneNode(value.root, 0, paneIds, new Set(), new Set());
  if (root === null || !paneIds.has(PRIMARY_CONVERSATION_PANE_ID)) return null;
  const leaves = listConversationPaneLeaves(root);
  if (leaves.length === 0 || leaves.length > CONVERSATION_PANE_MAX_COUNT) return null;
  const requestedActivePaneId = readBoundedId(value.activePaneId);
  const activePaneId =
    requestedActivePaneId !== null && paneIds.has(requestedActivePaneId)
      ? requestedActivePaneId
      : PRIMARY_CONVERSATION_PANE_ID;
  const requestedMaximizedPaneId =
    value.maximizedPaneId === null ? null : readBoundedId(value.maximizedPaneId);
  const maximizedPaneId =
    requestedMaximizedPaneId !== null && paneIds.has(requestedMaximizedPaneId)
      ? requestedMaximizedPaneId
      : null;
  return {
    version: CONVERSATION_PANE_LAYOUT_VERSION,
    root,
    activePaneId,
    maximizedPaneId,
  };
}

export function loadConversationPaneLayout(storage?: StorageReader): ConversationPaneLayout {
  try {
    const resolvedStorage =
      storage ?? (typeof window === 'undefined' ? undefined : window.localStorage);
    if (!resolvedStorage) return createConversationPaneLayout();
    const serialized = resolvedStorage.getItem(CONVERSATION_PANE_STORAGE_KEY);
    if (serialized === null) return createConversationPaneLayout();
    return parseConversationPaneLayout(JSON.parse(serialized)) ?? createConversationPaneLayout();
  } catch {
    return createConversationPaneLayout();
  }
}

export function saveConversationPaneLayout(
  layout: ConversationPaneLayout,
  storage?: StorageWriter,
): void {
  try {
    const resolvedStorage =
      storage ?? (typeof window === 'undefined' ? undefined : window.localStorage);
    if (!resolvedStorage) return;
    resolvedStorage.setItem(CONVERSATION_PANE_STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // Layout persistence is best-effort; Host/session state is unaffected.
  }
}
