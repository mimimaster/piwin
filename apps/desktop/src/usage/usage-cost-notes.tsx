/**
 * Pricing basis under the 费用构成 table: catalog, coverage and what the
 * estimate leaves out, with the model → catalog mappings on request.
 */
import { useState, type ReactElement } from 'react';
import { Button } from '@piwin/ui-kit';
import type { UsageRollup } from '@piwin/contracts';
import { formatUsageExact, formatUsageUsd } from './usage-panel-statistics';
import { listUsageCostReferenceMappings, resolveUsageCostOverview } from './usage-cost-view';

export function UsageCostNotes({ rollup, isZh }: { rollup: UsageRollup; isZh: boolean }): ReactElement {
  const [mappingsOpen, setMappingsOpen] = useState(false);
  const overview = resolveUsageCostOverview(rollup);
  const catalog = rollup.pricingCatalog;
  const mappings = listUsageCostReferenceMappings(rollup.byModelKey);
  const catalogLabel = catalog
    ? `${catalog.source === 'models.dev' ? 'models.dev' : isZh ? 'Pi 内置目录' : 'Pi catalog'}${catalog.fetchedAt ? ` · ${catalog.fetchedAt.slice(0, 10)}` : ''}`
    : isZh ? '未知目录' : 'Unknown catalog';
  return (
    <footer className="usage-cost-notes" data-testid="usage-cost-notes">
      <div className="usage-cost-notes-line">
        <span data-testid="usage-cost-source" title={catalog?.catalogVersion}>
          {isZh ? `价格目录 ${catalogLabel}` : `Catalog ${catalogLabel}`}
        </span>
        <span data-testid="usage-cost-coverage">
          {isZh
            ? `已计价 ${formatUsageExact(overview.pricedCount)} / ${formatUsageExact(overview.entryCount)} 次`
            : `${formatUsageExact(overview.pricedCount)} / ${formatUsageExact(overview.entryCount)} calls priced`}
        </span>
        <span data-testid="usage-cost-exact">
          {isZh ? `精确合计 ${formatUsageUsd(overview.totalUsd)}` : `Exact ${formatUsageUsd(overview.totalUsd)}`}
        </span>
        {mappings.length > 0 ? (
          <Button
            variant="ghost"
            size="compact"
            className="usage-cost-notes-toggle"
            aria-expanded={mappingsOpen}
            data-testid="usage-cost-mappings-toggle"
            onClick={() => setMappingsOpen((open) => !open)}
          >
            {isZh ? `计价映射 (${mappings.length})` : `Priced as (${mappings.length})`}
          </Button>
        ) : null}
      </div>
      <p className="usage-cost-notes-basis">
        {isZh
          ? '参考估算，不是实际扣费。按当前目录基础单价重估全部历史，含缓存读写；不含长上下文阶梯、缓存 TTL、服务等级、渠道折扣与工具附加费。'
          : 'A reference estimate, not a charge. All history is re-estimated at current catalog base rates, including cache reads/writes; long-context tiers, cache TTLs, service tiers, discounts and tool fees are excluded.'}
      </p>
      {mappingsOpen ? (
        <ul className="usage-cost-notes-mappings" data-testid="usage-cost-mappings">
          {mappings.map((mapping) => (
            <li key={`${mapping.modelId}\u0000${mapping.reference}`}>
              <code>{mapping.modelId}</code>
              <span aria-hidden="true"> → </span>
              <code>{mapping.reference}</code>
            </li>
          ))}
        </ul>
      ) : null}
    </footer>
  );
}
