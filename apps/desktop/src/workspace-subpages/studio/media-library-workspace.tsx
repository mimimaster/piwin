import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
} from 'react';
import type { HostCommand, HostResponse, MediaLibraryItem } from '@piwin/contracts';
import type { DesktopLocale } from '../../desktop-locale';
import {
  IconCompress,
  IconExpand,
  IconImage,
  IconSpark,
  IconStar,
  IconVideo,
} from '../../shell-icons';
import { LazyMediaTile } from './lazy-media-tile';
import { LibraryFileCard } from './library-file-card';
import { groupLibraryItemsByDate } from './library-date-groups';
import { useLocalMediaSrc } from './use-local-media-src';
import { useMediaLibrary, type MediaLibraryFilter } from './use-media-library';
import {
  DELETE_UNDO_WINDOW_MS,
  INSPIRATIONS,
  THUMB_FIT_STORAGE_KEY,
  kindFromInitial,
  loadStoredFavorites,
  loadStoredThumbFit,
  saveStoredFavorites,
  type ActiveKind,
  type ThumbFit,
  type ToastState,
} from './media-library-workspace-model';
import { MediaLibraryWorkspaceHeader } from './media-library-workspace-header';
import { MediaLibrarySelectionDock } from './media-library-selection-dock';
import { MediaLibraryWorkspaceOverlays } from './media-library-workspace-overlays';
import { MediaLibraryErrorState } from './media-library-error-state';
import { isWorkbenchHostTeardownError } from '../../workbench-host-teardown.js';

export type { MediaLibraryFilter };

export type MediaLibraryWorkspaceProps = {
  initialKind: MediaLibraryFilter;
  locale?: DesktopLocale;
  onClose: () => void;
  request: (command: HostCommand) => Promise<HostResponse>;
  refreshToken?: number;
  /** How long a deleted asset stays undoable before the host unlinks it. */
  deleteUndoWindowMs?: number;
  subscribeConnected?: ((listener: (connected: boolean) => void) => () => void) | undefined;
  /**
   * Drops `text` into the composer as a starting draft — attaching `item`
   * too when remixing a real asset — then closes the library. Omit to fall
   * back to copy-prompt-and-close (still useful for a host that hasn't
   * wired composer attachment).
   */
  onRemixToComposer?: (input: { text: string; item?: MediaLibraryItem }) => void;
};

