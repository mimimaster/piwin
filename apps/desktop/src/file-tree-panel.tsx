/**
 * Workspace file tree (right inspector Files tab).
 * Lazy-loads children via host project/list-dir.
 * File click → opens document preview via onOpenFile; drag / Insert path → composer.
 */
import {
  useCallback,
  useEffect,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import type {
  GitFileStatusCode,
  GitStatusData,
  HostResponse,
  ProjectDirEntry,
  ProjectListDirData,
} from '@piwin/contracts';
import { Button, EmptyState, IconButton, Notice, Spinner } from '@piwin/ui-kit';
import { IconChevronDown, IconChevronRight, IconRefresh } from './shell-icons';
import { FileTypeIcon } from './file-type-icon';
import {
  buildGitStatusByPath,
  filterTreeNodes,
  flattenVisibleRows,
  gitStatusForPath,
  keyboardMove,
  type FileTreeNodeState,
} from './file-tree-model';
import type { DesktopLocale } from './desktop-locale';

export type FileTreeRequest =
  | {
      type: 'project/list-dir';
      projectPath: string;
      relativePath?: string;
    }
  | {
      type: 'project/read-file';
      projectPath: string;
      relativePath: string;
      maxBytes?: number;
    }
  | {
      type: 'git/status';
      projectPath: string;
    };

export type FileTreePanelProps = {
  projectPath: string | null;
  request: (command: FileTreeRequest) => Promise<HostResponse>;
  /** Insert absolute/relative path into composer (text models). */
  onInsertPath?: (absolutePath: string, relativePath: string) => void;
  /** Open file in DocPreview (App handleOpenDocument). */
  onOpenFile?: (absolutePath: string, relativePath: string) => void;
  /** Desktop locale for locale-aware UI strings. */
  locale?: DesktopLocale;
};

function entryToNode(entry: ProjectDirEntry): FileTreeNodeState {
  return {
    entry,
    expanded: false,
    loading: false,
    children: entry.kind === 'directory' ? null : [],
    error: null,
  };
}

export const PIWIN_PATH_MIME = 'application/x-piwin-workspace-path';

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

export function FileTreePanel(props: FileTreePanelProps): ReactElement {
  const [rootNodes, setRootNodes] = useState<FileTreeNodeState[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [filterQuery, setFilterQuery] = useState('');
  const [gitStatusMap, setGitStatusMap] = useState<Map<string, GitFileStatusCode>>(() => new Map());

  const loadDirectory = useCallback(
    async (relativePath: string): Promise<ProjectDirEntry[]> => {
      if (!props.projectPath) return [];
      const response = await props.request({
        type: 'project/list-dir',
        projectPath: props.projectPath,
        ...(relativePath ? { relativePath } : {}),
      });
      if (!response.success) {
        throw new Error(response.error);
      }
      const data = response.data as ProjectListDirData;
      return data.entries ?? [];
    },
    [props],
  );

  // Fetch git status for the workspace. Failures (e.g. not a git repo) are
  // swallowed silently — the tree simply renders without status badges.
  const loadGitStatus = useCallback(async (): Promise<void> => {
    if (!props.projectPath) {
      setGitStatusMap(new Map());
      return;
    }
    try {
      const response = await props.request({
        type: 'git/status',
        projectPath: props.projectPath,
      });
      if (!response.success) {
        setGitStatusMap(new Map());
        return;
      }
      const data = response.data as GitStatusData;
      setGitStatusMap(buildGitStatusByPath(data.snapshot.changedFiles));
    } catch {
      // Not a repository / git unavailable: leave the map empty.
      setGitStatusMap(new Map());
    }
  }, [props]);

  const reloadRoot = useCallback(async () => {
    if (!props.projectPath) {
      setRootNodes([]);
      setError(null);
      setGitStatusMap(new Map());
      return;
    }
    setLoading(true);
    setError(null);
    // Load the directory listing and git status in parallel; a git failure
    // must never block the tree from rendering.
    const [dirResult] = await Promise.allSettled([loadDirectory(''), loadGitStatus()]);
    if (dirResult.status === 'fulfilled') {
      setRootNodes(dirResult.value.map(entryToNode));
    } else {
      setError(
        dirResult.reason instanceof Error ? dirResult.reason.message : String(dirResult.reason),
      );
      setRootNodes([]);
    }
    setLoading(false);
  }, [loadDirectory, loadGitStatus, props.projectPath]);

  useEffect(() => {
    void reloadRoot();
  }, [reloadRoot]);

  // Recursively set a directory node's expanded state. When expanding a
  // directory whose children are not yet loaded, fetch them first. Used by both
  // the click toggle (flips) and keyboard nav (explicit expand/collapse).
  async function updateNodeExpanded(
    nodes: FileTreeNodeState[],
    relativePath: string,
    nextExpanded: boolean,
  ): Promise<FileTreeNodeState[]> {
    const next: FileTreeNodeState[] = [];
    for (const node of nodes) {
      if (node.entry.relativePath !== relativePath) {
        if (node.children && node.children.length > 0) {
          next.push({
            ...node,
            children: await updateNodeExpanded(node.children, relativePath, nextExpanded),
          });
        } else {
          next.push(node);
        }
        continue;
      }
      if (node.entry.kind !== 'directory') {
        next.push(node);
        continue;
      }
      // Collapsing is always cheap — no child fetch needed.
      if (!nextExpanded) {
        next.push({ ...node, expanded: false });
        continue;
      }
      // Expanding: if children already loaded, just flip the flag.
      if (node.children) {
        next.push({ ...node, expanded: true });
        continue;
      }
      // Expanding a never-loaded directory: fetch children, then expand.
      next.push({ ...node, loading: true, error: null, expanded: true });
      try {
        const entries = await loadDirectory(node.entry.relativePath);
        next[next.length - 1] = {
          ...node,
          expanded: true,
          loading: false,
          children: entries.map(entryToNode),
          error: null,
        };
      } catch (loadError) {
        next[next.length - 1] = {
          ...node,
          expanded: true,
          loading: false,
          children: [],
          error: loadError instanceof Error ? loadError.message : String(loadError),
        };
      }
    }
    return next;
  }

  async function setExpanded(relativePath: string, expanded: boolean): Promise<void> {
    const next = await updateNodeExpanded(rootNodes, relativePath, expanded);
    setRootNodes(next);
  }

  async function handleToggle(relativePath: string): Promise<void> {
    // Click toggles: flip current expanded state.
    const target = findNode(rootNodes, relativePath);
    const nextExpanded = target ? !target.expanded : true;
    await setExpanded(relativePath, nextExpanded);
  }

  function findNode(nodes: FileTreeNodeState[], relativePath: string): FileTreeNodeState | null {
    for (const node of nodes) {
      if (node.entry.relativePath === relativePath) return node;
      if (node.children) {
        const found = findNode(node.children, relativePath);
        if (found) return found;
      }
    }
    return null;
  }

  function handleTreeKeyDown(event: KeyboardEvent<HTMLUListElement>): void {
    const displayNodes = filterTreeNodes(rootNodes, filterQuery);
    const visibleRows = flattenVisibleRows(displayNodes);
    const result = keyboardMove(visibleRows, selectedPath, event.key);
    // Unrecognized keys (typing, modifiers) are left to the browser.
    if (!result) return;
    event.preventDefault();
    setSelectedPath(result.nextPath);
    if (result.expandPath) void setExpanded(result.expandPath, true);
    if (result.collapsePath) void setExpanded(result.collapsePath, false);
    if (result.activatePath) {
      const abs = absoluteFor(result.activatePath);
      props.onOpenFile?.(abs, result.activatePath);
    }
  }

  function absoluteFor(relativePath: string): string {
    if (!props.projectPath) return relativePath;
    const base = props.projectPath.replace(/\/+$/, '');
    return `${base}/${relativePath}`;
  }

  function handleDragStart(event: DragEvent, relativePath: string): void {
    const absolutePath = absoluteFor(relativePath);
    event.dataTransfer.setData('text/plain', absolutePath);
    event.dataTransfer.setData(PIWIN_PATH_MIME, JSON.stringify({ absolutePath, relativePath }));
    event.dataTransfer.effectAllowed = 'copy';
  }

  if (!props.projectPath) {
    return (
      <div className="file-tree-panel" data-testid="file-tree-panel">
        <EmptyState title="No workspace" description="Open a workspace to browse project files." />
      </div>
    );
  }

  return (
    <div className="file-tree-panel" data-testid="file-tree-panel">
      <div className="file-tree-main">
        <header className="file-tree-header">
          <div>
            <span className="inspector-kicker">Workspace</span>
            <strong>Files</strong>
          </div>
          <IconButton title="Refresh" label="Refresh file tree" onClick={() => void reloadRoot()}>
            <IconRefresh />
          </IconButton>
        </header>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <input
          type="search"
          data-testid="file-tree-filter"
          className="file-tree-filter"
          value={filterQuery}
          onChange={(e) => setFilterQuery(e.target.value)}
          placeholder={props.locale === 'zh-CN' ? '筛选已加载文件…' : 'Filter loaded files…'}
          aria-label={props.locale === 'zh-CN' ? '筛选文件' : 'Filter files'}
        />
        {loading ? (
          <div className="file-tree-loading">
            <Spinner />
            <span className="muted">Loading…</span>
          </div>
        ) : (
          <ul
            className="file-tree-list"
            role="tree"
            aria-label="Project files"
            tabIndex={0}
            onKeyDown={handleTreeKeyDown}
          >
            {rootNodes.length === 0 ? (
              <li className="muted file-tree-empty">Empty directory</li>
            ) : (
              filterTreeNodes(rootNodes, filterQuery).map((node) => (
                <FileTreeNodeView
                  key={node.entry.relativePath}
                  node={node}
                  depth={0}
                  selectedPath={selectedPath}
                  gitStatusMap={gitStatusMap}
                  onSelectFile={(relativePath) => {
                    setSelectedPath(relativePath);
                    props.onOpenFile?.(absoluteFor(relativePath), relativePath);
                  }}
                  onToggle={(path) => void handleToggle(path)}
                  onDragStart={handleDragStart}
                />
              ))
            )}
          </ul>
        )}
      </div>
      {props.onInsertPath && selectedPath ? (
        <footer className="file-tree-footer">
          <Button
            size="compact"
            data-testid="file-insert-path-btn"
            onClick={() => props.onInsertPath?.(absoluteFor(selectedPath), selectedPath)}
          >
            Insert path
          </Button>
        </footer>
      ) : null}
    </div>
  );
}

function FileTreeNodeView(props: {
  node: FileTreeNodeState;
  depth: number;
  selectedPath: string | null;
  gitStatusMap: Map<string, GitFileStatusCode>;
  onSelectFile: (path: string) => void;
  onToggle: (path: string) => void;
  onDragStart: (event: DragEvent, relativePath: string) => void;
}): ReactElement {
  const { node, depth } = props;
  const isDir = node.entry.kind === 'directory';
  const selected = props.selectedPath === node.entry.relativePath;
  const status = gitStatusForPath(props.gitStatusMap, node.entry.relativePath, node.entry.kind);

  return (
    <li
      role="treeitem"
      aria-expanded={isDir ? node.expanded : undefined}
      className={`file-tree-node${selected ? ' selected' : ''}`}
    >
      <button
        type="button"
        className="file-tree-row"
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
        title={node.entry.relativePath}
      >
        <span className="file-tree-twist" aria-hidden>
          {isDir ? (
            node.expanded ? (
              <IconChevronDown width={12} height={12} />
            ) : (
              <IconChevronRight width={12} height={12} />
            )
          ) : null}
        </span>
        <span className="file-tree-icon" aria-hidden>
          <FileTypeIcon filePathOrExt={isDir ? `${node.entry.name}/` : node.entry.name} />
        </span>
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
              onSelectFile={props.onSelectFile}
              onToggle={props.onToggle}
              onDragStart={props.onDragStart}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
