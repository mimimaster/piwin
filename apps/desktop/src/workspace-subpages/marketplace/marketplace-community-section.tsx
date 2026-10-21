/**
 * Unreviewed community results (npm / GitHub / MCP Registry / Skill store).
 * Curated duplicates are removed by the caller; this section only filters by
 * kind, orders, and pages.
 */
import { useMemo, useState, type ReactElement } from 'react';
import type { MarketplaceInstalledItem, MarketplaceSearchHit } from '@piwin/contracts';
import { normalizeResourceId } from '@piwin/contracts';
import { Button } from '@piwin/ui-kit';
import type { DesktopLocale } from '../../desktop-locale.js';
import { MarketplacePiPackageCard } from './marketplace-pi-package-card.js';
import { sortCommunityHits } from './marketplace-package-meta.js';
import type { CommunitySort, MarketKindFilter } from './marketplace-types.js';
import type { MarketplacePackageInstallState } from './use-marketplace-package-install.js';
import type { MarketplaceEcosystemSearch } from './use-marketplace-ecosystem-search.js';

export type MarketplaceCommunitySectionProps = {
  locale?: DesktopLocale | undefined;
  kindFilter?: MarketKindFilter | undefined;
  ecosystem: MarketplaceEcosystemSearch;
  /** Hits after curated duplicates were removed. */
  hits: readonly MarketplaceSearchHit[];
  installedItems: readonly MarketplaceInstalledItem[];
  installStates: Record<string, MarketplacePackageInstallState>;
  onInstall: (hit: MarketplaceSearchHit) => void;
  onOpen: (hit: MarketplaceSearchHit) => void;
};

function matchesKind(hit: MarketplaceSearchHit, kind: MarketKindFilter | undefined): boolean {
  switch (kind) {
    case undefined:
    case 'all':
      return true;
    case 'piwin-extension':
    case 'agent':
      return false;
    case 'mcp':
      return hit.kind === 'mcp' || hit.source === 'mcp-registry';
    case 'skill':
      return hit.kind === 'skill' || hit.source === 'skill';
    case 'extension':
      return (
        hit.kind === 'extension' ||
        (!hit.kind && (hit.source === 'npm-pi-package' || hit.source === 'github'))
      );
  }
}

export function MarketplaceCommunitySection(props: MarketplaceCommunitySectionProps): ReactElement {
  const zh = props.locale === 'zh-CN';
  const t = (en: string, zhText: string) => (zh ? zhText : en);
  const [sort, setSort] = useState<CommunitySort>('popular');
  const { ecosystem } = props;
  const installedIds = useMemo(
    () =>
      new Set(
        props.installedItems.flatMap((item) =>
          item.removal?.command === 'marketplace/package-remove' ? [item.capabilityId] : [],
        ),
      ),
    [props.installedItems],
  );
  const isInstalled = (hit: MarketplaceSearchHit): boolean => {
    const namespace = normalizeResourceId(hit.name);
    return [...installedIds].some((id) => id === namespace || id.startsWith(`${namespace}-`));
  };

  const visibleHits = useMemo(
    () =>
      sortCommunityHits(
        props.hits.filter((hit) => matchesKind(hit, props.kindFilter)),
        sort,
      ),
    [props.hits, props.kindFilter, sort],
  );
  const canSortByDate = visibleHits.some((hit) => hit.updatedAt);

  return (
    <section className="market-ecosystem" data-testid="marketplace-ecosystem">
      <header className="market-section-header market-community-header">
        <div className="market-ecosystem-title-row">
          <h2 className="market-ecosystem-title">
            {ecosystem.searchedQuery ? t('Community results', '社区结果') : t('Community', '社区')}
          </h2>
          <span className="market-community-unverified">{t('Unreviewed', '未审核')}</span>
          <span className="market-section-caption">
            {ecosystem.searchedQuery
              ? t(
                  `npm, GitHub, MCP Registry and skills.sh for “${ecosystem.searchedQuery}”`,
                  `npm、GitHub、MCP Registry 与 skills.sh 中的“${ecosystem.searchedQuery}”`,
                )
              : t('Pi packages on npm and GitHub', 'npm 与 GitHub 上的 Pi 包')}
            {/* The registry search is slow; say so in the caption so the grid never shifts. */}
            {ecosystem.searchedQuery && ecosystem.mcpLoading && !ecosystem.loading
              ? t(' · MCP Registry still searching…', ' · MCP Registry 仍在搜索…')
              : null}
          </span>
        </div>
        {canSortByDate ? (
          <div className="market-sort" role="group" aria-label={t('Sort', '排序')}>
            {(['popular', 'recent'] as const).map((option) => (
              <button
                key={option}
                type="button"
                className={`market-sort-btn${sort === option ? ' is-on' : ''}`}
                aria-pressed={sort === option}
                onClick={() => setSort(option)}
              >
                {option === 'popular' ? t('Popular', '热度') : t('Recently updated', '最近更新')}
              </button>
            ))}
          </div>
        ) : null}
      </header>
      {ecosystem.loading && visibleHits.length === 0 ? (
        <p className="market-ecosystem-status" data-testid="marketplace-ecosystem-loading">
          {t('Searching npm, GitHub and skills.sh…', '正在搜索 npm、GitHub 与 skills.sh…')}
        </p>
      ) : null}
      {visibleHits.length > 0 ? (
        <div className="market-community-grid">
          {visibleHits.map((hit) => (
            <MarketplacePiPackageCard
              key={hit.entryId}
              hit={hit}
              locale={props.locale}
              onOpen={props.onOpen}
              onInstall={props.onInstall}
              installState={
                props.installStates[hit.entryId] ?? (isInstalled(hit) ? 'installed' : 'idle')
              }
            />
          ))}
        </div>
      ) : null}
      {visibleHits.length > 0 && ecosystem.hasMore ? (
        <div className="market-load-more">
          <Button
            variant="ghost"
            size="compact"
            disabled={ecosystem.loading}
            aria-busy={ecosystem.loading}
            onClick={() => void ecosystem.loadMore()}
            data-testid="marketplace-ecosystem-more"
          >
            {ecosystem.loading ? t('Loading…', '加载中…') : t('Load more', '加载更多')}
          </Button>
        </div>
      ) : null}
      {!ecosystem.loading &&
      !ecosystem.mcpLoading &&
      visibleHits.length === 0 &&
      ecosystem.searchedQuery ? (
        <p className="market-ecosystem-status" data-testid="marketplace-ecosystem-empty">
          {t('No community packages found.', '未找到相关的社区包。')}
        </p>
      ) : null}
      {!ecosystem.loading && visibleHits.length === 0 && !ecosystem.searchedQuery ? (
        <p className="market-ecosystem-status">
          {t('Community packages are unavailable right now.', '暂时无法获取社区包。')}
        </p>
      ) : null}
    </section>
  );
}
