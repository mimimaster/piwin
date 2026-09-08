/**
 * Workspace file tree (right inspector Files tab).
 * Lazy-loads children via host project/list-dir.
 * File click → single split rail inside the right panel (left: content, right: tree).
 * Preview never leaves this panel for the chat stage; switching files reuses the same rail.
 * HTML files skip the in-tab markup preview and open in the workbench Browser tab when
 * `onOpenHtmlInBrowser` is provided.
 * Directory rows are pure-text expand/collapse controls (no folder icon).
 * Optional onOpenFile still fires for host/App integration; drag / Insert path → composer.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from 'react';
import { formatError } from '@piwin/contracts';
import type {
  GitFileStatusCode,
  GitStatusData,
  HostPathStyle,
  HostResponse,
  ProjectDirEntry,
  ProjectListDirData,
  ProjectReadFileData,
  PromptContextRef,
  ThemeManifest,
} from '@piwin/contracts';
import {
  Button,
  FileTypeIcon,
  IconButton,
  Notice,
  Spinner,
} from '@piwin/ui-kit';
import { IconClose, IconRefresh, IconSearch } from './shell-icons';
import { CodePreviewView } from './code-preview-view';
import { PreviewUnavailable } from './PreviewUnavailable';
import { FilePanelEmptyFallback } from './file-panel-empty-fallback.js';
import {
  classifyFileTreePreviewUnavailable,
  FILE_TREE_IMAGE_PREVIEW_MAX_BYTES,
} from './preview-unavailable';
import { EnhancedMarkdownView } from './EnhancedMarkdownView';
import {
  FILE_TREE_RAIL_DEFAULT_WIDTH_PX,
  FILE_TREE_RAIL_MAX_WIDTH_PX,
  FILE_TREE_RAIL_MIN_WIDTH_PX,
  clampFileTreeRailWidthForContainer,
  loadFileTreeRailWidth,
  saveFileTreeRailWidth,
} from './file-tree-rail-width';
import {
  buildGitStatusByPath,
  filterTreeNodes,
  flattenVisibleRows,
  keyboardMove,
  type FileTreeNodeState,
} from './file-tree-model';
import { loadExpandedPaths, saveExpandedPaths } from './file-tree-expand-memory';
import type { DesktopLocale } from './desktop-locale';
import { resolveProjectEntryAbsolutePath } from './file-tree-path';
import { revealLocalFileInFolder } from './local-file-actions.js';
import {
  canRevealInLocalFileManager,
  revealDisabledHint,
} from './local-file-reveal-policy.js';
import { resolveProjectFilesystemRoot } from './remote-session-hydrate.js';
import { PIWIN_PATH_MIME } from './workspace-path-drag';
import type { ContextMenuDispatchers } from './context-menu';
import { FileTreeNodeView } from './file-tree-node-view';
import { MarkupPreviewView, markupPreviewKind } from './markup-preview-view';


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
  /** CM: add structured file/folder context ref to composer. */
  onAddContextRef?: (ref: PromptContextRef) => void;
  /** CM: auto-send a preset turn (Explain/Fix) with the mapped refs. */
  onSendPreset?: (text: string, refs: PromptContextRef[]) => void;
  /**
   * Optional external open hook (e.g. DocPreview). Primary UX is the inline
   * split preview inside this panel — content stays in the right column.
   */
  onOpenFile?: (absolutePath: string, relativePath: string) => void;
  /**
   * HTML special case: skip the in-tab markup preview and open the file in
   * the workbench Browser tab instead of Doc Preview.
   */
  onOpenHtmlInBrowser?: (absolutePath: string, relativePath: string) => void;
  /** Desktop locale for locale-aware UI strings. */
  locale?: DesktopLocale | undefined;
  /** Active appearance theme for theme-adaptive styling. */
  activeTheme?: ThemeManifest | undefined;
  /** Optional callback to trigger workspace folder selection. */
  onOpenWorkspace?: (() => void) | undefined;
  /** Host filesystem style. Required when `projectPath` is an opaque remote id. */
  pathStyle?: HostPathStyle | undefined;
};

type FilePreviewState = {
  relativePath: string;
  absolutePath: string;
  content: string;
  truncated: boolean;
  isBinary: boolean;
  byteSize?: number;
  mimeHint?: string;
  previewDataUrl?: string;
};

