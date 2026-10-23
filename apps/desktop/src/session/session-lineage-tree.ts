import type {
  ProductSessionLineageNode,
  ProductSessionLineageView,
  ProductSessionOrigin,
} from '@piwin/contracts';

export type SessionLineageTreeNode = ProductSessionLineageNode & {
  isMissingRoot?: boolean;
  children: SessionLineageTreeNode[];
};

export type SessionLineageTree = {
  root: SessionLineageTreeNode | null;
  detached: SessionLineageTreeNode[];
};

function compareLineageNodes(
  left: ProductSessionLineageNode,
  right: ProductSessionLineageNode,
): number {
  return (
    right.updatedAt.localeCompare(left.updatedAt) ||
    left.sessionId.localeCompare(right.sessionId)
  );
}

function createTreeNode(node: ProductSessionLineageNode): SessionLineageTreeNode {
  return {
    ...node,
    children: [],
  };
}

function createMissingRootNode(view: ProductSessionLineageView): SessionLineageTreeNode {
  return {
    sessionId: view.rootSessionId,
    isArchived: false,
    updatedAt: '',
    isMissingRoot: true,
    children: [],
  };
}

function getForkParentId(origin: ProductSessionOrigin | undefined): string | undefined {
  return origin?.kind === 'fork' ? origin.sourceSessionId : undefined;
}

/**
 * Convert the Host's flat lineage projection into a navigable rooted tree.
 * Malformed or orphaned nodes are kept in `detached` instead of disappearing.
 */
export function buildSessionLineageTree(view: ProductSessionLineageView): SessionLineageTree {
  const nodesById = new Map<string, SessionLineageTreeNode>();
  for (const node of view.nodes) {
    nodesById.set(node.sessionId, createTreeNode(node));
  }

  const root =
    nodesById.get(view.rootSessionId) ??
    (view.rootMissing ? createMissingRootNode(view) : null);
  if (root && !nodesById.has(root.sessionId)) {
    nodesById.set(root.sessionId, root);
  }

  const childrenByParent = new Map<string, string[]>();
  for (const node of view.nodes) {
    const parentId = getForkParentId(node.origin);
    if (!parentId || parentId === node.sessionId || !nodesById.has(parentId)) {
      continue;
    }
    const childIds = childrenByParent.get(parentId) ?? [];
    childIds.push(node.sessionId);
    childrenByParent.set(parentId, childIds);
  }
  for (const childIds of childrenByParent.values()) {
    childIds.sort((leftId, rightId) => {
      const left = nodesById.get(leftId);
      const right = nodesById.get(rightId);
      if (!left || !right) return left ? -1 : right ? 1 : 0;
      return compareLineageNodes(left, right);
    });
  }

  const attachedIds = new Set<string>();
  function attachChildren(node: SessionLineageTreeNode, ancestors: Set<string>): void {
    if (ancestors.has(node.sessionId)) return;
    attachedIds.add(node.sessionId);
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(node.sessionId);
    const childIds = childrenByParent.get(node.sessionId) ?? [];
    for (const childId of childIds) {
      const child = nodesById.get(childId);
      if (!child || nextAncestors.has(child.sessionId)) continue;
      node.children.push(child);
      attachChildren(child, nextAncestors);
    }
  }

  if (root) {
    attachChildren(root, new Set<string>());
  }

  const detached = [...nodesById.values()]
    .filter((node) => !attachedIds.has(node.sessionId) && !node.isMissingRoot)
    .sort(compareLineageNodes);
  return { root, detached };
}

/**
 * Count direct forks by source assistant message for the active session.
 * The source message IDs are product-transcript IDs, so they can be matched
 * directly against the current ChatThread rows.
 */
export function getDirectForkCountsByMessageId(
  view: ProductSessionLineageView | null,
): Record<string, number> {
  if (!view) return {};
  const counts: Record<string, number> = {};
  for (const node of view.nodes) {
    const origin = node.origin;
    if (origin?.kind !== 'fork' || origin.sourceSessionId !== view.activeSessionId) {
      continue;
    }
    counts[origin.sourceMessageId] = (counts[origin.sourceMessageId] ?? 0) + 1;
  }
  return counts;
}