export function MediaLibraryWorkspace(props: MediaLibraryWorkspaceProps): ReactElement {
  const isZh = props.locale === 'zh-CN';
  const t = (en: string, zh: string) => (isZh ? zh : en);

  const [kind, setKind] = useState<ActiveKind>(kindFromInitial(props.initialKind));
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [search, setSearch] = useState('');
  const [modelFilter, setModelFilter] = useState('all');
  const [sortDir, setSortDir] = useState<'newest' | 'oldest'>('newest');
  const [lightboxId, setLightboxId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(loadStoredFavorites);
  /**
   * Selection has no separate "mode" — it's just whether this set is
   * non-empty. Checking one box both starts and performs a selection;
   * there's nothing to enter or exit.
   */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [activeAssetId, setActiveAssetId] = useState<string | null>(null);
  const [pendingDeleteKeys, setPendingDeleteKeys] = useState<Set<string>>(new Set());
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [thumbFit, setThumbFit] = useState<ThumbFit>(loadStoredThumbFit);

  const resolveSrc = useLocalMediaSrc();
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const undoWindowMs = props.deleteUndoWindowMs ?? DELETE_UNDO_WINDOW_MS;
  /** Deletes staged but not yet sent to the host, keyed by `sessionId:assetId`. */
  const pendingItemsRef = useRef<Map<string, MediaLibraryItem>>(new Map());
  const pendingTimersRef = useRef<Map<string, number>>(new Map());
  /** Anchor for Shift-click range selection — the last item clicked or checked. */
  const lastSelectedIndexRef = useRef<number | null>(null);

  useEffect(() => {
    setKind(kindFromInitial(props.initialKind));
  }, [props.initialKind]);

  const toggleThumbFit = useCallback(() => {
    setThumbFit((prev) => {
      const next = prev === 'cover' ? 'contain' : 'cover';
      try {
        window.localStorage.setItem(THUMB_FIT_STORAGE_KEY, next);
      } catch {
        // Ignore storage write errors
      }
      return next;
    });
  }, []);

  const queryKind: MediaLibraryFilter =
    kind === 'favorite' ? 'all' : kind === 'all' ? 'all' : kind;

  const library = useMediaLibrary({
    kind: queryKind,
    request: props.request,
    query: search,
    refreshToken: props.refreshToken ?? 0,
    isZh,
    subscribeConnected: props.subscribeConnected,
  });

  const showToast = useCallback(
    (message: string, action?: { label: string; onAction: () => void; holdMs?: number }) => {
      const next: ToastState = action
        ? { message, actionLabel: action.label, onAction: action.onAction }
        : { message };
      setToast(next);
      window.setTimeout(
        () => {
          setToast((current) => (current === next ? null : current));
        },
        action?.holdMs ?? 2400,
      );
    },
    [],
  );

  const toggleFavorite = useCallback((key: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      saveStoredFavorites(next);
      return next;
    });
  }, []);

  /**
   * A mixed selection toggled item-by-item flips each one independently —
   * favorited items lose the star, unfavorited ones gain it, and the net
   * effect looks arbitrary. One shared verdict instead: any unfavorited item
   * in the selection means "favorite all of them"; a fully-favorited
   * selection means "clear all of them".
   */
  const setFavoritesBatch = useCallback((keys: readonly string[], favorited: boolean) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      for (const key of keys) {
        if (favorited) next.add(key);
        else next.delete(key);
      }
      saveStoredFavorites(next);
      return next;
    });
  }, []);

  /** Models actually present in the catalog, most-used first. */
  const modelOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of library.items) {
      const model = item.model?.trim();
      if (model) counts.set(model, (counts.get(model) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([model, count]) => ({ model, count }));
  }, [library.items]);

  // A filter pinned to a model that paged out of the catalog would silently
  // empty the grid, so drop back to "all" instead.
  useEffect(() => {
    if (modelFilter !== 'all' && !modelOptions.some((option) => option.model === modelFilter)) {
      setModelFilter('all');
    }
  }, [modelFilter, modelOptions]);

  const visibleItems = useMemo(() => {
    let next = library.items.filter(
      (item) => !pendingDeleteKeys.has(`${item.sessionId}:${item.assetId}`),
    );
    if (kind === 'favorite') {
      next = next.filter((item) => favorites.has(`${item.sessionId}:${item.assetId}`));
    }
    if (modelFilter !== 'all') {
      next = next.filter((item) => item.model === modelFilter);
    }
    next.sort((left, right) => {
      const delta = Date.parse(left.createdAt) - Date.parse(right.createdAt);
      return sortDir === 'newest' ? -delta : delta;
    });
    return next;
  }, [library.items, kind, favorites, modelFilter, sortDir, pendingDeleteKeys]);

  /** Favorites and the model filter run client-side over the loaded pages. */
  const clientFilterActive = kind === 'favorite' || modelFilter !== 'all';

  // `total` is the host's count for the current tab + search; `items.length`
  // covers fakes and hosts that omit it.
  const catalogTotal = Math.max(library.total, library.items.length) - pendingDeleteKeys.size;

  // ...so a match sitting on page 3 would otherwise render as "no results".
  // Keep pulling pages while a client-side filter has nothing to show.
  useEffect(() => {
    if (!clientFilterActive) return;
    if (visibleItems.length > 0) return;
    // A failed page leaves the cursor in place, so without this the scan would
    // retry the same broken request forever.
    if (library.error !== null) return;
    if (!library.hasMore || library.loading || library.loadingMore) return;
    library.loadMore();
  }, [
    clientFilterActive,
    visibleItems.length,
    library.error,
    library.hasMore,
    library.loading,
    library.loadingMore,
    library.loadMore,
  ]);

  // Leaving the page commits whatever is still staged: the user asked for the
  // delete, and an undo toast they can no longer see is not a reprieve.
  const deleteAssetRef = useRef(library.deleteAsset);
  deleteAssetRef.current = library.deleteAsset;
  useEffect(() => {
    const timers = pendingTimersRef.current;
    const items = pendingItemsRef.current;
    return () => {
      for (const timer of timers.values()) {
        window.clearTimeout(timer);
      }
      timers.clear();
      for (const item of items.values()) {
        void deleteAssetRef.current(item);
      }
      items.clear();
    };
  }, []);

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !library.hasMore) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting === true) library.loadMore();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [library.hasMore, library.loadMore, visibleItems.length]);

  // Keyboard shortcut support
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (batchDeleteOpen) setBatchDeleteOpen(false);
        else if (lightboxId !== null) setLightboxId(null);
        else if (selectedIds.size > 0) setSelectedIds(new Set());
        else if (inspectorOpen) setInspectorOpen(false);
        else props.onClose();
      } else if (event.key === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        searchInputRef.current?.focus();
      } else if ((event.key === 'a' || event.key === 'A') && (event.metaKey || event.ctrlKey)) {
        // Selection has no separate mode to gate this on — same as Finder,
        // ⌘A just selects everything in the window, except inside a field.
        const activeEl = document.activeElement;
        const isEditable =
          activeEl instanceof HTMLInputElement ||
          activeEl instanceof HTMLTextAreaElement ||
          (activeEl instanceof HTMLElement && activeEl.isContentEditable);
        if (isEditable) return;
        event.preventDefault();
        setSelectedIds(new Set(visibleItems.map((i) => `${i.sessionId}:${i.assetId}`)));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [batchDeleteOpen, lightboxId, selectedIds.size, inspectorOpen, visibleItems, props.onClose]);

  const copyPrompt = useCallback(
    (text: string, id: string) => {
      void navigator.clipboard.writeText(text).catch(() => undefined);
      setCopiedId(id);
      showToast(t('Prompt copied to clipboard 📋', '提示词已复制到剪贴板 📋'));
      window.setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 1500);
    },
    [showToast, t],
  );

  const unstage = useCallback((key: string) => {
    setPendingDeleteKeys((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }, []);

  const commitDelete = useCallback(
    async (item: MediaLibraryItem): Promise<void> => {
      const key = `${item.sessionId}:${item.assetId}`;
      const timer = pendingTimersRef.current.get(key);
      if (timer !== undefined) {
        window.clearTimeout(timer);
        pendingTimersRef.current.delete(key);
      }
      pendingItemsRef.current.delete(key);
      const deleted = await library.deleteAsset(item);
      // `deleteAsset` drops the row on success; on failure the tile has to come
      // back, otherwise it stays hidden behind a delete that never happened.
      unstage(key);
      if (!deleted) {
        showToast(t('Could not delete that asset', '删除失败，素材已恢复'));
      }
    },
    [library.deleteAsset, unstage, showToast, t],
  );

  /**
   * Hide the tile now, unlink after the undo window. Anything still staged when
   * the page unmounts is committed by the flush effect below.
   */
  const deleteItem = useCallback(
    (item: MediaLibraryItem) => {
      const key = `${item.sessionId}:${item.assetId}`;
      if (pendingItemsRef.current.has(key)) return;
      pendingItemsRef.current.set(key, item);
      setPendingDeleteKeys((prev) => new Set(prev).add(key));
      if (lightboxId === key) setLightboxId(null);
      if (activeAssetId === key) setActiveAssetId(null);

      const timer = window.setTimeout(() => {
        void commitDelete(item);
      }, undoWindowMs);
      pendingTimersRef.current.set(key, timer);

      showToast(t('Asset deleted', '已从资料库移除'), {
        label: t('Undo', '撤销'),
        holdMs: undoWindowMs,
        onAction: () => {
          const staged = pendingTimersRef.current.get(key);
          if (staged !== undefined) {
            window.clearTimeout(staged);
            pendingTimersRef.current.delete(key);
          }
          pendingItemsRef.current.delete(key);
          unstage(key);
          setToast(null);
        },
      });
    },
    [lightboxId, activeAssetId, commitDelete, undoWindowMs, unstage, showToast, t],
  );

  const deleteBatch = useCallback(() => {
    if (selectedIds.size === 0) return;
    const toDelete = library.items.filter((i) => selectedIds.has(`${i.sessionId}:${i.assetId}`));
    const count = toDelete.length;
    setBatchDeleteOpen(false);
    void Promise.all(toDelete.map((i) => library.deleteAsset(i))).then(() => {
      showToast(t(`Deleted ${count} assets`, `已批量删除 ${count} 项素材`));
      setSelectedIds(new Set());
    });
  }, [selectedIds, library.items, library.deleteAsset, showToast, t]);

  const toggleSelect = useCallback((key: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(
    (checked: boolean) => {
      if (checked) {
        setSelectedIds(new Set(visibleItems.map((i) => `${i.sessionId}:${i.assetId}`)));
      } else {
        setSelectedIds(new Set());
      }
    },
    [visibleItems],
  );

  /** Position of each visible item, for Shift-click range selection. */
  const indexByKey = useMemo(() => {
    const map = new Map<string, number>();
    visibleItems.forEach((item, index) => {
      map.set(`${item.sessionId}:${item.assetId}`, index);
    });
    return map;
  }, [visibleItems]);

  const selectRange = useCallback(
    (fromIndex: number, toIndex: number) => {
      const [start, end] = fromIndex <= toIndex ? [fromIndex, toIndex] : [toIndex, fromIndex];
      const range = visibleItems
        .slice(start, end + 1)
        .map((item) => `${item.sessionId}:${item.assetId}`);
      setSelectedIds((prev) => new Set([...prev, ...range]));
    },
    [visibleItems],
  );

  const selectAt = useCallback(
    (key: string, index: number) => {
      toggleSelect(key);
      lastSelectedIndexRef.current = index;
    },
    [toggleSelect],
  );

  const currentLightboxIndex = visibleItems.findIndex(
    (item) => `${item.sessionId}:${item.assetId}` === lightboxId,
  );
  const lightboxItem =
    currentLightboxIndex >= 0 ? (visibleItems[currentLightboxIndex] ?? null) : null;

  const activeInspectorItem = useMemo(() => {
    return (
      visibleItems.find((i) => `${i.sessionId}:${i.assetId}` === activeAssetId) ??
      visibleItems[0] ??
      null
    );
  }, [visibleItems, activeAssetId]);

  // Nothing is highlighted until the user picks something. While the inspector
  // is open the ring tracks whatever the panel is actually showing.
  const highlightKey =
    inspectorOpen && activeInspectorItem !== null
      ? `${activeInspectorItem.sessionId}:${activeInspectorItem.assetId}`
      : activeAssetId;

  const navigateLightbox = useCallback(
    (direction: 'prev' | 'next') => {
      if (currentLightboxIndex < 0 || visibleItems.length === 0) return;
      const nextIndex =
        direction === 'prev'
          ? (currentLightboxIndex - 1 + visibleItems.length) % visibleItems.length
          : (currentLightboxIndex + 1) % visibleItems.length;
      const target = visibleItems[nextIndex];
      if (target) setLightboxId(`${target.sessionId}:${target.assetId}`);
    },
    [currentLightboxIndex, visibleItems],
  );

  const openInspectorFor = useCallback((itemKey: string) => {
    setActiveAssetId(itemKey);
    setInspectorOpen(true);
  }, []);

  /**
   * The click that would otherwise open the inspector. Shift extends a
   * range from the last click; ⌘/Ctrl toggles just this one; with nothing
   * held, a click while a selection is already live continues that
   * selection instead of navigating away from it — only a "clean" click
   * with no selection active opens the inspector.
   */
  const handleTileClick = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement> | undefined, item: MediaLibraryItem) => {
      const itemKey = `${item.sessionId}:${item.assetId}`;
      const index = indexByKey.get(itemKey) ?? -1;

      if (event?.shiftKey && lastSelectedIndexRef.current !== null && index >= 0) {
        event.preventDefault();
        selectRange(lastSelectedIndexRef.current, index);
        lastSelectedIndexRef.current = index;
        return;
      }
      if (event?.metaKey || event?.ctrlKey) {
        event.preventDefault();
        selectAt(itemKey, index);
        return;
      }
      if (selectedIds.size > 0) {
        selectAt(itemKey, index);
        return;
      }
      openInspectorFor(itemKey);
    },
    [indexByKey, selectRange, selectAt, selectedIds.size, openInspectorFor],
  );

  const dateGroups = useMemo(
    () => groupLibraryItemsByDate(visibleItems, { isZh }),
    [visibleItems, isZh],
  );

  /**
   * Attaches the asset and drops its prompt into the composer when the host
   * has wired that up; otherwise falls back to the old copy-and-close so the
   * action never silently does nothing.
   */
  const remixItem = useCallback(
    (item: MediaLibraryItem) => {
      const text = item.prompt ?? item.name ?? item.assetId;
      if (props.onRemixToComposer) {
        props.onRemixToComposer({ text, item });
        return;
      }
      copyPrompt(text, item.assetId);
      props.onClose();
    },
    [props, copyPrompt],
  );

  /** Same as {@link remixItem} for a template prompt with no backing asset. */
  const remixPromptText = useCallback(
    (text: string, copyId: string) => {
      if (props.onRemixToComposer) {
        props.onRemixToComposer({ text });
        return;
      }
      copyPrompt(text, copyId);
      props.onClose();
    },
    [props, copyPrompt],
  );

  const focusTileAt = useCallback((index: number) => {
    const container = gridRef.current;
    if (!container) return;
    const nodes = container.querySelectorAll<HTMLElement>('.lib-card-open, .lib-row-open');
    if (nodes.length === 0) return;
    const clamped = Math.max(0, Math.min(nodes.length - 1, index));
    const target = nodes[clamped];
    target?.focus();
    target?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, []);

  /**
   * Arrow/Home/End/Space/Delete over the tile grid. Column count is read
   * live from the grid the focused tile sits in (auto-fill resolves to a
   * literal column list in computed style), so it tracks the actual layout
   * without a resize listener. Each date group renders its own CSS grid, so
   * Up/Down near a group boundary can land a column off — a fair trade for
   * not maintaining a synthetic 2D index across groups.
   */
  const handleGridKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const rawTarget = event.target as HTMLElement;
      const target =
        rawTarget.classList?.contains('lib-card-open') || rawTarget.classList?.contains('lib-row-open')
          ? rawTarget
          : (document.activeElement as HTMLElement | null);
      if (!target || (!target.classList?.contains('lib-card-open') && !target.classList?.contains('lib-row-open'))) {
        return;
      }
      const container = gridRef.current;
      if (!container) return;
      const nodes = Array.from(
        container.querySelectorAll<HTMLElement>('.lib-card-open, .lib-row-open'),
      );
      const currentIndex = nodes.indexOf(target);
      if (currentIndex < 0) return;

      switch (event.key) {
        case 'ArrowRight':
          event.preventDefault();
          focusTileAt(currentIndex + 1);
          return;
        case 'ArrowLeft':
          event.preventDefault();
          focusTileAt(currentIndex - 1);
          return;
        case 'ArrowDown':
        case 'ArrowUp': {
          event.preventDefault();
          let columns = 1;
          if (viewMode === 'grid') {
            const gridEl = target.closest('.lib-grid');
            const template = gridEl
              ? window.getComputedStyle(gridEl).gridTemplateColumns.trim()
              : '';
            columns = template ? template.split(/\s+/).filter(Boolean).length : 1;
          }
          const delta = event.key === 'ArrowDown' ? columns : -columns;
          focusTileAt(currentIndex + delta);
          return;
        }
        case 'Home':
          event.preventDefault();
          focusTileAt(0);
          return;
        case 'End':
          event.preventDefault();
          focusTileAt(nodes.length - 1);
          return;
        case ' ':
        case 'Spacebar': {
          // Space previews in the lightbox; Enter still opens the inspector
          // through the button's native click.
          const item = visibleItems[currentIndex];
          if (item && item.kind !== 'file') {
            event.preventDefault();
            setLightboxId(`${item.sessionId}:${item.assetId}`);
          }
          return;
        }
        case 'Delete':
        case 'Backspace': {
          event.preventDefault();
          // A live multi-selection wins: Delete acts on the whole
          // selection (through its own confirm, no per-item undo) rather
          // than the one tile that happens to be focused.
          if (selectedIds.size > 0) {
            setBatchDeleteOpen(true);
            return;
          }
          const item = visibleItems[currentIndex];
          if (item) deleteItem(item);
          return;
        }
        default:
          return;
      }
    },
    [visibleItems, viewMode, selectedIds.size, deleteItem, focusTileAt],
  );

  const emptyTitle =
    kind === 'video'
      ? t('No videos yet', '还没有视频')
      : kind === 'favorite'
        ? t('No favorites yet', '暂无收藏素材')
        : t('No images yet', '还没有图片');

  const emptyDetail =
    kind === 'video'
      ? t('Videos generated in chat land here.', '会话里生成的视频会出现在这里。在对话中输入提示词让 AI 创作。')
      : kind === 'favorite'
        ? t('Star assets to save them in your favorites.', '点击素材卡片上的星标即可收藏。')
        : t('Images generated in chat land here.', '会话里生成的图片会出现在这里。在对话中输入提示词让 AI 为你生成作品。');

  return (
    <div className="vault-stage lib-page" data-testid="library-workspace">
      <MediaLibraryWorkspaceHeader
        translate={t}
        kind={kind}
        onKindChange={setKind}
        clientFilterActive={clientFilterActive}
        visibleCount={visibleItems.length}
        catalogTotal={catalogTotal}
        modelOptions={modelOptions}
        modelFilter={modelFilter}
        onModelFilterChange={setModelFilter}
        searchInputRef={searchInputRef}
        search={search}
        onSearchChange={setSearch}
        sortDir={sortDir}
        onSortDirChange={setSortDir}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        inspectorOpen={inspectorOpen}
        onInspectorToggle={() => setInspectorOpen((current) => !current)}
        onClose={props.onClose}
      />

      {/* ── Tier 3: Main Canvas & Inspector Drawer ──────────────────── */}
      <div className="lib-canvas">
        <div className="lib-main">
          {viewMode === 'grid' && visibleItems.length > 0 ? (
            <button
              type="button"
              className={`lib-thumb-fit-float${thumbFit === 'contain' ? ' is-active' : ''}`}
              onClick={toggleThumbFit}
              data-testid="library-thumb-fit-btn"
              title={
                thumbFit === 'contain'
                  ? t('Showing whole image (no crop)', '完整显示（不裁切）')
                  : t('Filling the frame (may crop)', '填满画框（可能裁切）')
              }
              aria-label={
                thumbFit === 'contain'
                  ? t('Showing whole image (no crop)', '完整显示（不裁切）')
                  : t('Filling the frame (may crop)', '填满画框（可能裁切）')
              }
            >
              {thumbFit === 'contain' ? (
                <IconExpand width={13} height={13} aria-hidden="true" />
              ) : (
                <IconCompress width={13} height={13} aria-hidden="true" />
              )}
            </button>
          ) : null}
          <main
            className={`lib-body${selectedIds.size > 0 ? ' has-dock' : ''}`}
            id="vault-main"
          >
          {library.loading && library.items.length === 0 ? (
            <div className="lib-state">
              <span className="lib-state-dot" aria-hidden="true" />
              <p>{t('Loading…', '加载中…')}</p>
            </div>
          ) : visibleItems.length === 0 &&
            clientFilterActive &&
            library.hasMore &&
            library.error === null ? (
            <div className="lib-state" data-testid="library-filter-scanning">
              <span className="lib-state-dot" aria-hidden="true" />
              <p>{t('Searching the rest of the library…', '正在检索资料库其余部分…')}</p>
            </div>
          ) : library.error && library.items.length === 0 ? (
            <MediaLibraryErrorState
              error={library.error}
              isTeardown={isWorkbenchHostTeardownError(library.error)}
              onRetry={library.reload}
              onClose={props.onClose}
              locale={props.locale}
            />
          ) : visibleItems.length > 0 ? (
            <>
              <div
                ref={gridRef}
                onKeyDown={handleGridKeyDown}
                data-testid="library-tile-nav-region"
              >
                {dateGroups.map((group) => (
                  <section key={group.key} className="lib-date-group">
                    <h3 className="lib-date-group-label">{group.label}</h3>
                    <div className={viewMode === 'list' ? 'lib-list' : 'lib-grid'}>
                      {group.items.map((item) => {
                        const itemKey = `${item.sessionId}:${item.assetId}`;
                        const isFav = favorites.has(itemKey);
                        const isSelected = selectedIds.has(itemKey);
                        const isActive = highlightKey === itemKey;

                        if (item.kind === 'file') {
                          return (
                            <LibraryFileCard
                              key={itemKey}
                              item={{
                                assetId: item.assetId,
                                byteSize: item.byteSize,
                                createdAt: item.createdAt,
                                mimeType: item.mimeType,
                                kind: 'file',
                                viewMode,
                                ...(item.name !== undefined ? { name: item.name } : {}),
                                ...(item.prompt !== undefined ? { prompt: item.prompt } : {}),
                              }}
                              locale={isZh ? 'zh-CN' : 'en'}
                              openLabel={t('Open file', '打开文件')}
                              deleteLabel={t('Delete', '删除')}
                              selectLabel={t('Select', '选择')}
                              selectionActive={selectedIds.size > 0}
                              isSelected={isSelected}
                              onToggleSelect={() =>
                                selectAt(itemKey, indexByKey.get(itemKey) ?? -1)
                              }
                              onOpen={(event) => handleTileClick(event, item)}
                              onFocus={() => setActiveAssetId(itemKey)}
                              onDelete={() => deleteItem(item)}
                            />
                          );
                        }

                        return (
                          <LazyMediaTile
                            key={itemKey}
                            item={item}
                            request={props.request}
                            locale={isZh ? 'zh-CN' : 'en'}
                            deleteLabel={t('Delete', '删除')}
                            viewMode={viewMode}
                            copyLabel={t('Copy prompt', '复制提示词')}
                            copied={copiedId === item.assetId}
                            favorite={isFav}
                            favoriteLabel={t('Favorite', '收藏')}
                            favoritedLabel={t('Favorited', '已收藏')}
                            selectLabel={t('Select', '选择')}
                            remixLabel={t('Remix in Chat', '在会话中重绘')}
                            fullscreenLabel={t('Fullscreen', '全屏')}
                            onToggleFavorite={() => toggleFavorite(itemKey)}
                            selectionActive={selectedIds.size > 0}
                            isSelected={isSelected}
                            onToggleSelect={() =>
                              selectAt(itemKey, indexByKey.get(itemKey) ?? -1)
                            }
                            isActive={isActive}
                            onFocus={() => setActiveAssetId(itemKey)}
                            onOpen={(event) => handleTileClick(event, item)}
                            onOpenLightbox={() => setLightboxId(itemKey)}
                            onCopyPrompt={() =>
                              copyPrompt(item.prompt ?? item.name ?? item.assetId, item.assetId)
                            }
                            onDelete={() => deleteItem(item)}
                            onRemix={() => remixItem(item)}
                            onAfterAddToChat={props.onClose}
                            showModel={modelOptions.length > 1}
                            thumbFit={thumbFit}
                          />
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
              <div ref={sentinelRef} className="lib-sentinel" aria-hidden="true" />
              {library.loadingMore ? (
                <p className="lib-more">{t('Loading more…', '加载更多…')}</p>
              ) : null}
            </>
          ) : (
            /* Grand Inspiring Onboarding Showcase when 0 items */
            <div className="lib-empty-showcase">
              <div className="lib-empty-hero-card">
                <div className="lib-empty-icon-box">
                  {kind === 'video' ? (
                    <IconVideo width={28} height={28} aria-hidden="true" />
                  ) : kind === 'favorite' ? (
                    <IconStar width={28} height={28} aria-hidden="true" />
                  ) : (
                    <IconImage width={28} height={28} aria-hidden="true" />
                  )}
                </div>
                <h2 className="lib-empty-title">{emptyTitle}</h2>
                <p className="lib-empty-detail">{emptyDetail}</p>
                <div className="lib-empty-cta-row">
                  <button
                    type="button"
                    className="lib-cta-primary"
                    onClick={props.onClose}
                  >
                    <IconSpark width={14} height={14} aria-hidden="true" />
                    <span>{t('Generate in chat', '在会话中生成')}</span>
                  </button>
                  <button
                    type="button"
                    className="lib-cta-secondary"
                    onClick={() => remixPromptText(INSPIRATIONS[0]!.prompt, 'insp-0')}
                  >
                    <span>{t('Use prompt template', '使用灵感模板')}</span>
                  </button>
                </div>
              </div>

              {/* Inspiration Presets */}
              <div className="lib-inspiration-section">
                <div className="lib-inspiration-head">
                  <span className="lib-inspiration-title">
                    {t('Creative Inspiration & Prompts', '提示词灵感推荐')}
                  </span>
                </div>
                <div className="lib-inspiration-grid">
                  {INSPIRATIONS.map((insp, idx) => (
                    <div
                      key={insp.title}
                      className="lib-inspiration-card"
                      onClick={() => remixPromptText(insp.prompt, `insp-${idx}`)}
                    >
                      <span className="lib-inspiration-card-tag">{insp.model}</span>
                      <strong className="text-white text-xs font-semibold">{insp.title}</strong>
                      <p className="lib-inspiration-card-prompt">{insp.prompt}</p>
                      <span className="lib-inspiration-card-action">
                        {t('Click to generate →', '点击采用并生成 →')}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </main>

          <MediaLibrarySelectionDock
            translate={t}
            isZh={isZh}
            selectedIds={selectedIds}
            visibleCount={visibleItems.length}
            favorites={favorites}
            setFavoritesBatch={setFavoritesBatch}
            onToggleSelectAll={toggleSelectAll}
            onOpenBatchDelete={() => setBatchDeleteOpen(true)}
            onDeselect={() => setSelectedIds(new Set())}
            onShowToast={showToast}
          />
        </div>

        <MediaLibraryWorkspaceOverlays
          translate={t}
          selectedIds={selectedIds}
          inspectorOpen={inspectorOpen}
          activeInspectorItem={activeInspectorItem}
          onCloseInspector={() => setInspectorOpen(false)}
          locale={props.locale}
          request={props.request}
          resolveSrc={resolveSrc}
          onOpenInspectorLightbox={() => {
            if (activeInspectorItem) {
              setLightboxId(`${activeInspectorItem.sessionId}:${activeInspectorItem.assetId}`);
            }
          }}
          onDeleteInspectorItem={() => {
            if (activeInspectorItem) deleteItem(activeInspectorItem);
          }}
          onCopyInspectorPrompt={(text) => copyPrompt(text, activeInspectorItem?.assetId ?? '')}
          inspectorCopied={copiedId === activeInspectorItem?.assetId}
          onRemixInspectorItem={() => {
            if (activeInspectorItem) remixItem(activeInspectorItem);
          }}
          lightboxItem={lightboxItem}
          lightboxCopied={lightboxItem !== null && copiedId === lightboxItem.assetId}
          onCloseLightbox={() => setLightboxId(null)}
          onCopyLightboxPrompt={() => {
            if (lightboxItem) {
              copyPrompt(
                lightboxItem.prompt ?? lightboxItem.name ?? lightboxItem.assetId,
                lightboxItem.assetId,
              );
            }
          }}
          onDeleteLightboxItem={() => {
            if (lightboxItem) deleteItem(lightboxItem);
          }}
          onRemixLightboxItem={() => {
            if (lightboxItem) remixItem(lightboxItem);
          }}
          onAfterAddToChat={props.onClose}
          {...(visibleItems.length > 1
            ? { onPrevLightbox: () => navigateLightbox('prev') }
            : {})}
          {...(visibleItems.length > 1
            ? { onNextLightbox: () => navigateLightbox('next') }
            : {})}
          currentLightboxIndex={currentLightboxIndex}
          totalLightboxCount={visibleItems.length}
          batchDeleteOpen={batchDeleteOpen}
          onCloseBatchDelete={() => setBatchDeleteOpen(false)}
          onDeleteBatch={deleteBatch}
          toast={toast}
        />
      </div>
    </div>
  );
}
