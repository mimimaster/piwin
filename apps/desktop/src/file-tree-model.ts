/**
 * Pure helpers for the workspace file tree (filter, flatten, keyboard, git map).
 * No React / DOM / host I/O.
 */
import type { GitChangedFile, GitFileStatusCode, ProjectDirEntry } from '@piwin/contracts';

export type FileTreeNodeState = {
  entry: ProjectDirEntry;
  expanded: boolean;
  loading: boolean;
  children: FileTreeNodeState[] | null;
  error: string | null;
};

export type FlatTreeRow = {
  relativePath: string;
  depth: number;
  kind: 'file' | 'directory';
  name: string;
  expanded?: boolean;
  loading?: boolean;
};

export type KeyboardMoveResult = {
  nextPath: string;
  expandPath?: string;
  collapsePath?: string;
  activatePath?: string;
};

export function buildGitStatusByPath(
  files: readonly GitChangedFile[],
): Map<string, GitFileStatusCode> {
  const map = new Map<string, GitFileStatusCode>();
  for (const file of files) {
    map.set(file.path.replace(/\\/g, '/'), file.status);
    if (file.previousPath) {
      map.set(file.previousPath.replace(/\\/g, '/'), file.status);
    }
  }
  return map;
}

/** Directory status: strongest dirty signal among descendants (for optional folder tint). */
export function gitStatusForPath(
  map: Map<string, GitFileStatusCode>,
  relativePath: string,
  kind: 'file' | 'directory',
): GitFileStatusCode | null {
  const key = relativePath.replace(/\\/g, '/');
  if (kind === 'file') {
    return map.get(key) ?? null;
  }
  // Folder: any changed path under prefix
  const prefix = key === '' ? '' : `${key}/`;
  let found: GitFileStatusCode | null = null;
  for (const [path, status] of map) {
    if (path === key || (prefix && path.startsWith(prefix))) {
      if (status === 'conflicted') return 'conflicted';
      if (status === 'modified' || status === 'added' || status === 'untracked') {
        found = status;
      } else if (!found) {
        found = status;
      }
    }
  }
  return found;
}

export function filterTreeNodes(
  nodes: FileTreeNodeState[],
  query: string,
): FileTreeNodeState[] {
  const q = query.trim().toLowerCase();
  if (!q) return nodes;

  function filterNode(node: FileTreeNodeState): FileTreeNodeState | null {
    const nameHit = node.entry.name.toLowerCase().includes(q);
    const pathHit = node.entry.relativePath.toLowerCase().includes(q);
    if (node.entry.kind === 'file') {
      return nameHit || pathHit ? node : null;
    }
    const childSource = node.children ?? [];
    const filteredChildren = childSource
      .map(filterNode)
      .filter((n): n is FileTreeNodeState => n !== null);
    if (nameHit || pathHit || filteredChildren.length > 0) {
      return {
        ...node,
        expanded: true,
        children: node.children === null && filteredChildren.length === 0 ? null : filteredChildren,
      };
    }
    return null;
  }

  return nodes.map(filterNode).filter((n): n is FileTreeNodeState => n !== null);
}

export function flattenVisibleRows(
  nodes: FileTreeNodeState[],
  depth = 0,
): FlatTreeRow[] {
  const rows: FlatTreeRow[] = [];
  for (const node of nodes) {
    rows.push({
      relativePath: node.entry.relativePath,
      depth,
      kind: node.entry.kind,
      name: node.entry.name,
      ...(node.entry.kind === 'directory'
        ? { expanded: node.expanded, loading: node.loading }
        : {}),
    });
    if (node.entry.kind === 'directory' && node.expanded && node.children) {
      rows.push(...flattenVisibleRows(node.children, depth + 1));
    }
  }
  return rows;
}

export function keyboardMove(
  rows: readonly FlatTreeRow[],
  selectedPath: string | null,
  key: string,
): KeyboardMoveResult | null {
  if (rows.length === 0) return null;
  const index = selectedPath
    ? rows.findIndex((r) => r.relativePath === selectedPath)
    : -1;

  if (key === 'Home') {
    const first = rows[0];
    return first ? { nextPath: first.relativePath } : null;
  }
  if (key === 'End') {
    const last = rows[rows.length - 1];
    return last ? { nextPath: last.relativePath } : null;
  }

  if (key === 'ArrowDown') {
    const next = rows[Math.min(index + 1, rows.length - 1)] ?? rows[0];
    return next ? { nextPath: next.relativePath } : null;
  }
  if (key === 'ArrowUp') {
    const next = rows[Math.max(index - 1, 0)] ?? rows[0];
    return next ? { nextPath: next.relativePath } : null;
  }

  const current = index >= 0 ? rows[index] : null;
  if (!current) {
    const first = rows[0];
    return first ? { nextPath: first.relativePath } : null;
  }

  if (key === 'ArrowRight') {
    if (current.kind === 'directory' && !current.expanded) {
      return { nextPath: current.relativePath, expandPath: current.relativePath };
    }
    const next = rows[index + 1];
    return next ? { nextPath: next.relativePath } : { nextPath: current.relativePath };
  }

  if (key === 'ArrowLeft') {
    if (current.kind === 'directory' && current.expanded) {
      return { nextPath: current.relativePath, collapsePath: current.relativePath };
    }
    // Move to parent: nearest previous row with smaller depth
    for (let i = index - 1; i >= 0; i--) {
      const row = rows[i];
      if (row && row.depth < current.depth) {
        return { nextPath: row.relativePath };
      }
    }
    return { nextPath: current.relativePath };
  }

  if (key === 'Enter') {
    if (current.kind === 'directory') {
      return current.expanded
        ? { nextPath: current.relativePath, collapsePath: current.relativePath }
        : { nextPath: current.relativePath, expandPath: current.relativePath };
    }
    return { nextPath: current.relativePath, activatePath: current.relativePath };
  }

  return null;
}