/** Markdown / plaintext files render through EnhancedMarkdownView (same path as DocPreview). */
const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdx', 'txt', 'text']);

function isMarkdownPreviewPath(path: string): boolean {
  const extensionMatch = /\.([a-zA-Z0-9]+)$/.exec(path);
  const extension = extensionMatch?.[1]?.toLowerCase() ?? '';
  return extension === '' || MARKDOWN_EXTENSIONS.has(extension);
}

function entryToNode(entry: ProjectDirEntry): FileTreeNodeState {
  return {
    entry,
    expanded: false,
    loading: false,
    children: entry.kind === 'directory' ? null : [],
    error: null,
  };
}

/**
 * Recursively collect the `relativePath` of every directory node currently
 * marked `expanded`. Used to persist the expand set after each tree mutation.
 */
function collectExpanded(nodes: readonly FileTreeNodeState[]): string[] {
  const out: string[] = [];
  function walk(list: readonly FileTreeNodeState[]): void {
    for (const node of list) {
      if (node.entry.kind === 'directory' && node.expanded) {
        out.push(node.entry.relativePath);
      }
      if (node.children) walk(node.children);
    }
  }
  walk(nodes);
  return out;
}

/**
 * Depth-first restore of remembered expanded directories. For each directory
 * node whose `relativePath` is in `paths`: load its children if not yet
 * loaded, mark it expanded, then recurse into the (now-loaded) children to
 * restore deeper paths. Nodes not in `paths` are still recursed into when
 * their children are already loaded, so a remembered deep path under a
 * previously-expanded ancestor can be restored. Returns a new node tree.
 */
async function restoreExpanded(
  nodes: readonly FileTreeNodeState[],
  paths: Set<string>,
  loadDir: (relativePath: string) => Promise<ProjectDirEntry[]>,
): Promise<FileTreeNodeState[]> {
  const next: FileTreeNodeState[] = [];
  for (const node of nodes) {
    if (node.entry.kind !== 'directory') {
      next.push(node);
      continue;
    }
    const shouldExpand = paths.has(node.entry.relativePath);
    let children = node.children;
    let expanded = node.expanded;
    let loading = node.loading;
    let error = node.error;
    if (shouldExpand && children === null) {
      // Fetch children before expanding so deeper remembered paths can be
      // restored in the recursive pass below.
      loading = true;
      error = null;
      try {
        const entries = await loadDir(node.entry.relativePath);
        children = entries.map(entryToNode);
        expanded = true;
        loading = false;
      } catch (loadError) {
        children = [];
        expanded = true;
        loading = false;
        error = formatError(loadError);
        next.push({ ...node, expanded, loading, children, error });
        continue;
      }
    } else if (shouldExpand) {
      expanded = true;
    }
    // Recurse into whatever children we have to restore deeper remembered
    // paths. Only recurse when there is something to restore below.
    if (children && children.length > 0) {
      children = await restoreExpanded(children, paths, loadDir);
    }
    next.push({ ...node, expanded, loading, children, error });
  }
  return next;
}

