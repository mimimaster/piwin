/**
 * Capability marketplace full-window page.
 *
 * Discover shows the Host's curated catalog (Featured, then All) and
 * unreviewed community results; a submitted query searches the ecosystem.
 * Installed shows Host inventory with items needing attention first.
 * Every state on screen comes from a Host response or push — the page never
 * simulates progress, activation or removal.
 */
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import type {
  HostCommand,
  HostResponse,
  HostServerMessage,
  MarketplaceCatalogEntry,
  MarketplaceInstalledItem,
  MarketplaceSearchHit,
} from '@piwin/contracts';
import { ConfirmDialog, Notice } from '@piwin/ui-kit';
import { useConfirmDialog } from '../hooks/use-confirm-dialog';
import type { DesktopLocale } from '../i18n/desktop-locale.js';
import { StudioTopbar } from './studio/studio-chrome.js';
import { emitDesktopNotification } from '../notifications/notification-queue.js';
import { MarketplaceDiscoverControls } from './marketplace/marketplace-discover-controls.js';
import { MarketplaceDiscoverView } from './marketplace/marketplace-discover-view.js';
import { MarketplaceInstalledView } from './marketplace/marketplace-installed-view.js';
import { MarketplacePackageDrawer } from './marketplace/marketplace-package-drawer.js';
import { MarketplaceSourceInstallDialog } from './marketplace/marketplace-source-install-dialog.js';
import { catalogPackageKeys, isCatalogDuplicate } from './marketplace/marketplace-package-meta.js';
import {
  countCatalogKinds,
  countInstalledKinds,
  filterCatalogEntries,
  filterInstalledItems,
  indexCatalogEntries,
  pendingUpdates,
  presentCategories,
} from './marketplace/marketplace-view-model.js';
import {
  MarketplaceEntryDialog,
  PiPackageInstallDialog,
  entryName,
  kindLabel,
  localizedText,
  useMarketplaceActions,
  useMarketplaceData,
  useMarketplaceEcosystemSearch,
  useMarketplacePackageInstall,
  type MarketCategoryFilter,
  type MarketKindFilter,
  type MarketplaceToast,
  type MarketTab,
} from './marketplace/index.js';

export type MarketplaceWorkspaceViewProps = {
  locale?: DesktopLocale | undefined;
  onClose: () => void;
  request: (command: HostCommand) => Promise<HostResponse>;
  sessionId?: string | null | undefined;
  subscribeHostMessages?:
    ((listener: (message: HostServerMessage) => void) => () => void) | undefined;
  /** Fill the chat composer with an example request and return to the session. */
  onUseExample?: ((prompt: string) => void) | undefined;
  /** Open MCP server configuration (Settings → Extensions). */
  onOpenMcpSettings?: (() => void) | undefined;
};

/** Toasts with a follow-up stay long enough to be clicked. */
const ACTION_TOAST_TTL_MS = 8_000;

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}

