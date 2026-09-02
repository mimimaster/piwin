export const CONVERSATION_PANE_LAYOUT_VERSION = 1 as const;
export const CONVERSATION_PANE_MAX_COUNT = 8;
export const CONVERSATION_PANE_MIN_WIDTH = 300;
export const CONVERSATION_PANE_MIN_HEIGHT = 220;
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

export type ConversationPaneSize = {
  width: number;
  height: number;
};

export type ConversationPaneRatioBounds = {
  min: number;
  max: number;
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

export function getConversationPaneMinimumSize(node: ConversationPaneNode): ConversationPaneSize {
  if (node.kind === 'leaf') {
    return { width: CONVERSATION_PANE_MIN_WIDTH, height: CONVERSATION_PANE_MIN_HEIGHT };
  }
  const first = getConversationPaneMinimumSize(node.first);
  const second = getConversationPaneMinimumSize(node.second);
  return node.orientation === 'row'
    ? {
        width: first.width + second.width,
        height: Math.max(first.height, second.height),
      }
    : {
        width: Math.max(first.width, second.width),
        height: first.height + second.height,
      };
}

export function getConversationPaneSplitRatioBounds(input: {
  orientation: ConversationPaneOrientation;
  availableSize: ConversationPaneSize;
  firstMinimumSize: ConversationPaneSize;
  secondMinimumSize: ConversationPaneSize;
}): ConversationPaneRatioBounds {
  const available =
    input.orientation === 'row' ? input.availableSize.width : input.availableSize.height;
  const firstMinimum =
    input.orientation === 'row' ? input.firstMinimumSize.width : input.firstMinimumSize.height;
  const secondMinimum =
    input.orientation === 'row' ? input.secondMinimumSize.width : input.secondMinimumSize.height;
  if (!Number.isFinite(available) || available <= 0) {
    return { min: CONVERSATION_PANE_MIN_RATIO, max: CONVERSATION_PANE_MAX_RATIO };
  }

  const minimumRatio = Math.max(CONVERSATION_PANE_MIN_RATIO, firstMinimum / available);
  const maximumRatio = Math.min(CONVERSATION_PANE_MAX_RATIO, 1 - secondMinimum / available);
  if (minimumRatio <= maximumRatio) {
    return { min: minimumRatio, max: maximumRatio };
  }

  // The stage itself is smaller than the requested minimum for this subtree.
  // Keep both branches proportional so neither side collapses completely; the
  // next resize will reopen the normal pixel-based range automatically.
  const totalMinimum = firstMinimum + secondMinimum;
  const proportionalRatio = totalMinimum > 0 ? firstMinimum / totalMinimum : 0.5;
  return { min: proportionalRatio, max: proportionalRatio };
}

export function clampConversationPaneRatioToBounds(
  ratio: number,
  bounds: ConversationPaneRatioBounds,
): number {
  const candidate = Number.isFinite(ratio) ? ratio : 0.5;
  return Math.min(bounds.max, Math.max(bounds.min, candidate));
}

function constrainConversationPaneNode(
  node: ConversationPaneNode,
  availableSize: ConversationPaneSize,
): ConversationPaneNode {
  if (node.kind === 'leaf') {
    return node;
  }
  const firstMinimumSize = getConversationPaneMinimumSize(node.first);
  const secondMinimumSize = getConversationPaneMinimumSize(node.second);
  const bounds = getConversationPaneSplitRatioBounds({
    orientation: node.orientation,
    availableSize,
    firstMinimumSize,
    secondMinimumSize,
  });
  const ratio = clampConversationPaneRatioToBounds(node.ratio, bounds);
  const firstSize =
    node.orientation === 'row'
      ? { width: availableSize.width * ratio, height: availableSize.height }
      : { width: availableSize.width, height: availableSize.height * ratio };
  const secondSize =
    node.orientation === 'row'
      ? { width: availableSize.width * (1 - ratio), height: availableSize.height }
      : { width: availableSize.width, height: availableSize.height * (1 - ratio) };
  const first = constrainConversationPaneNode(node.first, firstSize);
  const second = constrainConversationPaneNode(node.second, secondSize);
  if (ratio === node.ratio && first === node.first && second === node.second) {
    return node;
  }
  return { ...node, ratio, first, second };
}

export function constrainConversationPaneLayout(
  layout: ConversationPaneLayout,
  availableSize: ConversationPaneSize,
): ConversationPaneLayout {
  if (
    !Number.isFinite(availableSize.width) ||
    !Number.isFinite(availableSize.height) ||
    availableSize.width <= 0 ||
    availableSize.height <= 0
  ) {
    return layout;
  }
  const root = constrainConversationPaneNode(layout.root, availableSize);
  return root === layout.root ? layout : { ...layout, root };
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

/**
 * Session Live should target from the focused leaf:
 * - focused leaf with `sessionId` → that id
 * - focused PRIMARY leaf with no session → `primarySessionId`
 * - focused empty secondary leaf → `null` (S-keep: do not fall back to primary)
 */
export function resolveFocusedConversationSessionId(input: {
  layout: ConversationPaneLayout;
  primarySessionId: string | null;
}): string | null {
  const leaf = findConversationPaneLeaf(input.layout.root, input.layout.activePaneId);
  if (leaf?.sessionId) return leaf.sessionId;
  if (leaf?.paneId === PRIMARY_CONVERSATION_PANE_ID) return input.primarySessionId;
  return null;
}
