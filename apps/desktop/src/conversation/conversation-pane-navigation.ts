import {
  focusConversationPane,
  listConversationPaneLeaves,
  setConversationPaneSplitRatio,
  type ConversationPaneDirection,
  type ConversationPaneLayout,
  type ConversationPaneNode,
  type ConversationPaneOrientation,
  type ConversationPaneRect,
} from './conversation-pane-layout.js';

export function listConversationPaneRects(
  node: ConversationPaneNode,
  rect: Omit<ConversationPaneRect, 'paneId'> = { left: 0, top: 0, width: 1, height: 1 },
): ConversationPaneRect[] {
  if (node.kind === 'leaf') {
    return [{ paneId: node.paneId, ...rect }];
  }
  if (node.orientation === 'row') {
    const firstWidth = rect.width * node.ratio;
    return [
      ...listConversationPaneRects(node.first, { ...rect, width: firstWidth }),
      ...listConversationPaneRects(node.second, {
        ...rect,
        left: rect.left + firstWidth,
        width: rect.width - firstWidth,
      }),
    ];
  }
  const firstHeight = rect.height * node.ratio;
  return [
    ...listConversationPaneRects(node.first, { ...rect, height: firstHeight }),
    ...listConversationPaneRects(node.second, {
      ...rect,
      top: rect.top + firstHeight,
      height: rect.height - firstHeight,
    }),
  ];
}

export function focusConversationPaneDirection(
  layout: ConversationPaneLayout,
  direction: ConversationPaneDirection,
): ConversationPaneLayout {
  const rectangles = listConversationPaneRects(layout.root);
  const current = rectangles.find((rect) => rect.paneId === layout.activePaneId);
  if (!current) return layout;
  const currentX = current.left + current.width / 2;
  const currentY = current.top + current.height / 2;
  const candidates = rectangles.flatMap((rect) => {
    if (rect.paneId === current.paneId) return [];
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const primaryDistance =
      direction === 'left'
        ? currentX - centerX
        : direction === 'right'
          ? centerX - currentX
          : direction === 'up'
            ? currentY - centerY
            : centerY - currentY;
    if (primaryDistance <= 0) return [];
    const crossDistance =
      direction === 'left' || direction === 'right'
        ? Math.abs(centerY - currentY)
        : Math.abs(centerX - currentX);
    return [{ paneId: rect.paneId, score: primaryDistance * 10 + crossDistance }];
  });
  candidates.sort((left, right) => left.score - right.score);
  const next = candidates[0];
  return next ? focusConversationPane(layout, next.paneId) : layout;
}

export function focusAdjacentConversationPane(
  layout: ConversationPaneLayout,
  offset: -1 | 1,
): ConversationPaneLayout {
  const leaves = listConversationPaneLeaves(layout.root);
  const currentIndex = leaves.findIndex((leaf) => leaf.paneId === layout.activePaneId);
  if (currentIndex < 0 || leaves.length < 2) return layout;
  const nextIndex = (currentIndex + offset + leaves.length) % leaves.length;
  const next = leaves[nextIndex];
  return next ? focusConversationPane(layout, next.paneId) : layout;
}

type ConversationPaneAncestor = {
  splitId: string;
  orientation: ConversationPaneOrientation;
  side: 'first' | 'second';
  ratio: number;
};

function findConversationPanePath(
  node: ConversationPaneNode,
  paneId: string,
  path: ConversationPaneAncestor[],
): ConversationPaneAncestor[] | null {
  if (node.kind === 'leaf') return node.paneId === paneId ? path : null;
  const ancestor = {
    splitId: node.splitId,
    orientation: node.orientation,
    ratio: node.ratio,
  };
  return (
    findConversationPanePath(node.first, paneId, [...path, { ...ancestor, side: 'first' }]) ??
    findConversationPanePath(node.second, paneId, [...path, { ...ancestor, side: 'second' }])
  );
}

export function resizeFocusedConversationPane(
  layout: ConversationPaneLayout,
  direction: ConversationPaneDirection,
  step = 0.05,
): ConversationPaneLayout {
  const path = findConversationPanePath(layout.root, layout.activePaneId, []);
  if (!path) return layout;
  const target = [...path]
    .reverse()
    .find((ancestor) =>
      direction === 'right'
        ? ancestor.orientation === 'row' && ancestor.side === 'first'
        : direction === 'left'
          ? ancestor.orientation === 'row' && ancestor.side === 'second'
          : direction === 'down'
            ? ancestor.orientation === 'column' && ancestor.side === 'first'
            : ancestor.orientation === 'column' && ancestor.side === 'second',
    );
  if (!target) return layout;
  const delta = direction === 'left' || direction === 'up' ? -Math.abs(step) : Math.abs(step);
  return setConversationPaneSplitRatio(layout, target.splitId, target.ratio + delta);
}
