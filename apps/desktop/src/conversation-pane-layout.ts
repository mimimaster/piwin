export const CONVERSATION_PANE_LAYOUT_VERSION = 1 as const;
export const CONVERSATION_PANE_MAX_COUNT = 8;
export const CONVERSATION_PANE_MIN_RATIO = 0.2;
export const CONVERSATION_PANE_MAX_RATIO = 0.8;
export const PRIMARY_CONVERSATION_PANE_ID = 'conversation-pane-primary';

export type ConversationPaneOrientation = 'row' | 'column';
export type ConversationPaneDirection = 'left' | 'right' | 'up' | 'down';
export type ConversationPanePreset = 1 | 2 | 4 | 8;

export type ConversationPaneLeaf = {
  kind: 'leaf';
  paneId: string;
  sessionId: string | null;
};

export type ConversationPaneSplit = {
  kind: 'split';
  splitId: string;
  orientation: ConversationPaneOrientation;
  ratio: number;
  first: ConversationPaneNode;
  second: ConversationPaneNode;
};

export type ConversationPaneNode = ConversationPaneLeaf | ConversationPaneSplit;

export type ConversationPaneLayout = {
  version: typeof CONVERSATION_PANE_LAYOUT_VERSION;
  root: ConversationPaneNode;
  activePaneId: string;
  maximizedPaneId: string | null;
};

export type ConversationPaneIdFactory = (kind: 'pane' | 'split') => string;

export type ConversationPaneRect = {
  paneId: string;
  left: number;
  top: number;
  width: number;
  height: number;
};

export function createConversationPaneLayout(
  primarySessionId: string | null = null,
): ConversationPaneLayout {
  return {
    version: CONVERSATION_PANE_LAYOUT_VERSION,
    root: {
      kind: 'leaf',
      paneId: PRIMARY_CONVERSATION_PANE_ID,
      sessionId: primarySessionId,
    },
    activePaneId: PRIMARY_CONVERSATION_PANE_ID,
    maximizedPaneId: null,
  };
}

export function clampConversationPaneRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) {
    return 0.5;
  }
  return Math.min(CONVERSATION_PANE_MAX_RATIO, Math.max(CONVERSATION_PANE_MIN_RATIO, ratio));
}

export function listConversationPaneLeaves(node: ConversationPaneNode): ConversationPaneLeaf[] {
  if (node.kind === 'leaf') {
    return [node];
  }
  return [...listConversationPaneLeaves(node.first), ...listConversationPaneLeaves(node.second)];
}

export function findConversationPaneLeaf(
  node: ConversationPaneNode,
  paneId: string,
): ConversationPaneLeaf | null {
  if (node.kind === 'leaf') {
    return node.paneId === paneId ? node : null;
  }
  return (
    findConversationPaneLeaf(node.first, paneId) ?? findConversationPaneLeaf(node.second, paneId)
  );
}

function mapPaneNode(
  node: ConversationPaneNode,
  paneId: string,
  update: (leaf: ConversationPaneLeaf) => ConversationPaneNode,
): ConversationPaneNode {
  if (node.kind === 'leaf') {
    return node.paneId === paneId ? update(node) : node;
  }
  const first = mapPaneNode(node.first, paneId, update);
  const second = mapPaneNode(node.second, paneId, update);
  return first === node.first && second === node.second ? node : { ...node, first, second };
}

export function focusConversationPane(
  layout: ConversationPaneLayout,
  paneId: string,
): ConversationPaneLayout {
  if (findConversationPaneLeaf(layout.root, paneId) === null || layout.activePaneId === paneId) {
    return layout;
  }
  return { ...layout, activePaneId: paneId };
}

export function bindConversationPaneSession(
  layout: ConversationPaneLayout,
  paneId: string,
  sessionId: string | null,
): ConversationPaneLayout {
  if (findConversationPaneLeaf(layout.root, paneId) === null) {
    return layout;
  }
  if (sessionId !== null) {
    const existing = listConversationPaneLeaves(layout.root).find(
      (leaf) => leaf.sessionId === sessionId,
    );
    if (existing && existing.paneId !== paneId) {
      return focusConversationPane(layout, existing.paneId);
    }
  }
  const root = mapPaneNode(layout.root, paneId, (leaf) => ({ ...leaf, sessionId }));
  return root === layout.root ? layout : { ...layout, root, activePaneId: paneId };
}

export function replacePrimaryConversationSession(
  layout: ConversationPaneLayout,
  sessionId: string | null,
): ConversationPaneLayout {
  const primary = findConversationPaneLeaf(layout.root, PRIMARY_CONVERSATION_PANE_ID);
  if (primary?.sessionId === sessionId) {
    return layout;
  }
  const duplicate =
    sessionId === null
      ? null
      : listConversationPaneLeaves(layout.root).find(
          (leaf) => leaf.paneId !== PRIMARY_CONVERSATION_PANE_ID && leaf.sessionId === sessionId,
        );
  let root = layout.root;
  if (duplicate) {
    root = mapPaneNode(root, duplicate.paneId, (leaf) => ({ ...leaf, sessionId: null }));
  }
  root = mapPaneNode(root, PRIMARY_CONVERSATION_PANE_ID, (leaf) => ({ ...leaf, sessionId }));
  return { ...layout, root };
}

