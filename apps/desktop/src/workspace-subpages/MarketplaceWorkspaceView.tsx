/**
 * Capability marketplace full-window page.
 *
 * Discover shows the Host's curated catalog and a live Pi ecosystem preview;
 * submitted queries search the ecosystem. Installed shows Host inventory.
 * Every state on screen comes from a Host response or push — the page never
 * simulates progress, activation or removal.
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import type {
  HostCommand,
  HostResponse,
  HostServerMessage,
  MarketplaceCatalogEntry,
  MarketplaceInstalledItem,
} from '@piwin/contracts';
import { Button, ConfirmDialog, EmptyState, Notice } from '@piwin/ui-kit';
import { useConfirmDialog } from '../use-confirm-dialog';
import type { DesktopLocale } from '../desktop-locale.js';
import { IconExtension } from '../shell-icons.js';
import { StudioTopbar } from './studio/studio-chrome.js';
import { emitDesktopNotification } from '../notification-queue.js';
import { MarketplaceDiscoverControls } from './marketplace/marketplace-discover-controls.js';
import { MarketplaceCommunitySection } from './marketplace/marketplace-community-section.js';
import {
  MarketplaceCatalogCard,
  MarketplaceEntryDialog,
  MarketplaceHeroCarousel,
  MarketplaceInstalledRow,
  PiPackageInstallDialog,
  kindLabel,
  useMarketplaceActions,
  useMarketplaceData,
  useMarketplaceEcosystemSearch,
  useMarketplacePackageInstall,
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
};

function matchesQuery(values: readonly (string | undefined)[], query: string): boolean {
  if (!query) return true;
  return values.some((value) => value?.toLowerCase().includes(query));
}

const FEATURED_CAPABILITY_IDS: readonly string[] = [
  'ff-labs-pi-fff',
  'doc-coauthoring',
  'frontend-design',
  'webapp-testing',
  'memory',
];

export function MarketplaceWorkspaceView(props: MarketplaceWorkspaceViewProps): ReactElement {
  const zh = props.locale === 'zh-CN';
  const t = (en: string, zhText: string) => (zh ? zhText : en);

  const [tab, setTab] = useState<MarketTab>('discover');
  const [kindFilter, setKindFilter] = useState<MarketKindFilter>('all');
  const [search, setSearch] = useState('');
  const [openEntryId, setOpenEntryId] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<MarketplaceInstalledItem | null>(null);

  // Marketplace outcomes use the app-wide notification toast, not a page-local banner.
  const showToast = (next: MarketplaceToast) => {
    const message = [next.title, next.text].filter((part) => part && part.trim()).join(' · ');
    emitDesktopNotification({ level: next.type, message });
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
    confirmMigration: (entryName) => migrationConfirm.confirm({
      title: props.locale === 'zh-CN' ? `替换 ${entryName} 的代码修订？` : `Replace the installed revision of ${entryName}?`,
      description: props.locale === 'zh-CN'
        ? '已有会话保留历史和原生会话 id，在逐个确认之前不会改用新代码。'
        : 'Existing sessions keep their history and native session id. They do not run the new code until each migration is confirmed.',
      confirmLabel: props.locale === 'zh-CN' ? '替换修订' : 'Replace revision',
      cancelLabel: props.locale === 'zh-CN' ? '取消' : 'Cancel',
    }),
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

  const handleSearchChange = (value: string) => {
    setSearch(value);
    if (!value.trim()) {
      ecosystem.reset();
    }
  };

  const handleSearchSubmit = () => {
    const trimmed = search.trim();
    if (!trimmed) {
      ecosystem.reset();
      return;
    }
    if (tab !== 'discover') {
      setTab('discover');
    }
    void ecosystem.search(trimmed);
  };

  const query = search.trim().toLowerCase();
  const installedByEntry = useMemo(() => {
    const map = new Map<string, MarketplaceInstalledItem>();
    for (const item of data.items) {
      if (item.catalogEntryId && !map.has(item.catalogEntryId)) map.set(item.catalogEntryId, item);
    }
    return map;
  }, [data.items]);

  const entryByCapability = useMemo(() => {
    const map = new Map<string, MarketplaceCatalogEntry>();
    for (const entry of data.entries) {
      map.set(entry.entryId, entry);
      map.set(entry.capabilityId, entry);
    }
    return map;
  }, [data.entries]);

  const visibleEntries = useMemo(
    () =>
      data.entries
        .filter(
          (entry) =>
            (kindFilter === 'all' || entry.kind === kindFilter ||
              (kindFilter === 'piwin-extension' && entry.sourceLabel === 'piwin-extensions')) &&
            matchesQuery(
              [
                entry.name.en,
                entry.name.zhCN,
                entry.summary.en,
                entry.summary.zhCN,
                entry.capabilityId,
              ],
              query,
            ),
        )
        .sort((left, right) => {
          const kindOrder = { extension: 0, skill: 1, mcp: 2, agent: 3 };
          const categoryOrder = {
            'code-development': 0,
            'design-content': 1,
            'docs-research': 2,
            'external-service': 3,
          };
          return (
            kindOrder[left.kind] - kindOrder[right.kind] ||
            categoryOrder[left.category] - categoryOrder[right.category] ||
            left.name.en.localeCompare(right.name.en)
          );
        }),
    [data.entries, kindFilter, query],
  );

  const featuredCapabilitySet = useMemo(() => new Set(FEATURED_CAPABILITY_IDS), []);

  const featuredEntries = useMemo(() => {
    if (query || kindFilter !== 'all') return [];
    return FEATURED_CAPABILITY_IDS.map((id) =>
      data.entries.find((entry) => entry.capabilityId === id),
    ).filter((entry): entry is MarketplaceCatalogEntry => entry !== undefined);
  }, [data.entries, kindFilter, query]);

  const showFeaturedSection = featuredEntries.length === 5;

  const catalogEntries = useMemo(() => {
    if (!showFeaturedSection) return visibleEntries;
    return visibleEntries.filter((entry) => !featuredCapabilitySet.has(entry.capabilityId));
  }, [showFeaturedSection, visibleEntries, featuredCapabilitySet]);

  const visibleItems = useMemo(
    () =>
      data.items.filter(
        (item) =>
          (kindFilter === 'all' || item.kind === kindFilter ||
            (kindFilter === 'piwin-extension' && data.entries.some((entry) =>
              entry.entryId === item.catalogEntryId && entry.sourceLabel === 'piwin-extensions'))) &&
          matchesQuery([item.name, item.capabilityId, item.description], query),
      ),
    [data.entries, data.items, kindFilter, query],
  );

  const openEntry: MarketplaceCatalogEntry | null =
    data.entries.find((entry) => entry.entryId === openEntryId) ?? null;
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
            if (id === 'installed') {
              setSearch('');
              setKindFilter('all');
              ecosystem.reset();
            }
          }}
        >
          <span>{id === 'discover' ? t('Discover', '发现') : t('Installed', '已安装')}</span>
          {id === 'installed' ? (
            <span className="market-tab-count">{data.items.length}</span>
          ) : null}
        </button>
      ))}
    </div>
  );

  const showEcosystem = !query || ecosystem.searchedQuery.toLowerCase() === query;
  const hasSearchedEcosystem =
    (kindFilter === 'all' || kindFilter === 'extension') &&
    showEcosystem &&
    Boolean(
      ecosystem.searchedQuery || ecosystem.loading || ecosystem.hits.length > 0 || ecosystem.error,
    );

  const renderDiscover = () => (
    <>
      <MarketplaceDiscoverControls
        locale={props.locale}
        entries={data.entries}
        kindFilter={kindFilter}
        onKindFilterChange={setKindFilter}
        search={search}
        onSearchChange={handleSearchChange}
        onSearchSubmit={handleSearchSubmit}
      />
      {!query && kindFilter !== 'piwin-extension' ? (
        <MarketplaceHeroCarousel locale={props.locale} />
      ) : null}
      {showFeaturedSection ? (
        <section className="market-category-section" data-testid="marketplace-featured">
          <header className="market-section-header">
            <div className="market-ecosystem-title-row">
              <h2 className="market-ecosystem-title">{t('Featured', '精选推荐')}</h2>
              <span className="market-section-badge">
                {t('Verified · Native Support', '实测可用 · 原生支持')}
              </span>
            </div>
            <span className="market-section-caption">
              {t(
                '5 verified native capabilities for Host AgentRuntime, ready to install and use',
                '5 项经 Host 原生实测验证的精选能力，支持直接安装与调用',
              )}
            </span>
          </header>
          <div className="market-grid market-featured-grid">
            {featuredEntries.map((entry) => (
              <MarketplaceCatalogCard
                key={entry.entryId}
                entry={entry}
                installed={installedByEntry.get(entry.entryId)}
                operation={actions.operations[entry.entryId]}
                locale={props.locale}
                onOpen={(opened) => setOpenEntryId(opened.entryId)}
                onUpdate={(targetEntry, targetInstalled) =>
                  void actions.update(targetEntry, targetInstalled)
                }
              />
            ))}
          </div>
        </section>
      ) : null}
      {hasSearchedEcosystem ? (
        <MarketplaceCommunitySection
          locale={props.locale}
          kindFilter={kindFilter}
          ecosystem={ecosystem}
          installedItems={data.items}
          installStates={packageInstall.states}
          onInstall={packageInstall.select}
          showToast={showToast}
        />
      ) : null}
      {catalogEntries.length > 0 ? (
        <section className="market-category-section" data-testid="marketplace-catalog">
          <header className="market-section-header">
            <div className="market-ecosystem-title-row">
              <h2 className="market-ecosystem-title">
                {showFeaturedSection
                  ? t('All Capabilities', '全域能力库')
                  : t('Catalog', '已收录安装项')}
              </h2>
              <span className="market-section-caption">
                {query
                  ? t(
                      `${catalogEntries.length} matches for “${search.trim()}”`,
                      `${catalogEntries.length} 项匹配“${search.trim()}”`,
                    )
                  : t(
                      `${catalogEntries.length} entries with pinned sources; check requirements before installing`,
                      `${catalogEntries.length} 项固定来源，安装前请查看前提条件`,
                    )}
              </span>
            </div>
          </header>
          <div className="market-grid">
            {catalogEntries.map((entry) => (
              <MarketplaceCatalogCard
                key={entry.entryId}
                entry={entry}
                installed={installedByEntry.get(entry.entryId)}
                operation={actions.operations[entry.entryId]}
                locale={props.locale}
                onOpen={(opened) => setOpenEntryId(opened.entryId)}
                onUpdate={(targetEntry, targetInstalled) =>
                  void actions.update(targetEntry, targetInstalled)
                }
              />
            ))}
          </div>
        </section>
      ) : null}
      {!data.loading &&
      visibleEntries.length === 0 &&
      !(hasSearchedEcosystem && (ecosystem.loading || ecosystem.hits.length > 0)) ? (
        <EmptyState
          visual={<IconExtension width={28} height={28} aria-hidden="true" />}
          seal={query ? '寻' : '空'}
          title={t('Nothing matches', '没有匹配的能力')}
          description={
            query && !hasSearchedEcosystem
              ? t(
                  'Press Enter or click Search to search npm & GitHub, or try another keyword.',
                  '按回车或点击搜索可查询 npm 与 GitHub，或换个关键词试试。',
                )
              : t('Try another keyword or type filter.', '换个关键词或类型筛选试试。')
          }
          action={
            <Button
              variant="secondary"
              size="compact"
              onClick={() => {
                setSearch('');
                setKindFilter('all');
                ecosystem.reset();
              }}
            >
              {t('Clear filters', '清空筛选')}
            </Button>
          }
          size="spacious"
          testId="marketplace-empty"
        />
      ) : null}
    </>
  );

  const renderInstalled = () => (
    <>
      <header className="market-page-intro market-installed-intro">
        <p>
          {t(
            `Manage ${visibleItems.length} capabilities on this Host.`,
            `管理这台 Host 上的 ${visibleItems.length} 项能力。`,
          )}
        </p>
      </header>
      {visibleItems.length === 0 && !data.loading ? (
        <EmptyState
          visual={<IconExtension width={28} height={28} aria-hidden="true" />}
          seal="墨"
          title={t('Nothing installed here yet', '这里还没有已安装的能力')}
          description={t(
            'Browse Discover to add capabilities to this Host.',
            '去「发现」为这台 Host 添加能力。',
          )}
          action={
            <Button variant="primary" size="compact" onClick={() => setTab('discover')}>
              {t('Discover', '去发现')}
            </Button>
          }
          size="spacious"
          testId="marketplace-empty-installed"
        />
      ) : (
        <div className="market-installed-list">
          {visibleItems.map((item) => (
            <MarketplaceInstalledRow
              key={item.installationKey}
              item={item}
              operation={actions.operations[item.installationKey]}
              locale={props.locale}
              updateEntry={
                item.catalogEntryId
                  ? entryByCapability.get(item.catalogEntryId)
                  : entryByCapability.get(item.capabilityId)
              }
              onToggle={(target) => void actions.toggle(target)}
              onRemove={setRemoveTarget}
              onUpdate={(entry, targetInstalled) =>
                void actions.update(entry, targetInstalled)
              }
            />
          ))}
        </div>
      )}
    </>
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
        <div className={`marketplace-page${tab === 'discover' && query ? ' is-searching' : ''}`}>
          {data.error ? (
            <Notice tone="warning" testId="marketplace-host-error">
              {t('Could not read from the Host: ', '读取 Host 状态失败：')}
              {data.error}
            </Notice>
          ) : null}
          {tab === 'discover' ? renderDiscover() : renderInstalled()}
        </div>
      </main>

      <MarketplaceEntryDialog
        entry={openEntry}
        installed={openEntry ? installedByEntry.get(openEntry.entryId) : undefined}
        operation={openEntry ? actions.operations[openEntry.entryId] : undefined}
        locale={props.locale}
        onInstall={(entry) => void actions.install(entry)}
        onUpdate={(entry, targetInstalled) => void actions.update(entry, targetInstalled)}
        onRemove={setRemoveTarget}
        onUseExample={props.onUseExample}
        onClose={() => setOpenEntryId(null)}
      />

      <PiPackageInstallDialog
        hit={packageInstall.target}
        locale={props.locale}
        onConfirm={(hit) => void packageInstall.confirm(hit)}
        onCancel={packageInstall.cancel}
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
