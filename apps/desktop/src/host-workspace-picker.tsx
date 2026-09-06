/**
 * Host directory browser: sidebar + column view, same shape as the OS
 * "Open workspace" window.
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
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
  directoryPathForOpen,
  favoritePathsFromListing,
  filterColumnEntries,
  replaceColumnsAfter,
  selectedEntryIsFile,
  selectedFilePath,
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
  const pathDraftDirty = useRef(false);

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

  function recordHistory(path: string): void {
    setHistory((prev) => {
      const paths = [...prev.paths.slice(0, prev.index + 1), path];
      return { paths, index: paths.length - 1 };
    });
  }

  async function showListing(
    data: HostListDirData,
    options?: { asNextFromColumn: number },
  ): Promise<void> {
    setError(null);
    const fromColumn = options?.asNextFromColumn;
    if (fromColumn !== undefined) {
      setColumns((prev) => replaceColumnsAfter(prev, fromColumn, data));
    } else {
      setColumns([data]);
    }
    setSelectedPath(data.path);
    if (!pathDraftDirty.current) {
      setPathDraft(data.path);
    }
    props.onCurrentPathChange(data.path);
    if (!homeListing && data.path === data.homePath) {
      setHomeListing(data);
    }
  }

  async function load(path: string | undefined, options?: { history?: boolean; asNextFromColumn?: number }): Promise<HostListDirData | null> {
    setLoading(true);
    setError(null);
    try {
      const data = await props.listDirectory(path);
      await showListing(
        data,
        options?.asNextFromColumn === undefined
          ? undefined
          : { asNextFromColumn: options.asNextFromColumn },
      );
      if (options?.history !== false) {
        recordHistory(data.path);
      }
      if (!homeListing && data.path !== data.homePath) {
        try {
          const home = await props.listDirectory(data.homePath);
          setHomeListing(home);
        } catch {
          // Sidebar favorites stay empty when home cannot be listed.
        }
      }
      return data;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      return null;
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(props.currentPath.trim() || undefined);
  }, []);

  async function openEntry(entry: HostDirEntry, columnIndex: number): Promise<void> {
    if (entry.kind !== 'directory') {
      setSelectedPath(entry.path);
      return;
    }
    pathDraftDirty.current = false;
    setSelectedPath(entry.path);
    setPathDraft(entry.path);
    props.onCurrentPathChange(entry.path);
    await load(entry.path, { asNextFromColumn: columnIndex });
  }

  async function jumpTo(path: string): Promise<void> {
    pathDraftDirty.current = false;
    setSearch('');
    await load(path);
  }

  const sidebarHome: HostPickerSidebarItem | null = homeListing
    ? { name: homeLabel(homeListing.homePath, zh), path: homeListing.homePath }
    : null;

  const canBack = history.index > 0;
  const canForward = history.index >= 0 && history.index < history.paths.length - 1;

  const lastColumnIndex = Math.max(0, columns.length - 1);

  return (
    <div className="host-workspace-picker" data-testid="host-workspace-picker">
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
              void load(path, { history: false });
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
              void load(path, { history: false });
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
        <nav className="host-workspace-sidebar" aria-label={zh ? '位置' : 'Locations'}>
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
                onClick={() => void jumpTo(sidebarHome.path)}
              >
                <IconLaptop width={14} height={14} />
                <span>{sidebarHome.name}</span>
              </button>
            ) : null}
          </div>
        </nav>
        <div className="host-workspace-columns" role="list">
          {error ? (
            <p className="muted host-workspace-error" role="alert" data-testid="host-workspace-error">
              {error}
            </p>
          ) : null}
          {loading && columns.length === 0 ? (
            <p className="muted host-workspace-error">{zh ? '正在列出文件夹…' : 'Listing folders…'}</p>
          ) : null}
          {columns.map((column, columnIndex) => {
            const entries = sortPickerEntries(
              columnIndex === lastColumnIndex ? filterColumnEntries(column.entries, search) : column.entries,
            );
            return (
              <div
                key={`${column.path}:${columnIndex}`}
                className="host-workspace-column"
                data-testid="host-workspace-column"
                role="listbox"
                aria-label={column.path}
              >
                {entries.length === 0 ? (
                  <p className="muted host-workspace-empty">
                    {zh ? '没有可打开的项目' : 'Nothing to open'}
                  </p>
                ) : (
                  entries.map((entry) => {
                    const selected = selectedPath === entry.path || directoryPath === entry.path;
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
    </div>
  );
}
