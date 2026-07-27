/**
 * Workspace file tree (right inspector Files tab).
 * Lazy-loads children via host project/list-dir.
 * File click → text preview; drag / Insert path → composer.
 */
import {
  useCallback,
  useEffect,
  useState,
  type DragEvent,
  type ReactElement,
} from 'react';
import type {
  HostResponse,
  ProjectDirEntry,
  ProjectListDirData,
  ProjectReadFileData,
} from '@piwin/contracts';
import { Button, EmptyState, IconButton, Notice, Spinner } from '@piwin/ui-kit';
import { IconChevronDown, IconChevronRight, IconFile, IconFolder, IconRefresh } from './shell-icons';

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
    };

export type FileTreePanelProps = {
  projectPath: string | null;
  request: (command: FileTreeRequest) => Promise<HostResponse>;
  /** Insert absolute/relative path into composer (text models). */
  onInsertPath?: (absolutePath: string, relativePath: string) => void;
};

type TreeNodeState = {
  entry: ProjectDirEntry;
  expanded: boolean;
  loading: boolean;
  children: TreeNodeState[] | null;
  error: string | null;
};

function entryToNode(entry: ProjectDirEntry): TreeNodeState {
  return {
    entry,
    expanded: false,
    loading: false,
    children: entry.kind === 'directory' ? null : [],
    error: null,
  };
}

export const PIWIN_PATH_MIME = 'application/x-piwin-workspace-path';

export function FileTreePanel(props: FileTreePanelProps): ReactElement {
  const [rootNodes, setRootNodes] = useState<TreeNodeState[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [preview, setPreview] = useState<ProjectReadFileData | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

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

  const reloadRoot = useCallback(async () => {
    if (!props.projectPath) {
      setRootNodes([]);
      setError(null);
      setPreview(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const entries = await loadDirectory('');
      setRootNodes(entries.map(entryToNode));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
      setRootNodes([]);
    } finally {
      setLoading(false);
    }
  }, [loadDirectory, props.projectPath]);

  useEffect(() => {
    void reloadRoot();
  }, [reloadRoot]);

  const openFilePreview = useCallback(
    async (relativePath: string): Promise<void> => {
      if (!props.projectPath) return;
      setSelectedPath(relativePath);
      setPreviewLoading(true);
      setPreviewError(null);
      const response = await props.request({
        type: 'project/read-file',
        projectPath: props.projectPath,
        relativePath,
      });
      setPreviewLoading(false);
      if (!response.success) {
        setPreview(null);
        setPreviewError(response.error);
        return;
      }
      setPreview(response.data as ProjectReadFileData);
    },
    [props],
  );

  async function toggleNode(
    nodes: TreeNodeState[],
    relativePath: string,
  ): Promise<TreeNodeState[]> {
    const next: TreeNodeState[] = [];
    for (const node of nodes) {
      if (node.entry.relativePath !== relativePath) {
        if (node.children && node.children.length > 0) {
          next.push({
            ...node,
            children: await toggleNode(node.children, relativePath),
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
      if (node.expanded) {
        next.push({ ...node, expanded: false });
        continue;
      }
      if (node.children) {
        next.push({ ...node, expanded: true });
        continue;
      }
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

  async function handleToggle(relativePath: string): Promise<void> {
    const next = await toggleNode(rootNodes, relativePath);
    setRootNodes(next);
  }

  function absoluteFor(relativePath: string): string {
    if (!props.projectPath) return relativePath;
    const base = props.projectPath.replace(/\/+$/, '');
    return `${base}/${relativePath}`;
  }

  function handleDragStart(
    event: DragEvent,
    relativePath: string,
  ): void {
    const absolutePath = absoluteFor(relativePath);
    event.dataTransfer.setData('text/plain', absolutePath);
    event.dataTransfer.setData(
      PIWIN_PATH_MIME,
      JSON.stringify({ absolutePath, relativePath }),
    );
    event.dataTransfer.effectAllowed = 'copy';
  }

  if (!props.projectPath) {
    return (
      <div className="file-tree-panel" data-testid="file-tree-panel">
        <EmptyState
          title="No workspace"
          description="Open a workspace to browse project files."
        />
      </div>
    );
  }

  return (
    <div className="file-tree-panel file-tree-panel-split" data-testid="file-tree-panel">
      <div className="file-tree-main">
        <header className="file-tree-header">
          <div>
            <span className="inspector-kicker">Workspace</span>
            <strong>Files</strong>
          </div>
          <IconButton
            title="Refresh"
            label="Refresh file tree"
            onClick={() => void reloadRoot()}
          >
            <IconRefresh />
          </IconButton>
        </header>
        {error ? <Notice tone="error">{error}</Notice> : null}
        {loading ? (
          <div className="file-tree-loading">
            <Spinner />
            <span className="muted">Loading…</span>
          </div>
        ) : (
          <ul className="file-tree-list" role="tree" aria-label="Project files">
            {rootNodes.length === 0 ? (
              <li className="muted file-tree-empty">Empty directory</li>
            ) : (
              rootNodes.map((node) => (
                <FileTreeNodeView
                  key={node.entry.relativePath}
                  node={node}
                  depth={0}
                  selectedPath={selectedPath}
                  onSelectFile={(relativePath) => {
                    void openFilePreview(relativePath);
                  }}
                  onToggle={(path) => void handleToggle(path)}
                  onDragStart={handleDragStart}
                />
              ))
            )}
          </ul>
        )}
      </div>

      <div className="file-tree-preview" data-testid="file-tree-preview">
        <header className="file-tree-preview-header">
          <strong>{selectedPath ?? 'Preview'}</strong>
          {preview && !preview.isBinary ? (
            <div className="file-tree-preview-actions">
              <Button
                size="compact"
                data-testid="file-insert-path-btn"
                onClick={() =>
                  props.onInsertPath?.(preview.absolutePath, preview.relativePath)
                }
              >
                Insert path
              </Button>
            </div>
          ) : null}
        </header>
        {previewLoading ? (
          <div className="file-tree-loading">
            <Spinner />
          </div>
        ) : previewError ? (
          <Notice tone="error">{previewError}</Notice>
        ) : !selectedPath ? (
          <div className="muted file-tree-empty">
            Click a file to preview. Drag a file onto the composer to insert its path.
          </div>
        ) : preview?.isBinary ? (
          <div className="muted file-tree-empty">
            Binary file ({preview.byteSize.toLocaleString()} bytes). Drag to insert path only.
            <div className="file-tree-preview-actions" style={{ marginTop: 8 }}>
              <Button
                size="compact"
                onClick={() =>
                  props.onInsertPath?.(preview.absolutePath, preview.relativePath)
                }
              >
                Insert path
              </Button>
            </div>
          </div>
        ) : preview ? (
          <>
            <pre className="file-tree-preview-code" data-testid="file-preview-content">
              {preview.content}
            </pre>
            {preview.truncated ? (
              <div className="muted file-tree-preview-meta">
                Truncated preview · {preview.byteSize.toLocaleString()} bytes on disk
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

function FileTreeNodeView(props: {
  node: TreeNodeState;
  depth: number;
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
  onToggle: (path: string) => void;
  onDragStart: (event: DragEvent, relativePath: string) => void;
}): ReactElement {
  const { node, depth } = props;
  const isDir = node.entry.kind === 'directory';
  const selected = props.selectedPath === node.entry.relativePath;

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
          {isDir ? <IconFolder width={14} height={14} /> : <IconFile width={14} height={14} />}
        </span>
        <span className="file-tree-name">{node.entry.name}</span>
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
