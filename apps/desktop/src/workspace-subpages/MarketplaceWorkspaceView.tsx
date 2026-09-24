/**
 * Capability marketplace full-window page.
 *
 * Discover shows the Host's curated catalog (plus live Pi ecosystem search
 * while a query is typed); Installed shows the Host inventory projection.
 * Every state on screen comes from a Host response or push — the page never
 * simulates progress, activation or removal.
 */
import { useMemo, useState, type ReactElement } from 'react';
import type {
  HostCommand,
  HostResponse,
  HostServerMessage,
  MarketplaceCatalogEntry,
  MarketplaceInstalledItem,
  MarketplaceSearchHit,
} from '@piwin/contracts';
import { MARKETPLACE_CATEGORIES, normalizeResourceId } from '@piwin/contracts';
import { Button, ConfirmDialog, EmptyState, Notice } from '@piwin/ui-kit';
import type { DesktopLocale } from '../desktop-locale.js';
import { IconExtension } from '../shell-icons.js';
import { StudioTopbar } from './studio/studio-chrome.js';
import {
  MarketplaceCatalogCard,
  MarketplaceEntryDialog,
  MarketplaceInstalledRow,
  MarketplacePiPackageCard,
  MarketplaceToastView,
  PiPackageInstallDialog,
  categoryLabel,
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
  subscribeHostMessages?: ((listener: (message: HostServerMessage) => void) => () => void) | undefined;
  /** Fill the chat composer with an example request and return to the session. */
  onUseExample?: ((prompt: string) => void) | undefined;
};

const KIND_FILTERS: readonly MarketKindFilter[] = ['all', 'extension', 'skill', 'mcp'];

function matchesQuery(values: readonly (string | undefined)[], query: string): boolean {
  if (!query) return true;
  return values.some((value) => value?.toLowerCase().includes(query));
}