export function splitConversationPane(
  layout: ConversationPaneLayout,
  paneId: string,
  orientation: ConversationPaneOrientation,
  createId: ConversationPaneIdFactory,
): ConversationPaneLayout {
  if (listConversationPaneLeaves(layout.root).length >= CONVERSATION_PANE_MAX_COUNT) {
    return layout;
  }
  if (findConversationPaneLeaf(layout.root, paneId) === null) {
    return layout;
  }
  const nextPaneId = createId('pane');
  const root = mapPaneNode(layout.root, paneId, (leaf) => ({
    kind: 'split',
    splitId: createId('split'),
    orientation,
    ratio: 0.5,
    first: leaf,
    second: { kind: 'leaf', paneId: nextPaneId, sessionId: null },
  }));
  return { ...layout, root, activePaneId: nextPaneId, maximizedPaneId: null };
}

function removeConversationPaneLeaf(
  node: ConversationPaneNode,
  paneId: string,
): ConversationPaneNode | null {
  if (node.kind === 'leaf') {
    return node.paneId === paneId ? null : node;
  }
  const first = removeConversationPaneLeaf(node.first, paneId);
  const second = removeConversationPaneLeaf(node.second, paneId);
  if (first === null) return second;
  if (second === null) return first;
  if (first === node.first && second === node.second) return node;
  return { ...node, first, second };
}

export function closeConversationPane(
  layout: ConversationPaneLayout,
  paneId: string,
): ConversationPaneLayout {
  if (
    paneId === PRIMARY_CONVERSATION_PANE_ID ||
    findConversationPaneLeaf(layout.root, paneId) === null
  ) {
    return layout;
  }
  const previousLeaves = listConversationPaneLeaves(layout.root);
  const removedIndex = previousLeaves.findIndex((leaf) => leaf.paneId === paneId);
  const root = removeConversationPaneLeaf(layout.root, paneId);
  if (root === null) {
    return layout;
  }
  const nextLeaves = listConversationPaneLeaves(root);
  const fallback = nextLeaves[Math.min(Math.max(removedIndex - 1, 0), nextLeaves.length - 1)];
  const activePaneId =
    layout.activePaneId === paneId
      ? (fallback?.paneId ?? PRIMARY_CONVERSATION_PANE_ID)
      : layout.activePaneId;
  return {
    ...layout,
    root,
    activePaneId,
    maximizedPaneId: layout.maximizedPaneId === paneId ? null : layout.maximizedPaneId,
  };
}

function buildBalancedPaneTree(
  leaves: ConversationPaneLeaf[],
  orientation: ConversationPaneOrientation,
  createId: ConversationPaneIdFactory,
): ConversationPaneNode {
  const firstLeaf = leaves[0];
  if (leaves.length === 1 && firstLeaf) {
    return firstLeaf;
  }
  const middle = Math.ceil(leaves.length / 2);
  const alternate: ConversationPaneOrientation = orientation === 'row' ? 'column' : 'row';
  return {
    kind: 'split',
    splitId: createId('split'),
    orientation,
    ratio: 0.5,
    first: buildBalancedPaneTree(leaves.slice(0, middle), alternate, createId),
    second: buildBalancedPaneTree(leaves.slice(middle), alternate, createId),
  };
}

export function applyConversationPanePreset(
  layout: ConversationPaneLayout,
  count: ConversationPanePreset,
  createId: ConversationPaneIdFactory,
): ConversationPaneLayout {
  const current = listConversationPaneLeaves(layout.root);
  const primary = current.find((leaf) => leaf.paneId === PRIMARY_CONVERSATION_PANE_ID);
  if (!primary) {
    return createConversationPaneLayout();
  }
  const ordered = [primary, ...current.filter((leaf) => leaf.paneId !== primary.paneId)];
  const leaves = ordered.slice(0, count);
  while (leaves.length < count) {
    leaves.push({ kind: 'leaf', paneId: createId('pane'), sessionId: null });
  }
  const root = buildBalancedPaneTree(leaves, 'row', createId);
  const retainedPaneIds = new Set(leaves.map((leaf) => leaf.paneId));
  return {
    ...layout,
    root,
    activePaneId: retainedPaneIds.has(layout.activePaneId)
      ? layout.activePaneId
      : PRIMARY_CONVERSATION_PANE_ID,
    maximizedPaneId:
      layout.maximizedPaneId !== null && retainedPaneIds.has(layout.maximizedPaneId)
        ? layout.maximizedPaneId
        : null,
  };
}

export function setConversationPaneSplitRatio(
  layout: ConversationPaneLayout,
  splitId: string,
  ratio: number,
): ConversationPaneLayout {
  function update(node: ConversationPaneNode): ConversationPaneNode {
    if (node.kind === 'leaf') return node;
    if (node.splitId === splitId) {
      const nextRatio = clampConversationPaneRatio(ratio);
      return nextRatio === node.ratio ? node : { ...node, ratio: nextRatio };
    }
    const first = update(node.first);
    const second = update(node.second);
    return first === node.first && second === node.second ? node : { ...node, first, second };
  }
  const root = update(layout.root);
  return root === layout.root ? layout : { ...layout, root };
}

export function toggleMaximizedConversationPane(
  layout: ConversationPaneLayout,
  paneId: string = layout.activePaneId,
): ConversationPaneLayout {
  if (findConversationPaneLeaf(layout.root, paneId) === null) return layout;
  return {
    ...layout,
    activePaneId: paneId,
    maximizedPaneId: layout.maximizedPaneId === paneId ? null : paneId,
  };
}
