import { useEffect, useRef, useState } from 'react';
import type { HostCreateEntryInput, HostDirEntry, HostListDirData } from '@piwin/contracts';
import type { HostWorkspacePickerProps } from './host-workspace-picker-types.js';
import {
  directoryPathForOpen,
  favoritePathsFromListing,
  HOST_PICKER_MAX_ANCESTOR_COLUMNS,
  replaceColumnsAfter,
  selectedEntryIsFile,
  selectedFilePath,
  shouldListParentColumn,
} from './host-workspace-picker-nav.js';

type HistoryState = { paths: string[]; index: number };

export function useHostWorkspacePicker(props: HostWorkspacePickerProps) {
  const zh = props.locale === 'zh-CN';
  const pickerMode = props.mode ?? 'directory';
  const [columns, setColumns] = useState<HostListDirData[]>([]);
  const [homeListing, setHomeListing] = useState<HostListDirData | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | undefined>(undefined);
  const [search, setSearch] = useState('');
  const [includeHidden, setIncludeHidden] = useState(pickerMode === 'file');
  const [creating, setCreating] = useState(false);
  const creationPendingRef = useRef(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryState>({ paths: [], index: -1 });
  const [pathDraft, setPathDraft] = useState(props.currentPath);
  const pathDraftDirty = useRef(false);
  const requestIdRef = useRef(0);
  const homeListingRef = useRef<HostListDirData | null>(null);
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
  const locations = homeListing?.locations ?? [];
  const recents = (props.recents ?? []).filter((path) => path.trim().length > 0).slice(0, 8);
  const focusPath = selectedPath ?? directoryPath;

  function recordHistory(path: string): void {
    setHistory((prev) => {
      const paths = [...prev.paths.slice(0, prev.index + 1), path];
      return { paths, index: paths.length - 1 };
    });
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
    options?: { history?: boolean; includeHidden?: boolean },
  ): Promise<void> {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const target = await props.listDirectory(path, options?.includeHidden ?? includeHidden);
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
        const parent = await props.listDirectory(
          current.parentPath,
          options?.includeHidden ?? includeHidden,
        );
        if (requestId !== requestIdRef.current) {
          return;
        }
        chain.unshift(parent);
        current = parent;
      }
      setColumns(chain);
      commitPath(target.path);
      const homeColumn = chain.find(
        (column) => column.path === column.homePath || column.locations,
      );
      if (homeColumn) {
        setHomeListing(homeColumn);
      } else if (homeListingRef.current === null) {
        try {
          const home = await props.listDirectory(
            target.homePath,
            options?.includeHidden ?? includeHidden,
          );
          if (requestId !== requestIdRef.current) {
            return;
          }
          setHomeListing(home);
        } catch {
          // Sidebar failure is visible without discarding the browsable target.
          setError(
            zh ? '无法读取主目录中的常用位置。' : 'Could not load favorite locations from Home.',
          );
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
      const data = await props.listDirectory(directoryPathValue, includeHidden);
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

  async function refreshDirectory(path = directoryPath): Promise<void> {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const listing = await props.listDirectory(path, includeHidden);
      if (requestId !== requestIdRef.current) return;
      setColumns((previous) => previous.map((column) => (column.path === path ? listing : column)));
      if (listing.path === homeListingRef.current?.path) setHomeListing(listing);
      if (
        filePath &&
        columns
          .find((column) => column.path === path)
          ?.entries.some((entry) => entry.path === filePath) &&
        !listing.entries.some((entry) => entry.path === filePath)
      ) {
        setSelectedPath(listing.path);
      }
    } catch (caught) {
      if (requestId === requestIdRef.current)
        setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }

  async function toggleHidden(): Promise<void> {
    const hidden = !includeHidden;
    setIncludeHidden(hidden);
    const previousFile = filePath;
    await revealPath(directoryPath, { history: false, includeHidden: hidden });
    if (previousFile && (hidden || !previousFile.split(/[/\\]/).pop()?.startsWith('.'))) {
      setSelectedPath(previousFile);
    }
  }

  async function createEntry(input: HostCreateEntryInput): Promise<void> {
    if (!props.createEntry || creationPendingRef.current) return;
    creationPendingRef.current = true;
    setCreating(true);
    try {
      const entry = await props.createEntry(input);
      const hidden = includeHidden || entry.name.startsWith('.');
      setIncludeHidden(hidden);
      setSearch('');
      pathDraftDirty.current = false;
      await revealPath(entry.kind === 'directory' ? entry.path : input.parentPath, {
        includeHidden: hidden,
        history: entry.kind === 'directory' || input.parentPath !== directoryPath,
      });
      if (entry.kind === 'file') {
        // The Host bounds large listings; a newly created file must remain selectable.
        setColumns((previous) =>
          previous.map((column) =>
            column.path === input.parentPath &&
            !column.entries.some((item) => item.path === entry.path)
              ? { ...column, entries: [...column.entries, entry] }
              : column,
          ),
        );
        setSelectedPath(entry.path);
      }
    } finally {
      creationPendingRef.current = false;
      setCreating(false);
    }
  }

  return {
    columns,
    homeListing,
    selectedPath,
    search,
    setSearch,
    loading,
    error,
    history,
    setHistory,
    pathDraft,
    setPathDraft,
    pathDraftDirty,
    columnsRef,
    directoryPath,
    confirmPath,
    openDisabled: openDisabled || loading || creating,
    favorites,
    locations,
    recents,
    focusPath,
    revealPath,
    openEntry,
    jumpTo,
    includeHidden,
    creating,
    refreshDirectory,
    toggleHidden,
    createEntry,
  };
}