export function MarketplaceWorkspaceView(props: MarketplaceWorkspaceViewProps): ReactElement {
  const zh = props.locale === 'zh-CN';
  const t = (en: string, zhText: string) => (zh ? zhText : en);

  const [tab, setTab] = useState<MarketTab>('discover');
  const [kindFilter, setKindFilter] = useState<MarketKindFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState<MarketCategoryFilter>('all');
  // Each tab keeps its own query: a Discover search means nothing on Installed.
  const [searchByTab, setSearchByTab] = useState<Record<MarketTab, string>>({
    discover: '',
    installed: '',
  });
  const search = searchByTab[tab];
  const setSearch = (value: string) => setSearchByTab((current) => ({ ...current, [tab]: value }));
  const [openEntryId, setOpenEntryId] = useState<string | null>(null);
  const [openHit, setOpenHit] = useState<MarketplaceSearchHit | null>(null);
  const [removeTarget, setRemoveTarget] = useState<MarketplaceInstalledItem | null>(null);
  const [sourceInstallOpen, setSourceInstallOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);

  // Marketplace outcomes use the app-wide notification toast, not a page-local banner.
  const showToast = (next: MarketplaceToast) => {
    const message = [next.title, next.text].filter((part) => part && part.trim()).join(' · ');
    emitDesktopNotification({
      level: next.type,
      message,
      ...(next.action ? { action: next.action, ttlMs: ACTION_TOAST_TTL_MS } : {}),
    });
  };

  const data = useMarketplaceData({
    request: props.request,
    sessionId: props.sessionId,
    subscribeHostMessages: props.subscribeHostMessages,
  });
  const migrationConfirm = useConfirmDialog();
  const actions = useMarketplaceActions({
    locale: props.locale,
    sessionId: props.sessionId,
    request: props.request,
    refreshInventory: data.refreshInventory,
    showToast,
    confirmMigration: (name) =>
      migrationConfirm.confirm({
        title: zh ? `替换 ${name} 的代码修订？` : `Replace the installed revision of ${name}?`,
        description: zh
          ? '已有会话保留历史和原生会话 id，在逐个确认之前不会改用新代码。'
          : 'Existing sessions keep their history and native session id. They do not run the new code until each migration is confirmed.',
        confirmLabel: zh ? '替换修订' : 'Replace revision',
        cancelLabel: zh ? '取消' : 'Cancel',
      }),
    installFollowUp: (entry) => {
      const example = entry.examples[0];
      const applyExample = props.onUseExample;
      if (!example || !applyExample) return undefined;
      return {
        label: t('Try it', '试一下'),
        onClick: () => applyExample(localizedText(example.prompt, props.locale)),
      };
    },
  });
  const packageInstall = useMarketplacePackageInstall({
    locale: props.locale,
    sessionId: props.sessionId,
    request: props.request,
    showToast,
    onInstalled: data.refreshInventory,
  });
  const ecosystem = useMarketplaceEcosystemSearch({
    request: props.request,
    onError: (err) => {
      showToast({
        type: 'error',
        title: t('Could not reach ecosystem data source', '无法连接生态数据源'),
        text: err,
      });
    },
  });

  useEffect(() => {
    void ecosystem.browse();
  }, [ecosystem.browse]);

  // "/" focuses search from anywhere on the page, as in most catalogs.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target) || document.querySelector('[role="dialog"]')) return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const handleSearchChange = (value: string) => {
    setSearch(value);
    if (tab === 'discover' && !value.trim()) ecosystem.reset();
  };

  const searchEcosystem = () => {
    const trimmed = search.trim();
    if (!trimmed) {
      ecosystem.reset();
      return;
    }
    void ecosystem.search(trimmed);
  };

  const clearFilters = () => {
    setSearch('');
    setKindFilter('all');
    setCategoryFilter('all');
    if (tab === 'discover') ecosystem.reset();
  };

  const query = search.trim().toLowerCase();
  const liveEntries = useMemo(
    () => data.entries.filter((entry) => !entry.withdrawn),
    [data.entries],
  );
  const catalogLookup = useMemo(() => indexCatalogEntries(data.entries), [data.entries]);
  const installedByEntry = useMemo(() => {
    const map = new Map<string, MarketplaceInstalledItem>();
    for (const item of data.items) {
      if (item.catalogEntryId && !map.has(item.catalogEntryId)) map.set(item.catalogEntryId, item);
    }
    return map;
  }, [data.items]);

  // Category chips stay stable across kind filters so the strip does not
  // collapse when the selected kind only spans one category (e.g. MCP).
  const categories = useMemo(() => presentCategories(liveEntries, 'all'), [liveEntries]);
  const effectiveCategory =
    categoryFilter !== 'all' && categories.includes(categoryFilter) ? categoryFilter : 'all';
  const visibleEntries = useMemo(
    () =>
      filterCatalogEntries(liveEntries, { kind: kindFilter, category: effectiveCategory, query }),
    [liveEntries, kindFilter, effectiveCategory, query],
  );
  const browsing = !query && kindFilter === 'all' && effectiveCategory === 'all';
  const featuredEntries = useMemo(
    () => (browsing ? visibleEntries.filter((entry) => entry.featured) : []),
    [browsing, visibleEntries],
  );
  const catalogEntries = useMemo(
    () =>
      featuredEntries.length > 0
        ? visibleEntries.filter((entry) => !entry.featured)
        : visibleEntries,
    [featuredEntries, visibleEntries],
  );
  const packageKeys = useMemo(() => catalogPackageKeys(data.entries), [data.entries]);
  const communityHits = useMemo(
    () => ecosystem.hits.filter((hit) => !isCatalogDuplicate(hit, packageKeys)),
    [ecosystem.hits, packageKeys],
  );

  const visibleItems = useMemo(
    () => filterInstalledItems(data.items, catalogLookup, { kind: kindFilter, query }),
    [data.items, catalogLookup, kindFilter, query],
  );
  const updates = useMemo(
    () => pendingUpdates(data.items, catalogLookup),
    [data.items, catalogLookup],
  );

  const openEntry: MarketplaceCatalogEntry | null =
    data.entries.find((entry) => entry.entryId === openEntryId) ?? null;
  const replacementEntry = openEntry?.withdrawn?.replacementEntryId
    ? catalogLookup.get(openEntry.withdrawn.replacementEntryId)
    : undefined;

  const updateAll = async () => {
    // Sequential: each update may apply to the session and must see the previous result.
    for (const { entry, item } of updates) {
      await actions.update(entry, item);
    }
  };

  const tabs = (
    <div className="market-tab-wrap" role="tablist">
      {(['discover', 'installed'] as const).map((id) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={tab === id}
          className={`market-tab-btn${tab === id ? ' is-active' : ''}`}
          onClick={() => {
            setTab(id);
            setKindFilter('all');
            setCategoryFilter('all');
          }}
        >
          <span>{id === 'discover' ? t('Discover', '发现') : t('Installed', '已安装')}</span>
          {id === 'installed' ? (
            <span className="market-tab-count">{data.items.length}</span>
          ) : null}
          {id === 'installed' && updates.length > 0 ? (
            <span
              className="market-tab-update"
              title={t(`${updates.length} updates available`, `${updates.length} 项可更新`)}
              data-testid="marketplace-tab-updates"
            >
              {t(
                `${updates.length} update${updates.length === 1 ? '' : 's'}`,
                `${updates.length} 可更新`,
              )}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );

  return (
    <div className="vault-stage marketplace-stage" data-testid="marketplace-workspace">
      <StudioTopbar
        testId="marketplace-back-btn"
        backLabel={t('Back', '返回')}
        onBack={props.onClose}
        locale={props.locale}
        kind="marketplace"
        layout="page"
        barActions={tabs}
      />

      <main className="vault-main marketplace-main" id="vault-main">
        <div className="marketplace-page">
          {data.error ? (
            <Notice tone="warning" testId="marketplace-host-error">
              {t('Could not read from the Host: ', '读取 Host 状态失败：')}
              {data.error}
            </Notice>
          ) : null}
          <MarketplaceDiscoverControls
            locale={props.locale}
            searchRef={searchRef}
            search={search}
            onSearchChange={handleSearchChange}
            {...(tab === 'discover' ? { onSearchSubmit: searchEcosystem } : {})}
            placeholder={
              tab === 'discover'
                ? t('Search capabilities, npm and GitHub…', '搜索能力、npm 与 GitHub…')
                : t('Search installed…', '搜索已安装…')
            }
            kindFilter={kindFilter}
            onKindFilterChange={setKindFilter}
            trailing={
              <button
                type="button"
                className="market-view-all"
                onClick={() => setSourceInstallOpen(true)}
              >
                {t('Install from address…', '从地址安装…')}
              </button>
            }
            {...(tab === 'discover'
              ? {
                  kindCounts: countCatalogKinds(liveEntries),
                  totalCount: liveEntries.length,
                  categories,
                  categoryFilter: effectiveCategory,
                  onCategoryFilterChange: setCategoryFilter,
                }
              : {
                  kindCounts: countInstalledKinds(data.items, catalogLookup),
                  totalCount: data.items.length,
                })}
          />
          {tab === 'discover' ? (
            <MarketplaceDiscoverView
              locale={props.locale}
              loading={data.loading}
              query={search.trim()}
              kindFilter={kindFilter}
              featuredEntries={featuredEntries}
              catalogEntries={catalogEntries}
              installedByEntry={installedByEntry}
              operations={actions.operations}
              ecosystem={ecosystem}
              communityHits={communityHits}
              installedItems={data.items}
              installStates={packageInstall.states}
              onOpenEntry={(entry) => setOpenEntryId(entry.entryId)}
              onUpdate={(entry, installed) => void actions.update(entry, installed)}
              onOpenHit={setOpenHit}
              onInstallHit={packageInstall.select}
              onSearchEcosystem={searchEcosystem}
              onClearFilters={clearFilters}
            />
          ) : (
            <MarketplaceInstalledView
              locale={props.locale}
              loading={data.loading}
              filtering={Boolean(query) || kindFilter !== 'all'}
              totalCount={data.items.length}
              items={visibleItems}
              catalogLookup={catalogLookup}
              updates={updates}
              operations={actions.operations}
              onOpenEntry={(entry) => setOpenEntryId(entry.entryId)}
              onToggle={(target) => void actions.toggle(target)}
              onRemove={setRemoveTarget}
              onUpdate={(entry, installed) => void actions.update(entry, installed)}
              onUpdateAll={() => void updateAll()}
              onConfigureMcp={props.onOpenMcpSettings}
              onSourceUpdate={(target) => void actions.updateFromSource(target)}
              onDiscover={() => setTab('discover')}
              onClearFilters={clearFilters}
            />
          )}
        </div>
      </main>

      <MarketplaceEntryDialog
        entry={openEntry}
        installed={openEntry ? installedByEntry.get(openEntry.entryId) : undefined}
        operation={openEntry ? actions.operations[openEntry.entryId] : undefined}
        locale={props.locale}
        request={props.request}
        replacementName={replacementEntry ? entryName(replacementEntry, props.locale) : undefined}
        onOpenEntry={setOpenEntryId}
        onInstall={(entry) => void actions.install(entry)}
        onUpdate={(entry, targetInstalled) => void actions.update(entry, targetInstalled)}
        onRemove={setRemoveTarget}
        onUseExample={props.onUseExample}
        onClose={() => setOpenEntryId(null)}
      />

      <MarketplacePackageDrawer
        hit={openHit}
        installState={openHit ? (packageInstall.states[openHit.entryId] ?? 'idle') : 'idle'}
        locale={props.locale}
        request={props.request}
        onInstall={packageInstall.select}
        showToast={showToast}
        onClose={() => setOpenHit(null)}
      />

      <PiPackageInstallDialog
        hit={packageInstall.target}
        locale={props.locale}
        onConfirm={(hit) => void packageInstall.confirm(hit)}
        onCancel={packageInstall.cancel}
      />

      <MarketplaceSourceInstallDialog
        open={sourceInstallOpen}
        locale={props.locale}
        onInstall={packageInstall.installSource}
        onClose={() => setSourceInstallOpen(false)}
      />

      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null);
        }}
        title={t('Uninstall this capability?', '卸载这项能力？')}
        description={t(
          'It stops loading in new runs. Files are deleted once no session still uses them.',
          '之后的运行不再加载它；没有会话再使用后删除文件。',
        )}
        affectedObject={
          removeTarget
            ? `${kindLabel(removeTarget.kind, props.locale)} · ${removeTarget.name}`
            : undefined
        }
        confirmLabel={t('Uninstall', '卸载')}
        cancelLabel={t('Cancel', '取消')}
        tone="danger"
        onConfirm={() => {
          const target = removeTarget;
          setRemoveTarget(null);
          if (target) void actions.remove(target);
        }}
        testId="marketplace-remove-confirm"
      />
      {migrationConfirm.dialog}
    </div>
  );
}