export function FileTreePanel(props: FileTreePanelProps): ReactElement {
  const [rootNodes, setRootNodes] = useState<FileTreeNodeState[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [filterQuery, setFilterQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [gitStatusMap, setGitStatusMap] = useState<Map<string, GitFileStatusCode>>(() => new Map());
  const [preview, setPreview] = useState<FilePreviewState | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [railWidthPx, setRailWidthPx] = useState(() => loadFileTreeRailWidth());
  const [isRailResizing, setIsRailResizing] = useState(false);
  const splitContainerRef = useRef<HTMLDivElement | null>(null);
  const railWidthRef = useRef(railWidthPx);
  const railDragRef = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
  } | null>(null);
  const locale = props.locale ?? 'zh-CN';

  useEffect(() => {
    railWidthRef.current = railWidthPx;
  }, [railWidthPx]);

  const toggleSearch = useCallback(() => {
    setIsSearchOpen((prev) => {
      const next = !prev;
      if (!next) {
        setFilterQuery('');
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (isSearchOpen) {
      searchInputRef.current?.focus();
    }
  }, [isSearchOpen]);

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
    // Depend on the stable request identity + project path only. Using the
    // whole `props` object recreated loadDirectory on every parent render
    // (e.g. right-panel resize), which re-fired reloadRoot and flashed the tree.
    [props.projectPath, props.request],
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
  }, [props.projectPath, props.request]);

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
      const baseNodes = dirResult.value.map(entryToNode);
      setRootNodes(baseNodes);
      // Restore previously-expanded directories for this project. The walk is
      // async because remembered directories may need their children fetched.
      // An empty path set (fresh localStorage, e.g. in tests) is a no-op.
      const remembered = loadExpandedPaths(props.projectPath);
      if (remembered.size > 0) {
        const restored = await restoreExpanded(baseNodes, remembered, loadDirectory);
        setRootNodes(restored);
      }
    } else {
      setError(formatError(dirResult.reason));
      setRootNodes([]);
    }
    setLoading(false);
  }, [loadDirectory, loadGitStatus, props.projectPath]);

  useEffect(() => {
    void reloadRoot();
  }, [reloadRoot]);

  // Persist the current set of expanded relative paths whenever the tree
  // changes. Best-effort: localStorage may be unavailable.
  useEffect(() => {
    if (!props.projectPath) return;
    saveExpandedPaths(props.projectPath, collectExpanded(rootNodes));
  }, [rootNodes, props.projectPath]);

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
          error: formatError(loadError),
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
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      setIsSearchOpen(true);
      return;
    }
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
      void openFilePreview(result.activatePath);
    }
  }

  function absoluteFor(relativePath: string): string {
    if (!props.projectPath) return relativePath;
    if (props.pathStyle === undefined) {
      return resolveProjectEntryAbsolutePath(props.projectPath, relativePath);
    }
    return resolveProjectEntryAbsolutePath(props.projectPath, relativePath, props.pathStyle);
  }

  const contextMenuDispatchers: ContextMenuDispatchers = {
    addToChat: (ref) => {
      props.onAddContextRef?.(ref);
    },
    focusComposer: () => {
      const textarea = document.querySelector<HTMLTextAreaElement>(
        '[data-testid="composer-input"]',
      );
      textarea?.focus();
    },
    sendPreset: (text, refs) => {
      props.onSendPreset?.(text, refs);
    },
    openPath: (absolutePath, relativePath) => {
      void openFilePreview(relativePath);
      props.onOpenFile?.(absolutePath, relativePath);
    },
    revealPath: (absolutePath) => {
      void revealLocalFileInFolder(absolutePath).then((result) => {
        if (result.ok) return;
        // Browser preview / mock: no Finder. Failures stay quiet in the tree —
        // PathChip surfaces a toast; the tree already has copy-absolute-path.
      });
    },
    copyText: (value) => {
      void navigator.clipboard.writeText(value).catch(() => undefined);
    },
    quoteInComposer: () => undefined,
    retryMessage: () => undefined,
    forkMessage: () => undefined,
    openSideChat: () => undefined,
    notify: () => undefined,
  };

  const projectRoot = resolveProjectFilesystemRoot(props.projectPath);
  const canRevealInFileManager =
    Boolean(projectRoot) && canRevealInLocalFileManager(projectRoot);
  const contextMenuCaps = {
    hasProject: Boolean(props.projectPath),
    canReveal: canRevealInFileManager,
    ...(canRevealInFileManager
      ? {}
      : { revealDisabledHint: revealDisabledHint(locale === 'zh-CN' ? 'zh-CN' : 'en') }),
    sideChatAvailable: false,
    applyAvailable: false,
    canSendPreset: false,
    locale,
  } as const;

  /** Load file content into the left pane of the right-panel split. */
  async function openFilePreview(relativePath: string): Promise<void> {
    if (!props.projectPath) return;
    const absolutePath = absoluteFor(relativePath);
    if (props.onOpenHtmlInBrowser && markupPreviewKind(relativePath) === 'html') {
      setSelectedPath(relativePath);
      setPreview(null);
      setPreviewLoading(false);
      setPreviewError(null);
      props.onOpenHtmlInBrowser(absolutePath, relativePath);
      return;
    }
    setSelectedPath(relativePath);
    setPreviewLoading(true);
    setPreviewError(null);
    // Keep previous content visible until the new read lands (smoother switch).
    props.onOpenFile?.(absolutePath, relativePath);
    try {
      const response = await props.request({
        type: 'project/read-file',
        projectPath: props.projectPath,
        relativePath,
      });
      if (!response.success) {
        throw new Error(response.error);
      }
      const data = response.data as ProjectReadFileData;
      setPreview({
        relativePath: data.relativePath || relativePath,
        absolutePath: data.absolutePath || absolutePath,
        content: data.content ?? '',
        truncated: data.truncated === true,
        isBinary: data.isBinary === true,
        ...(typeof data.byteSize === 'number' ? { byteSize: data.byteSize } : {}),
        ...(data.mimeHint ? { mimeHint: data.mimeHint } : {}),
        ...(data.previewDataUrl ? { previewDataUrl: data.previewDataUrl } : {}),
      });
    } catch (loadError) {
      setPreview(null);
      setPreviewError(formatError(loadError));
    } finally {
      setPreviewLoading(false);
    }
  }

  function closeFilePreview(): void {
    setPreview(null);
    setPreviewError(null);
    setPreviewLoading(false);
  }

  function handleDragStart(event: DragEvent, relativePath: string): void {
    const absolutePath = absoluteFor(relativePath);
    event.dataTransfer.setData('text/plain', absolutePath);
    event.dataTransfer.setData(PIWIN_PATH_MIME, JSON.stringify({ absolutePath, relativePath }));
    event.dataTransfer.effectAllowed = 'copy';
  }

  // Clear preview when the workspace changes so stale content cannot linger.
  useEffect(() => {
    setPreview(null);
    setPreviewError(null);
    setPreviewLoading(false);
    setSelectedPath(null);
  }, [props.projectPath]);

  function resolveRailWidth(candidate: number): number {
    const containerWidth = splitContainerRef.current?.clientWidth ?? 0;
    return clampFileTreeRailWidthForContainer(candidate, containerWidth);
  }

  function onRailResizePointerDown(event: ReactPointerEvent<HTMLElement>): void {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    railDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: railWidthRef.current,
    };
    setIsRailResizing(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }

  useEffect(() => {
    if (!isRailResizing) {
      return;
    }

    function onPointerMove(event: PointerEvent): void {
      const drag = railDragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) {
        return;
      }
      // Handle sits on the left edge of the tree rail: drag left → wider tree rail.
      const delta = drag.startX - event.clientX;
      const next = resolveRailWidth(drag.startWidth + delta);
      if (next === railWidthRef.current) {
        return;
      }
      railWidthRef.current = next;
      // Live CSS only — avoid React commits every sample while dragging.
      const split = splitContainerRef.current;
      if (split) {
        split.style.setProperty('--file-tree-rail-width', `${next}px`);
      }
    }

    function endDrag(event: PointerEvent): void {
      const drag = railDragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) {
        return;
      }
      railDragRef.current = null;
      const commit = resolveRailWidth(railWidthRef.current);
      railWidthRef.current = commit;
      setRailWidthPx(commit);
      saveFileTreeRailWidth(commit);
      setTimeout(() => {
        setIsRailResizing(false);
      }, 40);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isRailResizing]);

  const isSplitOpen = preview != null || previewLoading || previewError != null;
  const previewFileName = preview
    ? preview.relativePath.split(/[\\/]/).pop() || preview.relativePath
    : selectedPath
      ? selectedPath.split(/[\\/]/).pop() || selectedPath
      : '';

  if (!props.projectPath) {
    return (
      <div className="file-tree-panel" data-testid="file-tree-panel">
        <FilePanelEmptyFallback
          locale={locale}
          activeTheme={props.activeTheme}
          onOpenWorkspace={props.onOpenWorkspace}
        />
      </div>
    );
  }

  const markupKind =
    preview && !preview.isBinary ? markupPreviewKind(preview.relativePath) : null;
  const showMarkupPreview = markupKind !== null && Boolean(preview?.content);
  const showImagePreview = Boolean(preview?.previewDataUrl) && !showMarkupPreview;
  const showMarkdownPreview =
    preview != null &&
    !showImagePreview &&
    !showMarkupPreview &&
    !preview.isBinary &&
    isMarkdownPreviewPath(preview.relativePath);
  const binaryUnavailableReason =
    preview && preview.isBinary && !showImagePreview
      ? classifyFileTreePreviewUnavailable({
          ...(preview.mimeHint ? { mimeHint: preview.mimeHint } : {}),
          ...(preview.byteSize !== undefined ? { byteSize: preview.byteSize } : {}),
        })
      : null;

  return (
    <div
      ref={splitContainerRef}
      className={`file-tree-panel${isSplitOpen ? ' file-tree-panel-split' : ''}${isRailResizing ? ' is-rail-resizing' : ''}`}
      data-testid="file-tree-panel"
      data-split={isSplitOpen ? 'true' : 'false'}
      style={
        isSplitOpen
          ? ({
              ['--file-tree-rail-width' as string]: `${railWidthPx}px`,
            } as CSSProperties)
          : undefined
      }
    >
      {isSplitOpen ? (
        <section
          className="file-tree-preview"
          data-testid="file-tree-preview"
          aria-label="File preview"
        >
          <header className="file-tree-preview-header">
            <div className="file-tree-preview-title">
              {previewFileName ? (
                <>
                  <FileTypeIcon filePathOrExt={previewFileName} />
                  <strong title={preview?.relativePath ?? selectedPath ?? undefined}>
                    {previewFileName}
                  </strong>
                </>
              ) : (
                <strong>{locale === 'zh-CN' ? '文件预览' : 'File preview'}</strong>
              )}
            </div>
            <IconButton
              title={locale === 'zh-CN' ? '关闭预览' : 'Close preview'}
              label={locale === 'zh-CN' ? '关闭预览' : 'Close preview'}
              data-testid="file-tree-preview-close"
              onClick={closeFilePreview}
            >
              <IconClose width={14} height={14} />
            </IconButton>
          </header>
          <div className="file-tree-preview-body">
            {previewLoading && !preview ? (
              <div className="file-tree-loading">
                <Spinner />
                <span className="muted">{locale === 'zh-CN' ? '加载中…' : 'Loading…'}</span>
              </div>
            ) : null}
            {previewError ? (
              <PreviewUnavailable
                reason="not-found"
                locale={locale}
                fileName={previewFileName}
                testId="file-tree-preview-unavailable"
              />
            ) : null}
            {preview && showImagePreview && preview.previewDataUrl ? (
              <div className="file-tree-preview-image-stage" data-testid="file-tree-preview-image">
                <img
                  className="file-tree-preview-image"
                  src={preview.previewDataUrl}
                  alt={previewFileName || preview.relativePath}
                  draggable={false}
                />
              </div>
            ) : null}
            {preview && binaryUnavailableReason ? (
              <PreviewUnavailable
                reason={binaryUnavailableReason}
                locale={locale}
                fileName={previewFileName || preview.relativePath}
                {...(preview.byteSize !== undefined ? { byteSize: preview.byteSize } : {})}
                {...(binaryUnavailableReason === 'too-large'
                  ? { maxBytes: FILE_TREE_IMAGE_PREVIEW_MAX_BYTES }
                  : {})}
                testId="file-tree-preview-binary"
              />
            ) : null}
            {preview && !preview.isBinary && !showImagePreview ? (
              <>
                {preview.truncated ? (
                  <div className="file-tree-preview-truncated muted">
                    {locale === 'zh-CN' ? '内容已截断' : 'Content truncated'}
                  </div>
                ) : null}
                {showMarkupPreview && markupKind ? (
                  <MarkupPreviewView
                    source={preview.content}
                    kind={markupKind}
                    locale={locale}
                  />
                ) : showMarkdownPreview ? (
                  <EnhancedMarkdownView
                    text={preview.content}
                    docTitle={previewFileName || preview.relativePath}
                    filePath={preview.relativePath}
                  />
                ) : (
                  <CodePreviewView
                    code={preview.content}
                    filePath={preview.relativePath}
                    projectPath={props.projectPath ?? undefined}
                    contextMenuCaps={contextMenuCaps}
                    contextMenuDispatchers={contextMenuDispatchers}
                  />
                )}
              </>
            ) : null}
          </div>
        </section>
      ) : null}

      <div className="file-tree-main" data-testid="file-tree-browser">
        {isSplitOpen ? (
          <div
            className="file-tree-rail-resize-handle"
            data-testid="file-tree-rail-resize-handle"
            role="separator"
            aria-orientation="vertical"
            aria-label={locale === 'zh-CN' ? '调整文件树宽度' : 'Resize file tree'}
            aria-valuemin={FILE_TREE_RAIL_MIN_WIDTH_PX}
            aria-valuemax={FILE_TREE_RAIL_MAX_WIDTH_PX}
            aria-valuenow={railWidthPx}
            title={
              locale === 'zh-CN'
                ? '拖动调整文件树宽度，双击恢复默认'
                : 'Drag to resize file tree. Double-click to reset.'
            }
            onPointerDown={onRailResizePointerDown}
            onDoubleClick={() => {
              const reset = resolveRailWidth(FILE_TREE_RAIL_DEFAULT_WIDTH_PX);
              railWidthRef.current = reset;
              setRailWidthPx(reset);
              saveFileTreeRailWidth(reset);
            }}
          />
        ) : null}
        <header className="file-tree-header ft-h">
          <span className="file-tree-header-title">Workspace</span>
          <div className="file-tree-header-actions">
            <IconButton
              title={
                locale === 'zh-CN'
                  ? isSearchOpen
                    ? '关闭搜索'
                    : '搜索文件'
                  : isSearchOpen
                    ? 'Close search'
                    : 'Search files'
              }
              label={locale === 'zh-CN' ? '搜索文件' : 'Search files'}
              data-testid="file-tree-search-toggle"
              aria-pressed={isSearchOpen}
              className={isSearchOpen ? 'active' : undefined}
              onClick={toggleSearch}
            >
              <IconSearch />
            </IconButton>
            <IconButton
              title={locale === 'zh-CN' ? '刷新' : 'Refresh'}
              label={locale === 'zh-CN' ? '刷新文件树' : 'Refresh file tree'}
              data-testid="file-tree-refresh-btn"
              onClick={() => void reloadRoot()}
            >
              <IconRefresh />
            </IconButton>
          </div>
        </header>
        {error ? <Notice tone="error">{error}</Notice> : null}
        {isSearchOpen ? (
          <div className="file-tree-search-bar" data-testid="file-tree-search-bar">
            <div className="file-tree-search-field">
              <IconSearch className="file-tree-search-icon" width={13} height={13} aria-hidden />
              <input
                ref={searchInputRef}
                type="search"
                data-testid="file-tree-filter"
                className="file-tree-filter"
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    if (filterQuery) {
                      setFilterQuery('');
                    } else {
                      setIsSearchOpen(false);
                    }
                  }
                }}
                placeholder={locale === 'zh-CN' ? '搜索已加载文件…' : 'Filter loaded files…'}
                aria-label={locale === 'zh-CN' ? '搜索文件' : 'Filter files'}
              />
              {filterQuery ? (
                <button
                  type="button"
                  className="file-tree-search-clear"
                  data-testid="file-tree-search-clear"
                  onClick={() => {
                    setFilterQuery('');
                    searchInputRef.current?.focus();
                  }}
                  title={locale === 'zh-CN' ? '清除' : 'Clear'}
                  aria-label={locale === 'zh-CN' ? '清除搜索' : 'Clear search'}
                >
                  <IconClose width={12} height={12} />
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
        {/* Keep the existing tree visible during reload so resize/parent re-renders
            cannot flash an empty Loading state over the file list. */}
        {loading && rootNodes.length === 0 ? (
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
              <li className="muted file-tree-empty">
                {locale === 'zh-CN' ? '空目录' : 'Empty directory'}
              </li>
            ) : (
              filterTreeNodes(rootNodes, filterQuery).map((node) => (
                <FileTreeNodeView
                  key={node.entry.relativePath}
                  node={node}
                  depth={0}
                  selectedPath={selectedPath}
                  gitStatusMap={gitStatusMap}
                  projectPath={props.projectPath}
                  onSelectFile={(relativePath) => {
                    void openFilePreview(relativePath);
                  }}
                  onSelectPath={setSelectedPath}
                  onToggle={(path) => void handleToggle(path)}
                  onDragStart={handleDragStart}
                  absoluteFor={absoluteFor}
                  contextMenuCaps={contextMenuCaps}
                  contextMenuDispatchers={contextMenuDispatchers}
                  enableContextMenu={Boolean(props.onAddContextRef && props.projectPath)}

                />
              ))
            )}
          </ul>
        )}
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
    </div>
  );
}
