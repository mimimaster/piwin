import type { ReactElement } from 'react';
import type { MarketplaceCatalogEntry } from '@piwin/contracts';
import type { DesktopLocale } from '../../desktop-locale.js';
import { IconClose, IconSearch } from '../../shell-icons.js';
import { kindLabel } from './marketplace-copy.js';
import type { MarketKindFilter } from './marketplace-types.js';

const KIND_FILTERS: readonly MarketKindFilter[] = [
  'all',
  'extension',
  'piwin-extension',
  'skill',
  'mcp',
  'agent',
];

export type MarketplaceDiscoverControlsProps = {
  locale?: DesktopLocale | undefined;
  entries: readonly MarketplaceCatalogEntry[];
  kindFilter: MarketKindFilter;
  onKindFilterChange: (kind: MarketKindFilter) => void;
  search: string;
  onSearchChange: (value: string) => void;
  onSearchSubmit: () => void;
};

export function MarketplaceDiscoverControls(props: MarketplaceDiscoverControlsProps): ReactElement {
  const zh = props.locale === 'zh-CN';
  const t = (en: string, zhText: string) => (zh ? zhText : en);
  const searching = Boolean(props.search.trim());

  return (
    <div className="market-discover-controls">
      <div className="market-filter-row">
        <div
          className="market-category-strip"
          role="group"
          aria-label={t('Capability type', '能力类型')}
        >
          {KIND_FILTERS.map((kind) => {
            const count =
              kind === 'all'
                ? props.entries.length
                : kind === 'piwin-extension'
                  ? props.entries.filter((entry) => entry.sourceLabel === 'piwin-extensions').length
                  : props.entries.filter((entry) => entry.kind === kind).length;
            return (
              <button
                key={kind}
                type="button"
                className={`vault-chip${props.kindFilter === kind ? ' is-on' : ''}`}
                aria-pressed={props.kindFilter === kind}
                onClick={() => props.onKindFilterChange(kind)}
              >
                {kind === 'all' ? t('All', '全部') : kindLabel(kind, props.locale)}{' '}
                {searching ? null : <span>{count}</span>}
              </button>
            );
          })}
        </div>
        <div className="market-search-row">
          <div className="market-source-badges" aria-hidden="true">
            <span className="market-source-badge is-piwin">piwin</span>
            <span className="market-source-badge">npm</span>
            <span className="market-source-badge">GitHub</span>
            <span className="market-source-badge">MCP</span>
          </div>
          <div className="vault-search market-search">
            <button
              type="button"
              className="vault-search-submit"
              onClick={props.onSearchSubmit}
              aria-label={t('Search', '搜索')}
              title={t('Search catalog and npm / GitHub', '搜索目录及 npm / GitHub')}
              data-testid="vault-search-submit-btn"
            >
              <IconSearch width={14} height={14} aria-hidden="true" />
            </button>
            <input
              type="search"
              aria-label={t('Search capabilities', '搜索能力')}
              placeholder={t('Search capabilities…', '搜索能力…')}
              value={props.search}
              onChange={(event) => props.onSearchChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  props.onSearchSubmit();
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
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
