import { memo, type DragEvent, type ReactElement } from 'react';
import type { GitFileStatusCode } from '@piwin/contracts';
import { FileTypeIcon, Notice } from '@piwin/ui-kit';
import { IconChevronDown, IconChevronRight } from './shell-icons';
import { gitStatusForPath, type FileTreeNodeState } from './file-tree-model';
import type { DesktopLocale } from './desktop-locale';
import { ContextMenuFromCatalog, type ContextMenuDispatchers } from './context-menu';
import { prewarmFileHighlight } from './syntax/file-highlight.js';
import { isEventHandlerPropName, memoWithLatestCallbacks } from './memo-with-latest-callbacks';

/** Single-letter glyph for a git file status code (VS Code SCM style). */
const GIT_STATUS_LETTER: Record<GitFileStatusCode, string> = {
  modified: 'M',
  added: 'A',
  untracked: 'U',
  deleted: 'D',
  conflicted: 'C',
  renamed: 'R',
  copied: 'R',
  typechange: 'T',
  unknown: '?',
};

function gitStatusToneClass(status: GitFileStatusCode): string {
  const letter = GIT_STATUS_LETTER[status];
  if (letter === 'M') return 'm';
  if (letter === 'A' || letter === 'U') return 'a';
  if (letter === 'D' || letter === 'C') return 'd';
  if (letter === 'R') return 'r';
  return '';
}

export type FileTreeNodeViewProps = {
  node: FileTreeNodeState;
  depth: number;
  selectedPath: string | null;
  gitStatusMap: Map<string, GitFileStatusCode>;
  projectPath: string | null;
  onSelectFile: (path: string) => void;
  onSelectPath: (path: string) => void;
  onToggle: (path: string) => void;
  onDragStart: (event: DragEvent, relativePath: string) => void;
  absoluteFor: (relativePath: string) => string;
  contextMenuCaps: {
    hasProject: boolean;
    canReveal: boolean;
    sideChatAvailable: boolean;
    applyAvailable: boolean;
    canSendPreset: boolean;
    locale: DesktopLocale;
  };
  contextMenuDispatchers: ContextMenuDispatchers;
  enableContextMenu: boolean;
  /**
   * Set by the virtual list: the row is one of a flat, absolutely placed run,
   * so it draws no children and reports its own height.
   */
  virtualIndex?: number | undefined;
  virtualStart?: number | undefined;
  measureRef?: ((element: HTMLLIElement | null) => void) | undefined;
};

/** Whether `selectedPath` is this row or a row somewhere beneath it. */
function selectionTouchesNode(selectedPath: string | null, node: FileTreeNodeState): boolean {
  if (selectedPath === null) return false;
  const nodePath = node.entry.relativePath;
  if (selectedPath === nodePath) return true;
  if (node.entry.kind !== 'directory' || !selectedPath.startsWith(nodePath)) return false;
  const separator = selectedPath[nodePath.length];
  return separator === '/' || separator === '\\';
}

/**
 * Every row is handed the tree-wide selection, but only the rows on the path
 * to the old and new selection draw it; the rest of the tree sits out a
 * selection change. All other props compare by identity.
 */
export function areFileTreeNodePropsEqual(
  previous: FileTreeNodeViewProps,
  next: FileTreeNodeViewProps,
): boolean {
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]) as Set<
    keyof FileTreeNodeViewProps
  >;
  for (const key of keys) {
    if (Object.is(previous[key], next[key])) continue;
    if (key !== 'selectedPath') return false;
    if (
      selectionTouchesNode(previous.selectedPath, previous.node) ||
      selectionTouchesNode(next.selectedPath, next.node)
    ) {
      return false;
    }
  }
  return true;
}

