import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import type { HostCommand, HostResponse, MediaLibraryItem } from '@piwin/contracts';
import { DropdownMenu, DropdownMenuItem } from '@piwin/ui-kit';
import type { DesktopLocale } from '../../desktop-locale';
import {
  IconCheck,
  IconChevronDown,
  IconChevronLeft,
  IconClose,
  IconFile,
  IconGrid,
  IconImage,
  IconMenuList,
  IconPanelRight,
  IconSearch,
  IconSliders,
  IconSpark,
  IconStar,
  IconTrash,
  IconVideo,
} from '../../shell-icons';
import { WindowDragRegion, handleNativeWindowDragMouseDown } from '../../native-window-drag';
import { usePlayableLibrarySrc } from './use-playable-library-src';
import { MediaLightbox } from './media-lightbox';
import { LazyMediaTile } from './lazy-media-tile';
import { LibraryFileCard } from './library-file-card';
import { LibraryInspectorDrawer } from './library-inspector-drawer';
import { useLocalMediaSrc } from './use-local-media-src';
import { useMediaLibrary, type MediaLibraryFilter } from './use-media-library';

export type { MediaLibraryFilter };

export type MediaLibraryWorkspaceProps = {
  initialKind: MediaLibraryFilter;
  locale?: DesktopLocale;
  onClose: () => void;
  request: (command: HostCommand) => Promise<HostResponse>;
  refreshToken?: number;
};

type ActiveKind = 'all' | 'image' | 'video' | 'file' | 'favorite';

const KIND_TABS: Array<{
  id: ActiveKind;
  en: string;
  zh: string;
}> = [
  { id: 'image', en: 'Images', zh: '图片' },
  { id: 'video', en: 'Videos', zh: '视频' },
  { id: 'file', en: 'Files', zh: '文件' },
  { id: 'favorite', en: 'Favorites', zh: '收藏' },
];

function kindFromInitial(kind: MediaLibraryFilter): ActiveKind {
  if (kind === 'video' || kind === 'file') {
    return kind;
  }
  return 'image';
}

const INSPIRATIONS = [
  {
    model: 'FLUX.1 Pro',
    title: '赛博朋克雨夜街道',
    prompt:
      'A cinematic hyper-realistic cyberpunk Tokyo street at rainy midnight, neon holographic reflections, 8k octane render.',
  },
  {
    model: 'Midjourney v6.1',
    title: '极简黑曜石发光 UI',
    prompt:
      'Futuristic spatial UI design on obsidian glass, glowing subtle indigo gradients, clean typography, minimalist modern.',
  },
  {
    model: 'Runway Gen-3',
    title: '未来流体超跑 (4K 视频)',
    prompt:
      'Dynamic fluid chrome hypercar accelerating through neon grid tunnel, particle trail explosion, cinematic 60fps slow motion.',
  },
  {
    model: 'DALL-E 3',
    title: '深空星云宇航员',
    prompt:
      'Astronaut standing on an asteroid looking at a massive swirling violet and cyan cosmic nebula, Hubble telescope quality.',
  },
];

const FAVORITES_STORAGE_KEY = 'piwin.media_vault.favorites';

