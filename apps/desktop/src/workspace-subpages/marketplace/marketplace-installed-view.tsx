/**
 * Installed tab body: items needing attention first (failed, needs
 * configuration, pending apply), then by kind. Updates can run one by one or
 * all at once; every outcome is re-read from the Host.
 */
import type { ReactElement } from 'react';
import type { MarketplaceCatalogEntry, MarketplaceInstalledItem } from '@piwin/contracts';
import { Button, EmptyState } from '@piwin/ui-kit';
import type { DesktopLocale } from '../../desktop-locale.js';
import { IconExtension } from '../../shell-icons.js';
import { kindLabel } from './marketplace-copy.js';
import { MarketplaceInstalledRow } from './marketplace-installed-row.js';
import type { MarketOperation } from './marketplace-types.js';
import { catalogEntryFor, groupInstalledItems, type PendingUpdate } from './marketplace-view-model.js';

export type MarketplaceInstalledViewProps = {
  locale?: DesktopLocale | undefined;
  loading: boolean;
  filtering: boolean;
  totalCount: number;
  items: readonly MarketplaceInstalledItem[];
  catalogLookup: ReadonlyMap<string, MarketplaceCatalogEntry>;
  updates: readonly PendingUpdate[];
  operations: Readonly<Record<string, MarketOperation>>;
  onOpenEntry: (entry: MarketplaceCatalogEntry) => void;
  onToggle: (item: MarketplaceInstalledItem) => void;
  onRemove: (item: MarketplaceInstalledItem) => void;
  onUpdate: (entry: MarketplaceCatalogEntry, installed: MarketplaceInstalledItem) => void;
  onUpdateAll: () => void;
  onConfigureMcp?: (() => void) | undefined;
  onDiscover: () => void;
  onClearFilters: () => void;
};

export function MarketplaceInstalledView(props: MarketplaceInstalledViewProps): ReactElement {
  const zh = props.locale === 'zh-CN';
  const t = (en: string, zhText: string) => (zh ? zhText : en);
  const groups = groupInstalledItems(props.items);
  const updating = props.updates.some(({ entry }) => props.operations[entry.entryId] !== undefined);

  const rows = (items: readonly MarketplaceInstalledItem[]) => (
    <div className="market-installed-list">
      {items.map((item) => (
        <MarketplaceInstalledRow
          key={item.installationKey}
          item={item}
          operation={props.operations[item.installationKey] ?? (item.catalogEntryId ? props.operations[item.catalogEntryId] : undefined)}
          locale={props.locale}
          catalogEntry={catalogEntryFor(item, props.catalogLookup)}
          onOpen={props.onOpenEntry}
          onToggle={props.onToggle}
          onRemove={props.onRemove}
          onUpdate={props.onUpdate}
          onConfigureMcp={props.onConfigureMcp}
        />
      ))}
    </div>
  );

  if (props.items.length === 0 && !props.loading) {
    return (
      <EmptyState
        visual={<IconExtension width={28} height={28} aria-hidden="true" />}
        seal="墨"
        title={props.filtering ? t('Nothing matches', '没有匹配的能力') : t('Nothing installed here yet', '这里还没有已安装的能力')}
        description={
          props.filtering
            ? t('Try another keyword or type filter.', '换个关键词或类型筛选试试。')
            : t('Browse Discover to add capabilities to this Host.', '去「发现」为这台 Host 添加能力。')
        }
        action={
          props.filtering ? (
            <Button variant="secondary" size="compact" onClick={props.onClearFilters}>
              {t('Clear filters', '清空筛选')}
            </Button>
          ) : (
            <Button variant="primary" size="compact" onClick={props.onDiscover}>
              {t('Discover', '去发现')}
            </Button>
          )
        }
        size="spacious"
        testId="marketplace-empty-installed"
      />
    );
  }

  return (
    <>
      <header className="market-section-header market-installed-intro">
        <span className="market-section-caption">
          {t(`${props.totalCount} capabilities on this Host`, `这台 Host 上有 ${props.totalCount} 项能力`)}
        </span>
        <div className="market-installed-tools">
          {props.updates.length > 0 ? (
            <Button
              variant="primary"
              size="compact"
              disabled={updating}
              aria-busy={updating}
              onClick={props.onUpdateAll}
              data-testid="marketplace-update-all"
            >
              {t(`Update all (${props.updates.length})`, `全部更新（${props.updates.length}）`)}
            </Button>
          ) : null}
        </div>
      </header>
      {groups.attention.length > 0 ? (
        <section className="market-installed-group" data-testid="marketplace-installed-attention">
          <h2 className="market-installed-group-title">{t('Needs attention', '需要处理')}</h2>
          {rows(groups.attention)}
        </section>
      ) : null}
      {groups.byKind.map((group) => (
        <section key={group.kind} className="market-installed-group">
          <h2 className="market-installed-group-title">{kindLabel(group.kind, props.locale)}</h2>
          {rows(group.items)}
        </section>
      ))}
    </>
  );
}