export const FileTreeNodeView = memo(function FileTreeNodeView(
  props: FileTreeNodeViewProps,
): ReactElement {
  const { node, depth } = props;
  const isDir = node.entry.kind === 'directory';
  const selected = props.selectedPath === node.entry.relativePath;
  const status = gitStatusForPath(props.gitStatusMap, node.entry.relativePath, node.entry.kind);
  const absolutePath = props.absoluteFor(node.entry.relativePath);
  const isVirtual = props.virtualIndex !== undefined;
  const rowButton = (
    <button
      type="button"
      className={`file-tree-row ${isDir ? 'is-dir' : 'is-file'}`}
      style={{ paddingLeft: 8 + depth * 14 }}
      draggable={!isDir}
      onPointerEnter={() => {
        // Compile the grammar while the pointer travels toward a click.
        if (!isDir) prewarmFileHighlight(node.entry.relativePath);
      }}
      onDragStart={(event) => {
        if (!isDir) props.onDragStart(event, node.entry.relativePath);
      }}
      onClick={() => {
        if (isDir) {
          props.onToggle(node.entry.relativePath);
        } else {
          props.onSelectFile(node.entry.relativePath);
        }
      }}
      onContextMenu={() => {
        props.onSelectPath(node.entry.relativePath);
        if (!isDir) {
          props.onSelectFile(node.entry.relativePath);
        }
      }}
      title={node.entry.relativePath}
    >
      {isDir ? (
        <span className="file-tree-twist" aria-hidden>
          {node.expanded ? (
            <IconChevronDown width={12} height={12} />
          ) : (
            <IconChevronRight width={12} height={12} />
          )}
        </span>
      ) : (
        <span className="file-tree-icon" aria-hidden>
          <FileTypeIcon filePathOrExt={node.entry.name} />
        </span>
      )}
      <span className="file-tree-name">{node.entry.name}</span>
      {status ? (
        <span
          className={`file-tree-git file-tree-git--${status} gs ${gitStatusToneClass(status)}`.trim()}
          data-testid={`file-tree-git-${node.entry.relativePath}`}
          title={status}
        >
          {GIT_STATUS_LETTER[status]}
        </span>
      ) : null}
    </button>
  );

  const row =
    props.enableContextMenu && props.projectPath ? (
      <ContextMenuFromCatalog
        testId={`file-tree-context-${node.entry.relativePath}`}
        target={{
          surface: isDir ? 'file-tree-folder' : 'file-tree-file',
          projectPath: props.projectPath,
          relativePath: node.entry.relativePath,
          absolutePath,
          label: node.entry.name,
        }}
        caps={props.contextMenuCaps}
        dispatchers={props.contextMenuDispatchers}
      >
        {rowButton}
      </ContextMenuFromCatalog>
    ) : (
      rowButton
    );

  return (
    <li
      role="treeitem"
      aria-expanded={isDir ? node.expanded : undefined}
      // Nesting carries the level in the recursive tree; a flat run states it.
      aria-level={isVirtual ? depth + 1 : undefined}
      className={`file-tree-node${selected ? ' selected' : ''}${isVirtual ? ' is-virtual' : ''}`}
      data-index={props.virtualIndex}
      ref={props.measureRef}
      style={isVirtual ? { transform: `translateY(${props.virtualStart ?? 0}px)` } : undefined}
    >
      {row}
      {node.loading ? (
        <div className="file-tree-nested muted" style={{ paddingLeft: 24 + depth * 14 }}>
          Loading…
        </div>
      ) : null}
      {node.error ? (
        <div className="file-tree-nested" style={{ paddingLeft: 24 + depth * 14 }}>
          <Notice tone="error">{node.error}</Notice>
        </div>
      ) : null}
      {!isVirtual && isDir && node.expanded && node.children ? (
        <ul role="group" className="file-tree-children">
          {node.children.map((child) => (
            <FileTreeNodeView
              key={child.entry.relativePath}
              node={child}
              depth={depth + 1}
              selectedPath={props.selectedPath}
              gitStatusMap={props.gitStatusMap}
              projectPath={props.projectPath}
              onSelectFile={props.onSelectFile}
              onSelectPath={props.onSelectPath}
              onToggle={props.onToggle}
              onDragStart={props.onDragStart}
              absoluteFor={props.absoluteFor}
              contextMenuCaps={props.contextMenuCaps}
              contextMenuDispatchers={props.contextMenuDispatchers}
              enableContextMenu={props.enableContextMenu}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}, areFileTreeNodePropsEqual);

export type FileTreeNodeListProps = Omit<FileTreeNodeViewProps, 'node' | 'depth'> & {
  nodes: readonly FileTreeNodeState[];
};

/**
 * Root rows behind one memo boundary: the panel's `on*` handlers are rebuilt
 * on every render, so they reach the rows as stable proxies. `absoluteFor`
 * runs during render and keeps its own identity.
 */
export const FileTreeNodeList = memoWithLatestCallbacks(
  function FileTreeNodeList(props: FileTreeNodeListProps): ReactElement {
    const { nodes, ...rowProps } = props;
    return (
      <>
        {nodes.map((node) => (
          <FileTreeNodeView key={node.entry.relativePath} node={node} depth={0} {...rowProps} />
        ))}
      </>
    );
  },
  { isHandler: isEventHandlerPropName },
);
