/**
 * Host directory browser: sidebar + column view, same shape as the OS
 * "Open workspace" window.
 */
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from 'react';
import type { HostDirEntry, HostListDirData } from '@piwin/contracts';
import {
  IconChevronLeft,
  IconChevronRight,
  IconDocument,
  IconDownload,
  IconFile,
  IconFolder,
  IconGrid,
  IconLaptop,
  IconSearch,
} from './shell-icons';
import {
  clampPickerMeasure,
  directoryPathForOpen,
  favoritePathsFromListing,
  filterColumnEntries,
  HOST_PICKER_COLUMN_MAX,
  HOST_PICKER_COLUMN_MIN,
  HOST_PICKER_COLUMN_WIDTH,
  HOST_PICKER_DIALOG_MIN_HEIGHT,
  HOST_PICKER_DIALOG_MIN_WIDTH,
  HOST_PICKER_MAX_ANCESTOR_COLUMNS,
  HOST_PICKER_SIDEBAR_MAX,
  HOST_PICKER_SIDEBAR_MIN,
  HOST_PICKER_SIDEBAR_WIDTH,
  pickerRowSelected,
  replaceColumnsAfter,
  selectedEntryIsFile,
  selectedFilePath,
  shouldListParentColumn,
  sortPickerEntries,
  type HostPickerSidebarItem,
} from './host-workspace-picker-nav';

export type HostWorkspacePickerProps = {
  locale: 'zh-CN' | 'en';
  currentPath: string;
  onCurrentPathChange: (path: string) => void;
  listDirectory: (path?: string) => Promise<HostListDirData>;
  recents?: readonly string[];
  onConfirm: (path: string) => void;
  onCancel: () => void;
  /** Directory = open a folder (workspace). File = choose an executable/script. */
  mode?: 'directory' | 'file';
};

type HistoryState = {
  paths: string[];
  index: number;
};

function favoriteIcon(name: string): ReactElement {
  switch (name) {
    case 'Desktop':
      return <IconLaptop width={14} height={14} />;
    case 'Documents':
      return <IconDocument width={14} height={14} />;
    case 'Downloads':
      return <IconDownload width={14} height={14} />;
    case 'Applications':
      return <IconGrid width={14} height={14} />;
    default:
      return <IconFolder width={14} height={14} />;
  }
}

function homeLabel(homePath: string, zh: boolean): string {
  const parts = homePath.split(/[/\\]/).filter(Boolean);
  const last = parts[parts.length - 1];
  return last ?? (zh ? '主目录' : 'Home');
}

function ResizeHandle(props: {
  testId: string;
  label: string;
  kind: 'column' | 'corner';
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
}): ReactElement {
  return (
    <div
      className={
        props.kind === 'corner' ? 'host-workspace-resize-grip' : 'host-workspace-resizer'
      }
      data-testid={props.testId}
      role="separator"
      aria-label={props.label}
      aria-orientation={props.kind === 'corner' ? 'horizontal' : 'vertical'}
      onPointerDown={props.onPointerDown}
    />
  );
}

