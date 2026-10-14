/**
 * Search plus type / category filters, shared by Discover and Installed.
 * Only filters that would show something are rendered — no zero-count chips.
 */
import type { ReactElement, ReactNode, RefObject } from 'react';
import type { MarketplaceCategory } from '@piwin/contracts';
import type { DesktopLocale } from '../../desktop-locale.js';
import { IconClose, IconSearch } from '../../shell-icons.js';
import { categoryLabel, kindLabel } from './marketplace-copy.js';
import type { MarketCategoryFilter, MarketKindFilter } from './marketplace-types.js';

const KIND_ORDER: readonly Exclude<MarketKindFilter, 'all'>[] = [
  'extension',
  'piwin-extension',
  'skill',
  'mcp',
  'agent',
];

export type MarketplaceDiscoverControlsProps = {
  locale?: DesktopLocale | undefined;
  /** Count per kind for the current scope; kinds with 0 are hidden. */
  kindCounts: Partial<Record<Exclude<MarketKindFilter, 'all'>, number>>;
  totalCount: number;
  kindFilter: MarketKindFilter;
  onKindFilterChange: (kind: MarketKindFilter) => void;
  /** Categories present in the catalog; orthogonal to kind chips. Strip hides below two. */
  categories?: readonly MarketplaceCategory[] | undefined;
  categoryFilter?: MarketCategoryFilter | undefined;
  onCategoryFilterChange?: ((category: MarketCategoryFilter) => void) | undefined;
  search: string;
  onSearchChange: (value: string) => void;
  onSearchSubmit?: (() => void) | undefined;
  placeholder: string;
  searchRef?: RefObject<HTMLInputElement | null> | undefined;
  /** Right-aligned secondary action on the filter row (e.g. install from address). */
  trailing?: ReactNode;
};

export function MarketplaceDiscoverControls(props: MarketplaceDiscoverControlsProps): ReactElement {
  const zh = props.locale === 'zh-CN';
  const t = (en: string, zhText: string) => (zh ? zhText : en);
  const searching = Boolean(props.search.trim());
  const kinds = KIND_ORDER.filter(
    (kind) => (props.kindCounts[kind] ?? 0) > 0 || props.kindFilter === kind,
  );
  const categories = props.categories ?? [];
  const showCategories = categories.length > 1 && props.onCategoryFilterChange !== undefined;

  const chip = (key: string, label: string, on: boolean, onClick: () => void, count?: number) => (
    <button
      key={key}
      type="button"
      className={`vault-chip${on ? ' is-on' : ''}`}
      aria-pressed={on}
      onClick={onClick}
    >
      {label}
      {count !== undefined && !searching ? <span>{count}</span> : null}
    </button>
  );

  return (
    <div className="market-discover-controls">
      <div className="vault-search market-search">
        <IconSearch width={15} height={15} aria-hidden="true" className="market-search-icon" />
        <input
          ref={props.searchRef}
          type="search"
          aria-label={t('Search capabilities', '搜索能力')}
          placeholder={props.placeholder}
          value={props.search}
          onChange={(event) => props.onSearchChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              props.onSearchSubmit?.();
            } else if (event.key === 'Escape' && props.search) {
              event.preventDefault();
              props.onSearchChange('');
            }
          }}
          data-testid="marketplace-search-input"
        />
        {props.search ? (
          <button
            type="button"
            className="vault-search-clear"
            onClick={() => props.onSearchChange('')}
            aria-label={t('Clear search', '清空搜索')}
          >
            <IconClose width={14} height={14} aria-hidden="true" />
          </button>
        ) : (
          <kbd className="market-search-hint" aria-hidden="true">
            /
          </kbd>
        )}
      </div>
      {kinds.length > 0 || showCategories || props.trailing ? (
        <div className="market-filter-row">
          <div
            className="market-category-strip"
            role="group"
            aria-label={t('Capability type', '能力类型')}
          >
            {chip(
              'all',
              t('All', '全部'),
              props.kindFilter === 'all',
              () => props.onKindFilterChange('all'),
              props.totalCount,
            )}
            {kinds.map((kind) =>
              chip(
                kind,
                kindLabel(kind, props.locale),
                props.kindFilter === kind,
                () => props.onKindFilterChange(kind),
                props.kindCounts[kind] ?? 0,
              ),
            )}
            {showCategories ? (
              <>
                <span className="market-filter-divider" aria-hidden="true" />
                {categories.map((category) =>
                  chip(
                    category,
                    categoryLabel(category, props.locale),
                    props.categoryFilter === category,
                    () =>
                      props.onCategoryFilterChange?.(
                        props.categoryFilter === category ? 'all' : category,
                      ),
                  ),
                )}
              </>
            ) : null}
          </div>
          {props.trailing ? <div className="market-filter-trailing">{props.trailing}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