export function MarketplaceWorkspaceView(props: MarketplaceWorkspaceViewProps): ReactElement {
  const zh = props.locale === 'zh-CN';
  const t = (en: string, zhText: string) => (zh ? zhText : en);

  const [tab, setTab] = useState<MarketTab>('discover');
  const [kindFilter, setKindFilter] = useState<MarketKindFilter>('all');
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState<MarketplaceToast | null>(null);
  const [openEntryId, setOpenEntryId] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<MarketplaceInstalledItem | null>(null);

  const showToast = (next: MarketplaceToast) => {
    setToast(next);
    window.setTimeout(() => setToast((current) => (current === next ? null : current)), 5200);
  };

  const data = useMarketplaceData({
    request: props.request,
    sessionId: props.sessionId,
    subscribeHostMessages: props.subscribeHostMessages,
  });
  const actions = useMarketplaceActions({
    locale: props.locale,
    sessionId: props.sessionId,
    request: props.request,
    refreshInventory: data.refreshInventory,
    showToast,
  });
  const packageInstall = useMarketplacePackageInstall({
    locale: props.locale,
    sessionId: props.sessionId,
    request: props.request,
    showToast,
    onInstalled: data.refreshInventory,
  });
  const ecosystem = useMarketplaceEcosystemSearch(tab === 'discover' ? search : '', props.request);

  const query = search.trim().toLowerCase();
  const installedByEntry = useMemo(() => {
    const map = new Map<string, MarketplaceInstalledItem>();
    for (const item of data.items) {
      if (item.catalogEntryId && !map.has(item.catalogEntryId)) map.set(item.catalogEntryId, item);
    }
    return map;
  }, [data.items]);

  const visibleEntries = useMemo(
    () =>
      data.entries.filter(
        (entry) =>
          (kindFilter === 'all' || entry.kind === kindFilter) &&
          matchesQuery(
            [entry.name.en, entry.name.zhCN, entry.summary.en, entry.summary.zhCN, entry.capabilityId],
            query,
          ),
      ),
    [data.entries, kindFilter, query],
  );
  const entryGroups = useMemo(
    () =>
      MARKETPLACE_CATEGORIES.map((category) => ({
        category,
        entries: visibleEntries.filter((entry) => entry.category === category),
      })).filter((group) => group.entries.length > 0),
    [visibleEntries],
  );
  const visibleItems = useMemo(
    () =>
      data.items.filter(
        (item) =>
          (kindFilter === 'all' || item.kind === kindFilter) &&
          matchesQuery([item.name, item.capabilityId, item.description], query),
      ),
    [data.items, kindFilter, query],
  );

  const openEntry: MarketplaceCatalogEntry | null =
    data.entries.find((entry) => entry.entryId === openEntryId) ?? null;
  // Pi package extensions are namespaced by the normalized package name.
  const installedPiPackageIds = useMemo(
    () =>
      new Set(
        data.items.flatMap((item) =>
          item.removal?.command === 'marketplace/package-remove' ? [item.capabilityId] : [],
        ),
      ),
    [data.items],
  );
  const isPiPackageInstalled = (hit: MarketplaceSearchHit): boolean => {
    const namespace = normalizeResourceId(hit.name);
    return [...installedPiPackageIds].some((id) => id === namespace || id.startsWith(`${namespace}-`));
  };

  const filters = (
    <div className="market-filters-group">
      <div className="market-tab-wrap" role="tablist">
        {(['discover', 'installed'] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`market-tab-btn${tab === id ? ' is-active' : ''}`}
            onClick={() => setTab(id)}
          >
            <span>{id === 'discover' ? t('Discover', '发现') : t('Installed', '已安装')}</span>
            <span className="market-tab-count">
              ({id === 'discover' ? data.entries.length : data.items.length})
            </span>
          </button>
        ))}
      </div>
      <div className="market-filter-divider" aria-hidden="true" />
      <div className="market-category-strip">
        {KIND_FILTERS.map((kind) => (
          <button
            key={kind}
            type="button"
            className={`vault-chip${kindFilter === kind ? ' is-on' : ''}`}
            onClick={() => setKindFilter(kind)}
          >
            <span>{kind === 'all' ? t('All', '全部') : kindLabel(kind, props.locale)}</span>
          </button>
        ))}
      </div>
    </div>
  );

  const renderEcosystem = () => (
    <section className="market-ecosystem" data-testid="marketplace-ecosystem">
      <header className="market-ecosystem-header">
        <div className="market-ecosystem-title-row">
          <h2 className="market-ecosystem-title">{t('Pi ecosystem', 'Pi 生态')}</h2>
          {ecosystem.hits.length > 0 ? (
            <span className="market-ecosystem-count-tag">
              {t(`${ecosystem.hits.length} packages`, `${ecosystem.hits.length} 个包`)}
            </span>
          ) : null}
        </div>
        <p className="market-ecosystem-sub">
          {t(
            'Live, unreviewed results: npm packages tagged pi-package and GitHub repos with topic:pi-package.',
            '实时搜索、未经审核：npm 上的 pi-package 与 GitHub 上带 topic:pi-package 的仓库。',
          )}
        </p>
      </header>
      {ecosystem.error ? (
        <Notice tone="warning" testId="marketplace-ecosystem-error">
          {t('Could not reach npm:', '无法连接 npm：')} {ecosystem.error}
        </Notice>
      ) : null}
      {ecosystem.loading && ecosystem.hits.length === 0 ? (
        <p className="market-ecosystem-status" data-testid="marketplace-ecosystem-loading">
          {t('Searching npm and GitHub…', '正在搜索 npm 与 GitHub…')}
        </p>
      ) : null}
      {ecosystem.hits.length > 0 ? (
        <div className="market-grid">
          {ecosystem.hits.map((hit: MarketplaceSearchHit) => (
            <MarketplacePiPackageCard
              key={hit.entryId}
              hit={hit}
              locale={props.locale}
              onCopyInstall={(copied) => {
                void navigator.clipboard.writeText(copied.installCommand).then(
                  () =>
                    showToast({
                      type: 'success',
                      title: t('Command copied', '已复制命令'),
                      text: copied.installCommand,
                    }),
                  () =>
                    showToast({ type: 'error', title: t('Copy failed', '复制失败'), text: copied.installCommand }),
                );
              }}
              onInstall={packageInstall.select}
              installState={
                packageInstall.states[hit.entryId] ??
                (isPiPackageInstalled(hit) ? 'installed' : 'idle')
              }
            />
          ))}
        </div>
      ) : null}
    </section>
  );

  const renderDiscover = () => (
    <>
      {entryGroups.map((group) => (
        <section key={group.category} className="market-category-section" data-testid={`market-group-${group.category}`}>
          <header className="market-ecosystem-header">
            <h2 className="market-ecosystem-title">{categoryLabel(group.category, props.locale)}</h2>
          </header>
          <div className="market-grid">
            {group.entries.map((entry) => (
              <MarketplaceCatalogCard
                key={entry.entryId}
                entry={entry}
                installed={installedByEntry.get(entry.entryId)}
                operation={actions.operations[entry.entryId]}
                locale={props.locale}
                onOpen={(opened) => setOpenEntryId(opened.entryId)}
              />
            ))}
          </div>
        </section>
      ))}
      {query ? renderEcosystem() : null}
      {!data.loading && entryGroups.length === 0 && !(query && (ecosystem.loading || ecosystem.hits.length > 0)) ? (
        <EmptyState
          visual={<IconExtension width={28} height={28} aria-hidden="true" />}
          seal={query ? '寻' : '空'}
          title={t('Nothing matches', '没有匹配的能力')}
          description={t('Try another keyword or type filter.', '换个关键词或类型筛选试试。')}
          action={
            <Button
              variant="secondary"
              size="compact"
              onClick={() => {
                setSearch('');
                setKindFilter('all');
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

  const renderInstalled = () =>
    visibleItems.length === 0 && !data.loading ? (
      <EmptyState
        visual={<IconExtension width={28} height={28} aria-hidden="true" />}
        seal="墨"
        title={t('Nothing installed here yet', '这里还没有已安装的能力')}
        description={t('Browse Discover to add capabilities to this Host.', '去「发现」为这台 Host 添加能力。')}
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
            onToggle={(target) => void actions.toggle(target)}
            onRemove={setRemoveTarget}
          />
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
        titleCount={tab === 'discover' ? visibleEntries.length : visibleItems.length}
        searchPlaceholder={t('Search capabilities…', '搜索能力…')}
        searchTestId="marketplace-search-input"
        searchValue={search}
        onSearchChange={setSearch}
        filters={filters}
      />

      <main className="vault-main marketplace-main" id="vault-main">
        <MarketplaceToastView toast={toast} locale={props.locale} onDismiss={() => setToast(null)} />
        {data.error ? (
          <Notice tone="warning" testId="marketplace-host-error">
            {t('Could not read from the Host: ', '读取 Host 状态失败：')}
            {data.error}
          </Notice>
        ) : null}
        {tab === 'discover' ? renderDiscover() : renderInstalled()}
      </main>

      <MarketplaceEntryDialog
        entry={openEntry}
        installed={openEntry ? installedByEntry.get(openEntry.entryId) : undefined}
        operation={openEntry ? actions.operations[openEntry.entryId] : undefined}
        locale={props.locale}
        onInstall={(entry) => void actions.install(entry)}
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
        affectedObject={removeTarget ? `${kindLabel(removeTarget.kind, props.locale)} · ${removeTarget.name}` : undefined}
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
    </div>
  );
}
