import type { DragEvent, ReactElement } from 'react';
import type { GitFileStatusCode } from '@piwin/contracts';
import { FileTypeIcon, Notice } from '@piwin/ui-kit';
import { IconChevronDown, IconChevronRight } from './shell-icons';
import { gitStatusForPath, type FileTreeNodeState } from './file-tree-model';
import type { DesktopLocale } from './desktop-locale';
import { ContextMenuFromCatalog, type ContextMenuDispatchers } from './context-menu';

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
    locale: DesktopLocale;
  };
  contextMenuDispatchers: ContextMenuDispatchers;
  enableContextMenu: boolean;
};

export function FileTreeNodeView(props: FileTreeNodeViewProps): ReactElement {
  const { node, depth } = props;
  const isDir = node.entry.kind === 'directory';
  const selected = props.selectedPath === node.entry.relativePath;
  const status = gitStatusForPath(props.gitStatusMap, node.entry.relativePath, node.entry.kind);
  const absolutePath = props.absoluteFor(node.entry.relativePath);
  const rowButton = (
    <button
      type="button"
      className={`file-tree-row ${isDir ? 'is-dir' : 'is-file'}`}
      style={{ paddingLeft: 8 + depth * 14 }}
      draggable={!isDir}
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
          className={`file-tree-git file-tree-git--${status}`}
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
      className={`file-tree-node${selected ? ' selected' : ''}`}
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
      {isDir && node.expanded && node.children ? (
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
}