function loadStoredFavorites(): Set<string> {
  try {
    const raw = window.localStorage.getItem(FAVORITES_STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function saveStoredFavorites(set: Set<string>): void {
  try {
    window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(Array.from(set)));
  } catch {
    // Ignore storage write errors
  }
}

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
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(loadStoredFavorites);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBatchMode, setIsBatchMode] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [activeAssetId, setActiveAssetId] = useState<string | null>(null);

  const resolveSrc = useLocalMediaSrc();
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setKind(kindFromInitial(props.initialKind));
  }, [props.initialKind]);

  const queryKind: MediaLibraryFilter =
    kind === 'favorite' ? 'all' : kind === 'all' ? 'all' : kind;

  const library = useMediaLibrary({
    kind: queryKind,
    request: props.request,
    query: search,
    refreshToken: props.refreshToken ?? 0,
  });

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    window.setTimeout(() => {
      setToastMsg((current) => (current === msg ? null : current));
    }, 2400);
  }, []);

  const toggleFavorite = useCallback((key: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      saveStoredFavorites(next);
      return next;
    });
  }, []);

  const visibleItems = useMemo(() => {
    let next = library.items.slice();
    if (kind === 'favorite') {
      next = next.filter((item) => favorites.has(`${item.sessionId}:${item.assetId}`));
    }
    if (modelFilter !== 'all') {
      next = next.filter((item) => item.model?.toLowerCase().includes(modelFilter.toLowerCase()));
    }
    next.sort((left, right) => {
      const delta = Date.parse(left.createdAt) - Date.parse(right.createdAt);
      return sortDir === 'newest' ? -delta : delta;
    });
    return next;
  }, [library.items, kind, favorites, modelFilter, sortDir]);

  // Set default active asset for inspector
  useEffect(() => {
    if (visibleItems.length > 0 && !activeAssetId) {
      const first = visibleItems[0];
      if (first) setActiveAssetId(`${first.sessionId}:${first.assetId}`);
    }
  }, [visibleItems, activeAssetId]);

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
        if (lightboxId !== null) setLightboxId(null);
        else if (isBatchMode) setIsBatchMode(false);
        else if (inspectorOpen) setInspectorOpen(false);
        else props.onClose();
      } else if (event.key === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightboxId, isBatchMode, inspectorOpen, props.onClose]);

  const copyPrompt = useCallback(
    (text: string, id: string) => {
      void navigator.clipboard.writeText(text).catch(() => undefined);
      setCopiedId(id);
      showToast(t('Prompt copied to clipboard 📋', '提示词已复制到剪贴板 📋'));
      window.setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 1500);
    },
    [showToast, t],
  );

  const deleteItem = useCallback(
    (item: MediaLibraryItem) => {
      void library.deleteAsset(item).then((deleted) => {
        if (deleted) {
          showToast(t('Asset deleted', '已从资料库移除'));
          const key = `${item.sessionId}:${item.assetId}`;
          if (lightboxId === key) setLightboxId(null);
          if (activeAssetId === key) setActiveAssetId(null);
        }
      });
    },
    [library.deleteAsset, lightboxId, activeAssetId, showToast, t],
  );

  const deleteBatch = useCallback(() => {
    if (selectedIds.size === 0) return;
    const toDelete = library.items.filter((i) => selectedIds.has(`${i.sessionId}:${i.assetId}`));
    Promise.all(toDelete.map((i) => library.deleteAsset(i))).then(() => {
      showToast(t(`Deleted ${selectedIds.size} assets`, `已批量删除 ${selectedIds.size} 项素材`));
      setSelectedIds(new Set());
      setIsBatchMode(false);
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

  const emptyTitle =
    kind === 'video'
      ? t('No videos yet', '还没有视频')
      : kind === 'file'
        ? t('No files yet', '还没有文件')
        : kind === 'favorite'
          ? t('No favorites yet', '暂无收藏素材')
          : t('No images yet', '还没有图片');

  const emptyDetail =
    kind === 'video'
      ? t('Videos generated in chat land here.', '会话里生成的视频会出现在这里。在对话中输入提示词让 AI 创作。')
      : kind === 'file'
        ? t('Documents and other files land here.', '文档和其他文件会出现在这里。')
        : kind === 'favorite'
          ? t('Star assets to save them in your favorites.', '点击素材卡片上的星标即可收藏。')
          : t('Images generated in chat land here.', '会话里生成的图片会出现在这里。在对话中输入提示词让 AI 为你生成作品。');

  return (
    <div className="vault-stage lib-page" data-testid="library-workspace">
      {/* ── Tier 1: macOS Topbar Chrome ────────────────────────────── */}
      <header className="studio-chrome">
        <WindowDragRegion
          className="vault-titleband"
          data-testid="studio-topbar-drag"
          aria-label={t('Drag window', '拖拽窗口')}
        />
        <div
          className="vault-bar is-page"
          data-testid="studio-topbar"
          data-tauri-drag-region
          onMouseDown={handleNativeWindowDragMouseDown}
        >
          {/* Left: Back + Title & Badge */}
          <div className="vault-bar-leading" data-no-window-drag>
            <button
              type="button"
              className="vault-back is-icon"
              data-testid="library-back-btn"
              onClick={props.onClose}
              aria-label={t('Back', '返回')}
            >
              <IconChevronLeft width={16} height={16} aria-hidden="true" />
            </button>
            <div className="vault-bar-context">
              <span>{t('Library', '资料库')}</span>
              <span className="vault-bar-count">
                {visibleItems.length} {t('assets', '项资产')}
              </span>
            </div>
          </div>

          {/* Center: Search Field with Shortcut Hint */}
          <div className="vault-bar-search" data-no-window-drag>
            <label className="vault-search">
              <IconSearch width={14} height={14} aria-hidden="true" />
              <input
                ref={searchInputRef}
                type="search"
                data-testid="library-search"
                placeholder={t('Search prompts, models, sessions…', '搜索提示词、模型、会话…')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label={t('Search', '搜索')}
              />
              <kbd className="vault-search-kbd">⌘K</kbd>
              {Boolean(search) ? (
                <button
                  type="button"
                  className="vault-search-clear"
                  onClick={() => setSearch('')}
                  aria-label={t('Clear', '清空')}
                >
                  <IconClose width={11} height={11} aria-hidden="true" />
                </button>
              ) : null}
            </label>
          </div>

          {/* Right: Batch Button + New Menu */}
          <div className="vault-bar-primary" data-no-window-drag>
            <button
              type="button"
              className={`lib-batch-toggle-btn${isBatchMode ? ' is-active' : ''}`}
              onClick={() => {
                setIsBatchMode((v) => !v);
                setSelectedIds(new Set());
              }}
            >
              <span>{isBatchMode ? t('Exit Batch', '退出管理') : t('Batch', '批量管理')}</span>
            </button>

            <DropdownMenu
              align="end"
              testId="library-new-menu"
              trigger={
                <button type="button" className="lib-new-btn" data-testid="library-new-btn">
                  <IconSpark width={13} height={13} aria-hidden="true" />
                  <span>{t('New', '新建')}</span>
                  <IconChevronDown width={12} height={12} aria-hidden="true" />
                </button>
              }
            >
              <DropdownMenuItem testId="library-new-image" onSelect={props.onClose}>
                {t('Generate image', '生成图片')}
              </DropdownMenuItem>
              <DropdownMenuItem testId="library-new-video" onSelect={props.onClose}>
                {t('Generate video', '生成视频')}
              </DropdownMenuItem>
            </DropdownMenu>
          </div>
        </div>

        {/* ── Tier 2: Subbar Filter & Control Strip ──────────────────── */}
        <div className="vault-filters" data-no-window-drag>
          <div className="vault-filters-leading">
            <nav className="lib-segmented-tabs" aria-label={t('Library type', '资料类型')}>
              {KIND_TABS.map((tab) => {
                const active = kind === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    className={`lib-segmented-tab${active ? ' is-active' : ''}`}
                    data-testid={`library-tab-${
                      tab.id === 'image'
                        ? 'images'
                        : tab.id === 'video'
                          ? 'videos'
                          : tab.id === 'file'
                            ? 'files'
                            : 'favorites'
                    }`}
                    aria-pressed={active}
                    onClick={() => setKind(tab.id)}
                  >
                    {tab.id === 'favorite' ? (
                      <IconStar width={12} height={12} aria-hidden="true" />
                    ) : null}
                    <span>{t(tab.en, tab.zh)}</span>
                  </button>
                );
              })}
            </nav>

            <div className="lib-filter-pill-wrap">
              <select
                className="lib-filter-select"
                value={modelFilter}
                onChange={(e) => setModelFilter(e.target.value)}
                aria-label={t('Filter by model', '按模型筛选')}
              >
                <option value="all">{t('All Models', '全部模型')}</option>
                <option value="flux">FLUX.1 Pro</option>
                <option value="midjourney">Midjourney v6</option>
                <option value="dall">DALL-E 3</option>
                <option value="runway">Runway Gen-3</option>
                <option value="kling">Kling 1.5</option>
              </select>
            </div>
          </div>

          <div className="lib-view-toggle" role="group" aria-label={t('View mode', '视图模式')}>
            <DropdownMenu
              align="end"
              testId="library-sort-menu"
              trigger={
                <button
                  type="button"
                  className="lib-view-btn"
                  title={t('Sort', '排序')}
                  aria-label={t('Sort', '排序')}
                  data-testid="library-sort-btn"
                >
                  <IconSliders width={13} height={13} aria-hidden="true" />
                </button>
              }
            >
              <DropdownMenuItem
                testId="library-sort-newest"
                onSelect={() => setSortDir('newest')}
              >
                {t('Newest first', '最新优先')}
              </DropdownMenuItem>
              <DropdownMenuItem
                testId="library-sort-oldest"
                onSelect={() => setSortDir('oldest')}
              >
                {t('Oldest first', '最早优先')}
              </DropdownMenuItem>
            </DropdownMenu>

            <button
              type="button"
              className={`lib-view-btn${viewMode === 'grid' ? ' is-active' : ''}`}
              onClick={() => setViewMode('grid')}
              title={t('Grid view', '网格视图')}
              aria-label={t('Grid view', '网格视图')}
            >
              <IconGrid width={13} height={13} aria-hidden="true" />
            </button>
            <button
              type="button"
              className={`lib-view-btn${viewMode === 'list' ? ' is-active' : ''}`}
              onClick={() => setViewMode('list')}
              title={t('List view', '列表视图')}
              aria-label={t('List view', '列表视图')}
            >
              <IconMenuList width={13} height={13} aria-hidden="true" />
            </button>

            <button
              type="button"
              className={`lib-view-btn${inspectorOpen ? ' is-active' : ''}`}
              onClick={() => setInspectorOpen((v) => !v)}
              title={t('Toggle Inspector', '切换属性面板')}
              aria-label={t('Toggle Inspector', '切换属性面板')}
            >
              <IconPanelRight width={13} height={13} aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      {/* ── Tier 3: Main Canvas & Inspector Drawer ──────────────────── */}
      <div className="lib-canvas">
        <main className="lib-body" id="vault-main">
          {/* Floating Batch Action Bar */}
          {isBatchMode ? (
            <div className="lib-batch-bar" role="toolbar" aria-label={t('Batch actions', '批量操作')}>
              <div className="lib-batch-bar-left">
                <input
                  type="checkbox"
                  checked={
                    selectedIds.size > 0 && selectedIds.size === visibleItems.length
                  }
                  onChange={(e) => toggleSelectAll(e.target.checked)}
                  aria-label={t('Select all', '全选')}
                />
                <span>
                  {t('Selected', '已选')} <strong>{selectedIds.size}</strong> {t('items', '项')}
                </span>
              </div>
              <div className="lib-batch-bar-actions">
                <button
                  type="button"
                  className="lib-batch-act-btn"
                  onClick={() => {
                    selectedIds.forEach((id) => toggleFavorite(id));
                    showToast(t('Updated favorites', '已加入/取消收藏'));
                  }}
                >
                  <IconStar width={13} height={13} aria-hidden="true" />
                  <span>{t('Favorite', '收藏')}</span>
                </button>
                <button
                  type="button"
                  className="lib-batch-act-btn is-danger"
                  onClick={deleteBatch}
                >
                  <IconTrash width={13} height={13} aria-hidden="true" />
                  <span>{t('Delete', '删除')}</span>
                </button>
                <button
                  type="button"
                  className="lib-batch-act-btn is-quiet"
                  onClick={() => setIsBatchMode(false)}
                >
                  {t('Cancel', '取消')}
                </button>
              </div>
            </div>
          ) : null}

          {library.loading && library.items.length === 0 ? (
            <div className="lib-state">
              <span className="lib-state-dot" aria-hidden="true" />
              <p>{t('Loading…', '加载中…')}</p>
            </div>
          ) : library.error && library.items.length === 0 ? (
            <div className="lib-state is-error">
              <p className="lib-state-title">{t('Could not load the library', '无法加载资料库')}</p>
              <p className="lib-state-detail">{library.error}</p>
            </div>
          ) : visibleItems.length > 0 ? (
            <>
              <div className={viewMode === 'list' ? 'lib-list' : 'lib-grid'}>
                {visibleItems.map((item) => {
                  const itemKey = `${item.sessionId}:${item.assetId}`;
                  const isFav = favorites.has(itemKey);
                  const isSelected = selectedIds.has(itemKey);
                  const isActive = activeAssetId === itemKey;

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
                        onOpen={() => {
                          openInspectorFor(itemKey);
                        }}
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
                      onToggleFavorite={() => toggleFavorite(itemKey)}
                      isBatchMode={isBatchMode}
                      isSelected={isSelected}
                      onToggleSelect={() => toggleSelect(itemKey)}
                      isActive={isActive}
                      onOpen={() => openInspectorFor(itemKey)}
                      onOpenLightbox={() => setLightboxId(itemKey)}
                      onCopyPrompt={() =>
                        copyPrompt(item.prompt ?? item.name ?? item.assetId, item.assetId)
                      }
                      onDelete={() => deleteItem(item)}
                      onRemix={() => {
                        copyPrompt(item.prompt ?? item.name ?? item.assetId, item.assetId);
                        props.onClose();
                      }}
                    />
                  );
                })}
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
                    onClick={() => {
                      copyPrompt(INSPIRATIONS[0]!.prompt, 'insp-0');
                      props.onClose();
                    }}
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
                      onClick={() => {
                        copyPrompt(insp.prompt, `insp-${idx}`);
                        props.onClose();
                      }}
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

        {/* Slide-over Inspector Drawer */}
        <LibraryInspectorDrawer
          item={activeInspectorItem}
          isOpen={inspectorOpen && visibleItems.length > 0}
          onClose={() => setInspectorOpen(false)}
          locale={props.locale}
          request={props.request}
          resolveSrc={resolveSrc}
          onOpenLightbox={() => {
            if (activeInspectorItem) {
              setLightboxId(`${activeInspectorItem.sessionId}:${activeInspectorItem.assetId}`);
            }
          }}
          onDelete={() => {
            if (activeInspectorItem) deleteItem(activeInspectorItem);
          }}
          onCopyPrompt={(text) => copyPrompt(text, activeInspectorItem?.assetId ?? '')}
          copied={copiedId === activeInspectorItem?.assetId}
          onRemix={(text) => {
            copyPrompt(text, activeInspectorItem?.assetId ?? '');
            props.onClose();
          }}
        />

        {/* Lightbox Fullscreen Theater */}
        {lightboxItem !== null ? (
          <LibraryLightbox
            item={lightboxItem}
            request={props.request}
            {...(props.locale !== undefined ? { locale: props.locale } : {})}
            resolveSrc={resolveSrc}
            copied={copiedId === lightboxItem.assetId}
            onClose={() => setLightboxId(null)}
            onCopyPrompt={() =>
              copyPrompt(
                lightboxItem.prompt ?? lightboxItem.name ?? lightboxItem.assetId,
                lightboxItem.assetId,
              )
            }
            onDelete={() => deleteItem(lightboxItem)}
            onRemix={() => {
              copyPrompt(
                lightboxItem.prompt ?? lightboxItem.name ?? lightboxItem.assetId,
                lightboxItem.assetId,
              );
              props.onClose();
            }}
            onPrev={visibleItems.length > 1 ? () => navigateLightbox('prev') : undefined}
            onNext={visibleItems.length > 1 ? () => navigateLightbox('next') : undefined}
            currentIndex={currentLightboxIndex}
            totalCount={visibleItems.length}
          />
        ) : null}

        {/* Floating Toast Notification */}
        {toastMsg ? (
          <div className="lib-toast-pill" role="status" aria-live="polite">
            <IconCheck width={14} height={14} aria-hidden="true" />
            <span>{toastMsg}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function LibraryLightbox(props: {
  item: MediaLibraryItem;
  request: (command: HostCommand) => Promise<HostResponse>;
  locale?: DesktopLocale;
  resolveSrc: (localPath: string, fallbackUrl: string) => string;
  copied: boolean;
  onClose: () => void;
  onCopyPrompt: () => void;
  onDelete: () => void;
  onRemix?: (() => void) | undefined;
  onPrev?: (() => void) | undefined;
  onNext?: (() => void) | undefined;
  currentIndex?: number | undefined;
  totalCount?: number | undefined;
}): ReactElement {
  const isZh = props.locale === 'zh-CN';
  const t = (en: string, zh: string) => (isZh ? zh : en);
  const localSrc = props.item.absolutePath ? props.resolveSrc(props.item.absolutePath, '') : '';
  const src = usePlayableLibrarySrc({
    item: props.item,
    localSrc,
    request: props.request,
  });
  const fileName = props.item.name?.trim() || props.item.assetId;
  const media =
    props.item.kind === 'video' ? (
      <div className="vault-video-theater-wrapper">
        <video
          key={`${props.item.sessionId}:${props.item.assetId}`}
          src={src || undefined}
          controls
          playsInline
          preload="metadata"
          className="vault-video-theater-player"
        />
      </div>
    ) : props.item.kind === 'image' ? (
      src ? (
        <img
          key={`${props.item.sessionId}:${props.item.assetId}`}
          src={src}
          alt={props.item.prompt ?? props.item.assetId}
          className="vault-image-theater-player"
        />
      ) : (
        <div className="lib-card-wait" />
      )
    ) : (
      <div className="lib-file-preview">
        <IconFile width={36} height={36} aria-hidden="true" />
        <strong>{fileName}</strong>
        {src ? (
          <a href={src} download={fileName} className="lib-file-download">
            {t('Download file', '下载文件')}
          </a>
        ) : null}
      </div>
    );

  return (
    <MediaLightbox
      testId={
        props.item.kind === 'image'
          ? 'images-lightbox'
          : props.item.kind === 'video'
            ? 'videos-theater'
            : 'library-file-lightbox'
      }
      title={
        props.item.kind === 'image'
          ? t('Image details', '图片详情')
          : props.item.kind === 'video'
            ? t('Video details', '视频详情')
            : t('File details', '文件详情')
      }
      onClose={props.onClose}
      media={media}
      promptLabel={t('Prompt', '提示词')}
      prompt={props.item.prompt ?? fileName}
      stats={[
        { label: t('Created', '时间'), value: formatWhen(props.item.createdAt) },
        { label: t('Model', '模型'), value: props.item.model ?? '—' },
        { label: t('Type', '类型'), value: props.item.mimeType },
      ]}
      copyLabel={t('Copy prompt', '复制提示词')}
      copiedLabel={t('Copied', '已复制')}
      deleteLabel={t('Delete', '删除')}
      {...(props.onRemix !== undefined ? { onRemix: props.onRemix } : {})}
      remixLabel={t('Remix in Chat', '在会话中重绘')}
      copied={props.copied}
      onCopyPrompt={props.onCopyPrompt}
      {...(props.onDelete !== undefined ? { onDelete: props.onDelete } : {})}
      {...(props.onPrev !== undefined ? { onPrev: props.onPrev } : {})}
      {...(props.onNext !== undefined ? { onNext: props.onNext } : {})}
      {...(props.currentIndex !== undefined ? { currentIndex: props.currentIndex } : {})}
      {...(props.totalCount !== undefined ? { totalCount: props.totalCount } : {})}
    />
  );
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso || '—';
  return date.toLocaleString();
}