export function HostWorkspacePicker(props: HostWorkspacePickerProps): ReactElement {
  const zh = props.locale === 'zh-CN';
  const pickerMode = props.mode ?? 'directory';
  const [columns, setColumns] = useState<HostListDirData[]>([]);
  const [homeListing, setHomeListing] = useState<HostListDirData | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | undefined>(undefined);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryState>({ paths: [], index: -1 });
  const [pathDraft, setPathDraft] = useState(props.currentPath);
  const [sidebarWidth, setSidebarWidth] = useState(HOST_PICKER_SIDEBAR_WIDTH);
  const [columnWidthByPath, setColumnWidthByPath] = useState<Record<string, number>>({});
  const [layoutResizing, setLayoutResizing] = useState(false);
  const pathDraftDirty = useRef(false);
  const requestIdRef = useRef(0);
  const homeListingRef = useRef<HostListDirData | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const columnsRef = useRef<HTMLDivElement>(null);
  homeListingRef.current = homeListing;

  const directoryPath = directoryPathForOpen(columns, selectedPath);
  const filePath = selectedFilePath(columns, selectedPath);
  const typedPath = pathDraft.trim();
  const confirmPath =
    pickerMode === 'file' ? filePath : typedPath.length > 0 ? typedPath : directoryPath;
  const openDisabled =
    confirmPath.length === 0 ||
    (pickerMode === 'directory' &&
      typedPath.length === 0 &&
      selectedEntryIsFile(columns, selectedPath));
  const favorites = homeListing ? favoritePathsFromListing(homeListing) : [];
  const recents = (props.recents ?? []).filter((path) => path.trim().length > 0).slice(0, 8);
  const focusPath = selectedPath ?? directoryPath;

  function recordHistory(path: string): void {
    setHistory((prev) => {
      const paths = [...prev.paths.slice(0, prev.index + 1), path];
      return { paths, index: paths.length - 1 };
    });
  }

  function sizeTarget(): HTMLElement | null {
    return rootRef.current?.closest<HTMLElement>('.workspace-open-dialog') ?? rootRef.current;
  }

  function columnWidth(path: string): number {
    return columnWidthByPath[path] ?? HOST_PICKER_COLUMN_WIDTH;
  }

  function commitPath(path: string): void {
    setSelectedPath(path);
    if (!pathDraftDirty.current) {
      setPathDraft(path);
    }
    props.onCurrentPathChange(path);
  }

  async function revealPath(
    path: string | undefined,
    options?: { history?: boolean },
  ): Promise<void> {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const target = await props.listDirectory(path);
      if (requestId !== requestIdRef.current) {
        return;
      }
      const chain: HostListDirData[] = [target];
      let current = target;
      while (
        shouldListParentColumn(current) &&
        current.parentPath &&
        chain.length < HOST_PICKER_MAX_ANCESTOR_COLUMNS
      ) {
        const parent = await props.listDirectory(current.parentPath);
        if (requestId !== requestIdRef.current) {
          return;
        }
        chain.unshift(parent);
        current = parent;
      }
      setColumns(chain);
      commitPath(target.path);
      const homeColumn = chain.find((column) => column.path === column.homePath);
      if (homeColumn) {
        setHomeListing(homeColumn);
      } else if (homeListingRef.current === null) {
        try {
          const home = await props.listDirectory(target.homePath);
          if (requestId !== requestIdRef.current) {
            return;
          }
          setHomeListing(home);
        } catch {
          // Sidebar favorites stay empty when home cannot be listed.
        }
      }
      if (options?.history !== false) {
        recordHistory(target.path);
      }
    } catch (caught) {
      if (requestId !== requestIdRef.current) {
        return;
      }
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }

  async function openChildColumn(directoryPathValue: string, columnIndex: number): Promise<void> {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const data = await props.listDirectory(directoryPathValue);
      if (requestId !== requestIdRef.current) {
        return;
      }
      setColumns((prev) => replaceColumnsAfter(prev, columnIndex, data));
      commitPath(data.path);
      recordHistory(data.path);
    } catch (caught) {
      if (requestId !== requestIdRef.current) {
        return;
      }
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    void revealPath(props.currentPath.trim() || undefined);
  }, []);

  useEffect(() => {
    const scroller = columnsRef.current;
    if (!scroller) {
      return;
    }
    const last = scroller.querySelector('.host-workspace-column.is-last');
    last?.scrollIntoView({ inline: 'end', block: 'nearest' });
    scroller.querySelectorAll('.host-workspace-row.is-selected').forEach((row) => {
      row.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  }, [columns, selectedPath]);

  async function openEntry(entry: HostDirEntry, columnIndex: number): Promise<void> {
    if (entry.kind !== 'directory') {
      setSelectedPath(entry.path);
      setColumns((prev) => prev.slice(0, columnIndex + 1));
      if (pickerMode !== 'file') {
        const parentPath = columns[columnIndex]?.path;
        if (parentPath) {
          pathDraftDirty.current = false;
          setPathDraft(parentPath);
          props.onCurrentPathChange(parentPath);
        }
      }
      return;
    }
    pathDraftDirty.current = false;
    setSelectedPath(entry.path);
    setPathDraft(entry.path);
    props.onCurrentPathChange(entry.path);
    await openChildColumn(entry.path, columnIndex);
  }

  async function jumpTo(path: string): Promise<void> {
    pathDraftDirty.current = false;
    setSearch('');
    await revealPath(path);
  }

  function onHorizontalResizePointerDown(
    event: ReactPointerEvent<HTMLDivElement>,
    startWidth: number,
    min: number,
    max: number,
    commit: (width: number) => void,
  ): void {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const pointerId = event.pointerId;
    const originX = event.clientX;
    const handle = event.currentTarget;
    handle.setPointerCapture?.(pointerId);
    setLayoutResizing(true);

    function onMove(moveEvent: PointerEvent): void {
      if (moveEvent.pointerId !== pointerId) {
        return;
      }
      commit(clampPickerMeasure(startWidth + (moveEvent.clientX - originX), min, max));
    }

    function onUp(upEvent: PointerEvent): void {
      if (upEvent.pointerId !== pointerId) {
        return;
      }
      handle.releasePointerCapture?.(pointerId);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      setLayoutResizing(false);
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  function onDialogResizePointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) {
      return;
    }
    const target = sizeTarget();
    if (!target) {
      return;
    }
    const surface: HTMLElement = target;
    event.preventDefault();
    event.stopPropagation();
    const pointerId = event.pointerId;
    const originX = event.clientX;
    const originY = event.clientY;
    const startWidth = surface.getBoundingClientRect().width;
    const startHeight = surface.getBoundingClientRect().height;
    const handle = event.currentTarget;
    handle.setPointerCapture?.(pointerId);
    setLayoutResizing(true);

    function onMove(moveEvent: PointerEvent): void {
      if (moveEvent.pointerId !== pointerId) {
        return;
      }
      const maxWidth = Math.max(HOST_PICKER_DIALOG_MIN_WIDTH, window.innerWidth - 40);
      const maxHeight = Math.max(HOST_PICKER_DIALOG_MIN_HEIGHT, window.innerHeight - 48);
      surface.style.width = `${clampPickerMeasure(
        startWidth + (moveEvent.clientX - originX),
        HOST_PICKER_DIALOG_MIN_WIDTH,
        maxWidth,
      )}px`;
      surface.style.height = `${clampPickerMeasure(
        startHeight + (moveEvent.clientY - originY),
        HOST_PICKER_DIALOG_MIN_HEIGHT,
        maxHeight,
      )}px`;
      surface.style.maxWidth = 'calc(100vw - 40px)';
      surface.style.maxHeight = 'calc(100dvh - 48px)';
    }

    function onUp(upEvent: PointerEvent): void {
      if (upEvent.pointerId !== pointerId) {
        return;
      }
      handle.releasePointerCapture?.(pointerId);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      setLayoutResizing(false);
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  const sidebarHome: HostPickerSidebarItem | null = homeListing
    ? { name: homeLabel(homeListing.homePath, zh), path: homeListing.homePath }
    : null;

  const canBack = history.index > 0;
  const canForward = history.index >= 0 && history.index < history.paths.length - 1;

  const lastColumnIndex = Math.max(0, columns.length - 1);

  return (
    <div
      ref={rootRef}
      className={`host-workspace-picker${layoutResizing ? ' is-resizing' : ''}`}
      data-testid="host-workspace-picker"
    >
      <header className="host-workspace-chrome">
        <div className="host-workspace-toolbar">
          <button
            type="button"
            className="host-workspace-nav-btn"
            disabled={!canBack || loading}
            data-testid="host-workspace-back"
            aria-label={zh ? '后退' : 'Back'}
            onClick={() => {
              const path = history.paths[history.index - 1];
              if (!path) {
                return;
              }
              pathDraftDirty.current = false;
              setHistory((prev) => ({ ...prev, index: prev.index - 1 }));
              void revealPath(path, { history: false });
            }}
          >
            <IconChevronLeft width={14} height={14} />
          </button>
          <button
            type="button"
            className="host-workspace-nav-btn"
            disabled={!canForward || loading}
            data-testid="host-workspace-forward"
            aria-label={zh ? '前进' : 'Forward'}
            onClick={() => {
              const path = history.paths[history.index + 1];
              if (!path) {
                return;
              }
              pathDraftDirty.current = false;
              setHistory((prev) => ({ ...prev, index: prev.index + 1 }));
              void revealPath(path, { history: false });
            }}
          >
            <IconChevronRight width={14} height={14} />
          </button>
          <input
            className="host-workspace-path-input"
            data-testid="project-path-input"
            value={pathDraft}
            spellCheck={false}
            onChange={(event) => {
              pathDraftDirty.current = true;
              setPathDraft(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void jumpTo(pathDraft.trim());
              }
            }}
            aria-label={zh ? '路径' : 'Path'}
          />
          <label className="host-workspace-search">
            <IconSearch width={14} height={14} />
            <input
              data-testid="host-workspace-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={zh ? '搜索' : 'Search'}
              spellCheck={false}
            />
          </label>
        </div>
      </header>
      <div className="host-workspace-body">
        <nav
          className="host-workspace-sidebar"
          aria-label={zh ? '位置' : 'Locations'}
          style={{ flexBasis: sidebarWidth, width: sidebarWidth, minWidth: sidebarWidth }}
        >
          <div className="host-workspace-sidebar-scroll">
          {recents.length > 0 ? (
            <div className="host-workspace-sidebar-group">
              <p>{zh ? '最近' : 'Recents'}</p>
              {recents.map((path) => {
                const name = path.split(/[/\\]/).filter(Boolean).pop() ?? path;
                return (
                  <button
                    key={path}
                    type="button"
                    className={directoryPath === path ? 'is-active' : undefined}
                    title={path}
                    onClick={() => void jumpTo(path)}
                  >
                    <IconFolder width={14} height={14} />
                    <span>{name}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
          {favorites.length > 0 ? (
            <div className="host-workspace-sidebar-group">
              <p>{zh ? '常用' : 'Favorites'}</p>
              {favorites.map((item) => (
                <button
                  key={item.path}
                  type="button"
                  className={directoryPath === item.path ? 'is-active' : undefined}
                  title={item.path}
                  onClick={() => void jumpTo(item.path)}
                >
                  {favoriteIcon(item.name)}
                  <span>{item.name}</span>
                </button>
              ))}
            </div>
          ) : null}
          <div className="host-workspace-sidebar-group">
            <p>{zh ? '位置' : 'Locations'}</p>
            {sidebarHome ? (
              <button
                type="button"
                className={directoryPath === sidebarHome.path ? 'is-active' : undefined}
                data-testid="host-workspace-home"
                title={sidebarHome.path}
                onClick={() => void jumpTo(sidebarHome.path)}
              >
                <IconLaptop width={14} height={14} />
                <span>{sidebarHome.name}</span>
              </button>
            ) : null}
          </div>
          </div>
          <ResizeHandle
            testId="host-workspace-sidebar-resizer"
            label={zh ? '调整侧栏宽度' : 'Resize sidebar'}
            kind="column"
            onPointerDown={(event) =>
              onHorizontalResizePointerDown(
                event,
                sidebarWidth,
                HOST_PICKER_SIDEBAR_MIN,
                HOST_PICKER_SIDEBAR_MAX,
                setSidebarWidth,
              )
            }
          />
        </nav>
        <div className="host-workspace-columns" role="list" ref={columnsRef}>
          {error ? (
            <p className="muted host-workspace-error" role="alert" data-testid="host-workspace-error">
              {error}
            </p>
          ) : null}
          {loading && columns.length === 0 ? (
            <p className="muted host-workspace-error">{zh ? '正在列出文件夹…' : 'Listing folders…'}</p>
          ) : null}
          {columns.map((column, columnIndex) => {
            const isLast = columnIndex === lastColumnIndex;
            const width = columnWidth(column.path);
            const entries = sortPickerEntries(
              isLast ? filterColumnEntries(column.entries, search) : column.entries,
            );
            return (
              <div
                key={`${column.path}:${columnIndex}`}
                className={`host-workspace-column${isLast ? ' is-last' : ''}`}
                data-testid="host-workspace-column"
                role="listbox"
                aria-label={column.path}
                style={
                  isLast
                    ? { flex: `1 0 ${width}px`, minWidth: width }
                    : { flex: `0 0 ${width}px`, width, minWidth: width }
                }
              >
                <div className="host-workspace-column-scroll">
                {entries.length === 0 ? (
                  <p className="muted host-workspace-empty">
                    {zh ? '没有可打开的项目' : 'Nothing to open'}
                  </p>
                ) : (
                  entries.map((entry) => {
                    const selected = pickerRowSelected(entry, focusPath);
                    const isDir = entry.kind === 'directory';
                    return (
                      <button
                        key={entry.path}
                        type="button"
                        className={`host-workspace-row${selected ? ' is-selected' : ''}${
                          isDir ? '' : ' is-file'
                        }`}
                        data-testid={isDir ? 'host-workspace-dir' : 'host-workspace-file'}
                        role="option"
                        aria-selected={selected}
                        title={entry.name}
                        onClick={() => {
                          void openEntry(entry, columnIndex);
                        }}
                        onDoubleClick={() => {
                          if (isDir) {
                            if (pickerMode === 'directory') {
                              props.onConfirm(entry.path);
                            }
                            return;
                          }
                          if (pickerMode === 'file') {
                            props.onConfirm(entry.path);
                          }
                        }}
                      >
                        {isDir ? <IconFolder width={14} height={14} /> : <IconFile width={14} height={14} />}
                        <span>{entry.name}</span>
                        {isDir ? <IconChevronRight width={10} height={10} /> : null}
                      </button>
                    );
                  })
                )}
                </div>
                {isLast ? null : (
                  <ResizeHandle
                    testId="host-workspace-col-resizer"
                    label={zh ? '调整列宽' : 'Resize column'}
                    kind="column"
                    onPointerDown={(event) =>
                      onHorizontalResizePointerDown(
                        event,
                        width,
                        HOST_PICKER_COLUMN_MIN,
                        HOST_PICKER_COLUMN_MAX,
                        (next) => {
                          setColumnWidthByPath((prev) => ({ ...prev, [column.path]: next }));
                        },
                      )
                    }
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
      <footer className="host-workspace-footer">
        <button type="button" className="host-workspace-footer-ghost" onClick={props.onCancel}>
          {zh ? '取消' : 'Cancel'}
        </button>
        <button
          type="button"
          className="host-workspace-footer-open"
          data-testid="open-project-btn"
          disabled={openDisabled}
          onClick={() => {
            if (!openDisabled) {
              props.onConfirm(confirmPath);
            }
          }}
        >
          {pickerMode === 'file' ? (zh ? '选择' : 'Choose') : zh ? '打开' : 'Open'}
        </button>
      </footer>
      <ResizeHandle
        testId="host-workspace-dialog-resizer"
        label={zh ? '调整窗口大小' : 'Resize window'}
        kind="corner"
        onPointerDown={onDialogResizePointerDown}
      />
    </div>
  );
}
