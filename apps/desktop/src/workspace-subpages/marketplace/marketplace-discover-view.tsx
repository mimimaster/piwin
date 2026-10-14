/**
 * Discover tab body: curated Featured / All sections first, then unreviewed
 * community results. Everything shown comes from Host responses.
 */
import type { ReactElement } from 'react';
import type {
  MarketplaceCatalogEntry,
  MarketplaceInstalledItem,
  MarketplaceSearchHit,
} from '@piwin/contracts';
import { Button, EmptyState } from '@piwin/ui-kit';
import type { DesktopLocale } from '../../desktop-locale.js';
import { IconExtension, IconSearch } from '../../shell-icons.js';
import { MarketplaceCatalogCard } from './marketplace-catalog-card.js';
import { MarketplaceCommunitySection } from './marketplace-community-section.js';
import type { MarketKindFilter, MarketOperation } from './marketplace-types.js';
import type { MarketplaceEcosystemSearch } from './use-marketplace-ecosystem-search.js';
import type { MarketplacePackageInstallState } from './use-marketplace-package-install.js';

export type MarketplaceDiscoverViewProps = {
  locale?: DesktopLocale | undefined;
  loading: boolean;
  query: string;
  kindFilter: MarketKindFilter;
  featuredEntries: readonly MarketplaceCatalogEntry[];
  catalogEntries: readonly MarketplaceCatalogEntry[];
  installedByEntry: ReadonlyMap<string, MarketplaceInstalledItem>;
  operations: Readonly<Record<string, MarketOperation>>;
  ecosystem: MarketplaceEcosystemSearch;
  communityHits: readonly MarketplaceSearchHit[];
  installedItems: readonly MarketplaceInstalledItem[];
  installStates: Record<string, MarketplacePackageInstallState>;
  onOpenEntry: (entry: MarketplaceCatalogEntry) => void;
  onUpdate: (entry: MarketplaceCatalogEntry, installed: MarketplaceInstalledItem) => void;
  onOpenHit: (hit: MarketplaceSearchHit) => void;
  onInstallHit: (hit: MarketplaceSearchHit) => void;
  onSearchEcosystem: () => void;
  onClearFilters: () => void;
};

export function MarketplaceDiscoverView(props: MarketplaceDiscoverViewProps): ReactElement {
  const zh = props.locale === 'zh-CN';
  const t = (en: string, zhText: string) => (zh ? zhText : en);
  const { ecosystem } = props;
  const communityKind =
    props.kindFilter === 'all' ||
    props.kindFilter === 'extension' ||
    props.kindFilter === 'skill' ||
    props.kindFilter === 'mcp';
  const searchedThisQuery =
    Boolean(props.query) && ecosystem.searchedQuery.toLowerCase() === props.query.toLowerCase();
  // With a query, community results only show once that exact query was sent to the Host.
  const showCommunity =
    communityKind &&
    (props.query ? searchedThisQuery : true) &&
    Boolean(
      ecosystem.searchedQuery ||
      ecosystem.loading ||
      props.communityHits.length > 0 ||
      ecosystem.error,
    );
  const showSearchPrompt = Boolean(props.query) && communityKind && !searchedThisQuery;
  const nothing =
    !props.loading &&
    props.featuredEntries.length === 0 &&
    props.catalogEntries.length === 0 &&
    !showSearchPrompt &&
    !(showCommunity && (ecosystem.loading || props.communityHits.length > 0));

  const grid = (entries: readonly MarketplaceCatalogEntry[]) => (
    <div className="market-grid">
      {entries.map((entry) => (
        <MarketplaceCatalogCard
          key={entry.entryId}
          entry={entry}
          installed={props.installedByEntry.get(entry.entryId)}
          operation={props.operations[entry.entryId]}
          locale={props.locale}
          onOpen={props.onOpenEntry}
          onUpdate={props.onUpdate}
        />
      ))}
    </div>
  );

  return (
    <>
      {props.featuredEntries.length > 0 ? (
        <section className="market-category-section" data-testid="marketplace-featured">
          <header className="market-section-header">
            <h2 className="market-ecosystem-title">{t('Featured', '精选')}</h2>
          </header>
          {grid(props.featuredEntries)}
        </section>
      ) : null}
      {props.catalogEntries.length > 0 ? (
        <section className="market-category-section" data-testid="marketplace-catalog">
          <header className="market-section-header">
            <div className="market-ecosystem-title-row">
              <h2 className="market-ecosystem-title">
                {props.query ? t('Catalog', '目录') : t('All', '全部')}
              </h2>
              <span className="market-section-caption">
                {props.query
                  ? t(
                      `${props.catalogEntries.length} matches`,
                      `${props.catalogEntries.length} 项匹配`,
                    )
                  : t(
                      `${props.catalogEntries.length} entries`,
                      `${props.catalogEntries.length} 项`,
                    )}
              </span>
            </div>
          </header>
          {grid(props.catalogEntries)}
        </section>
      ) : null}
      {showSearchPrompt ? (
        <button
          type="button"
          className="market-search-ecosystem"
          onClick={props.onSearchEcosystem}
          data-testid="marketplace-search-ecosystem"
        >
          <IconSearch width={14} height={14} aria-hidden="true" />
          <span>
            {t(
              `Search npm, GitHub and registries for “${props.query}”`,
              `在 npm、GitHub 与注册表中搜索“${props.query}”`,
            )}
          </span>
          <kbd aria-hidden="true">↵</kbd>
        </button>
      ) : null}
      {showCommunity ? (
        <MarketplaceCommunitySection
          locale={props.locale}
          kindFilter={props.kindFilter}
          ecosystem={ecosystem}
          hits={props.communityHits}
          installedItems={props.installedItems}
          installStates={props.installStates}
          onInstall={props.onInstallHit}
          onOpen={props.onOpenHit}
        />
      ) : null}
      {nothing ? (
        <EmptyState
          visual={<IconExtension width={28} height={28} aria-hidden="true" />}
          seal={props.query ? '寻' : '空'}
          title={t('Nothing matches', '没有匹配的能力')}
          description={t('Try another keyword or type filter.', '换个关键词或类型筛选试试。')}
          action={
            <Button variant="secondary" size="compact" onClick={props.onClearFilters}>
              {t('Clear filters', '清空筛选')}
            </Button>
          }
          size="spacious"
          testId="marketplace-empty"
        />
      ) : null}
    </>
  );
}
