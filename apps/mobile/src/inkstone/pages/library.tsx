/**
 * 资料库 (Host media vault) for the phone.
 *
 * The destination the 案头 tile promises — 图片 · 视频 · 收藏 — so the page
 * shows real posters, lets you open one full screen, search by prompt or file
 * name, and star what you want to keep. Everything comes from the Host's
 * `media/list` / `media/read`; favorites are the one device-local bit.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { NeedsHost } from '../needs-host.js';
import { Icon } from '../icons.js';
import { IconButton, TabsRow, TopBar } from '../inkstone-ui.js';
import { useInkstone } from '../inkstone-context.js';
import { useInkstoneHost, type InkstoneHostContextValue } from '../host/inkstone-host-context.js';
import {
  emptyLibraryCopy,
  FAVORITE_SCAN_PAGE_LIMIT,
  libraryItemKey,
  LIBRARY_TABS,
  type LibraryTab,
} from './library-model.js';
import { loadLibraryFavorites, saveLibraryFavorites, toggleLibraryFavorite } from './library-favorites.js';
import { LibraryTile } from './library-tile.js';
import { LibraryViewer } from './library-viewer.js';
import { useMediaLibrary } from './use-media-library.js';

export function LibraryPage(): ReactElement {
  const hostCtx = useInkstoneHost();
  if (hostCtx === null) {
    return <NeedsHost />;
  }
  return <ConnectedLibraryPage hostCtx={hostCtx} />;
}

const SKELETON_CELLS = 6;

function ConnectedLibraryPage({
  hostCtx,
}: {
  hostCtx: InkstoneHostContextValue;
}): ReactElement {
  const { dispatch } = useInkstone();
  const { host } = hostCtx;
  const client = host.client;
  const ready = host.connectionState.kind === 'ready';

  const [tab, setTab] = useState<LibraryTab>('全部');
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [favorites, setFavorites] = useState<Set<string>>(loadLibraryFavorites);
  const [viewerKey, setViewerKey] = useState<string | null>(null);

  const library = useMediaLibrary({ client, ready, tab, query });

  const visibleItems = useMemo(() => {
    if (tab !== '收藏') return library.items;
    return library.items.filter((item) => favorites.has(libraryItemKey(item)));
  }, [tab, library.items, favorites]);

  const toggleFavorite = useCallback((key: string) => {
    setFavorites((previous) => {
      const next = toggleLibraryFavorite(previous, key);
      saveLibraryFavorites(next);
      return next;
    });
  }, []);

  // A favorite may sit past the first page. While 收藏 shows nothing, keep
  // pulling — but stop at a phone-sized scan instead of the whole vault.
  const scanPagesRef = useRef(0);
  useEffect(() => {
    scanPagesRef.current = 0;
  }, [tab, query]);
  useEffect(() => {
    if (tab !== '收藏') return;
    if (visibleItems.length > 0) return;
    if (library.error !== undefined) return;
    if (!library.hasMore || library.loading || library.loadingMore) return;
    if (scanPagesRef.current >= FAVORITE_SCAN_PAGE_LIMIT) return;
    scanPagesRef.current += 1;
    library.loadMore();
  }, [
    tab,
    visibleItems.length,
    library.error,
    library.hasMore,
    library.loading,
    library.loadingMore,
    library.loadMore,
  ]);

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = sentinelRef.current;
    if (node === null || !library.hasMore || library.loadingMore) return undefined;
    if (library.error !== undefined) return undefined;
    if (typeof IntersectionObserver !== 'function') return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) library.loadMore();
      },
      { rootMargin: '400px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [library.hasMore, library.loadingMore, library.loadMore, library.error, visibleItems.length]);

  const viewerIndex =
    viewerKey === null ? -1 : visibleItems.findIndex((item) => libraryItemKey(item) === viewerKey);
  const viewerItem = viewerIndex >= 0 ? visibleItems[viewerIndex] : undefined;

  const subtitle = (() => {
    if (client === undefined) return '正在连接 Host…';
    if (library.unsupported) return 'Host 未开放资料库';
    if (!ready) return '与 Host 的连接中断';
    const count = tab === '收藏' ? visibleItems.length : Math.max(library.total, library.items.length);
    return `Host 资料库 · ${count} 项`;
  })();

  const searching = query.trim().length > 0;
  const empty = emptyLibraryCopy(tab, searching);

  return (
    <>
      <TopBar
        title="资料库"
        subtitle={subtitle}
        onBack={() => dispatch({ type: 'navigate', route: 'desk' })}
        right={
          <IconButton
            name="search"
            label={searchOpen ? '关闭搜索' : '搜索资料库'}
            onClick={() => {
              setSearchOpen((open) => {
                if (open) setQuery('');
                return !open;
              });
            }}
          />
        }
      />
      {client !== undefined && !ready ? (
        <div className="banner-offline">
          <span>Host 断开中 · 显示的是上次读取的列表</span>
          <button type="button" onClick={hostCtx.onOpenConnection}>
            管理连接
          </button>
        </div>
      ) : null}

      <div className="lib-head">
        <TabsRow
          items={[...LIBRARY_TABS]}
          selected={tab}
          onSelect={(next) => setTab(next as LibraryTab)}
        />
        {searchOpen ? (
          <div className="search-field lib-search">
            <Icon name="search" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索提示词、文件名或模型"
              aria-label="搜索资料库"
              enterKeyHint="search"
              autoFocus
            />
            {searching ? (
              <button type="button" aria-label="清空搜索" onClick={() => setQuery('')}>
                <Icon name="close" />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="screen-scroll lib-screen">
        {library.unsupported ? (
          <div className="lib-state">
            <Icon name="alert" />
            <strong>这个 Host 还没有资料库接口</strong>
            <p>更新并重启 Host 后，这里会显示会话里生成的图片、视频和附件。</p>
            <button type="button" className="full-button secondary" onClick={library.reload}>
              重新读取
            </button>
          </div>
        ) : library.error !== undefined && library.items.length === 0 ? (
          <div className="lib-state">
            <Icon name="alert" />
            <strong>读不到资料库</strong>
            <p>{library.error}</p>
            <button type="button" className="full-button secondary" onClick={library.reload}>
              重新读取
            </button>
          </div>
        ) : library.loading && library.items.length === 0 ? (
          <div className="lib-grid" aria-hidden="true">
            {Array.from({ length: SKELETON_CELLS }, (_, index) => (
              <span className="lib-skeleton-cell" key={index} />
            ))}
          </div>
        ) : visibleItems.length === 0 ? (
          <div className="lib-state">
            <Icon name={searching ? 'search' : 'image'} />
            <strong>{empty.title}</strong>
            <p>
              {tab === '收藏' && library.items.length > 0
                ? `已翻过 ${library.items.length} 项，最近加载的素材里还没有收藏。`
                : empty.detail}
            </p>
          </div>
        ) : (
          <>
            <div className="lib-grid">
              {visibleItems.map((item) => {
                const key = libraryItemKey(item);
                return (
                  <LibraryTile
                    key={key}
                    client={client}
                    item={item}
                    favorited={favorites.has(key)}
                    onOpen={() => setViewerKey(key)}
                    onToggleFavorite={() => toggleFavorite(key)}
                  />
                );
              })}
            </div>
            {library.error !== undefined ? (
              <p className="lib-inline-error">{library.error}</p>
            ) : null}
            <div ref={sentinelRef} className="lib-sentinel" />
            {library.loadingMore ? (
              <p className="lib-more-note">正在读取更多…</p>
            ) : library.hasMore ? (
              <button type="button" className="full-button subtle lib-more" onClick={library.loadMore}>
                加载更多
              </button>
            ) : (
              <p className="lib-more-note">共 {visibleItems.length} 项 · 已到底</p>
            )}
          </>
        )}
      </div>

      {viewerItem !== undefined ? (
        <LibraryViewer
          client={client}
          item={viewerItem}
          index={viewerIndex}
          count={visibleItems.length}
          favorited={favorites.has(libraryItemKey(viewerItem))}
          onSelect={(next) => {
            const target = visibleItems[next];
            if (target !== undefined) setViewerKey(libraryItemKey(target));
          }}
          onToggleFavorite={() => toggleFavorite(libraryItemKey(viewerItem))}
          onClose={() => setViewerKey(null)}
        />
      ) : null}
    </>
  );
}
