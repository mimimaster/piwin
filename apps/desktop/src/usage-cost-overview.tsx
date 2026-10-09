/**
 * Reference cost as the first of the usage summary cards. Exact figures,
 * coverage and pricing basis sit behind an explicit 计价说明 popover; the
 * model × Key breakdown is a collapsed, opt-in table owned by the panel.
 */
import type { ReactElement } from 'react';
import { Button, Popover } from '@piwin/ui-kit';
import type { UsageRollup } from '@piwin/contracts';
import { formatUsageExact, formatUsageUsd } from './usage-panel-statistics';
import {
  formatUsageUsdSummary,
  listUsageCostReferenceMappings,
  resolveUsageCostOverview,
  USAGE_COST_DETAILS_ID,
} from './usage-cost-view';
import './styles/usage-cost.css';

export function UsageCostOverviewCard({ rollup, isZh, detailsOpen, onDetailsOpen }: {
  rollup: UsageRollup;
  isZh: boolean;
  detailsOpen: boolean;
  onDetailsOpen: (open: boolean) => void;
}): ReactElement {
  const overview = resolveUsageCostOverview(rollup);
  const supported = overview.state !== 'unsupported';
  const meta = (() => {
    switch (overview.state) {
      case 'unsupported':
        return isZh ? '当前 Host 不提供费用估算' : 'This Host does not estimate cost';
      case 'partial':
        return isZh
          ? `已计价部分 · ${formatUsageExact(overview.unpricedCount)} 次未计价`
          : `Priced part only · ${formatUsageExact(overview.unpricedCount)} unpriced`;
      case 'unpriced':
        return isZh
          ? `${formatUsageExact(overview.unpricedCount)} 次均未计价`
          : `All ${formatUsageExact(overview.unpricedCount)} calls unpriced`;
      default:
        return isZh ? 'USD · 模型参考价' : 'USD · model reference rates';
    }
  })();
  return (
    <section
      className="usage-summary-card usage-summary-card-cost"
      data-testid="usage-cost-card"
      data-cost-state={overview.state}
    >
      <span className="usage-summary-label">{isZh ? '估算费用' : 'Estimated cost'}</span>
      <strong className="usage-summary-value" data-testid="usage-cost-total">
        {formatUsageUsdSummary(overview.totalUsd)}
      </strong>
      <span
        className="usage-summary-meta usage-cost-meta"
        data-testid="usage-cost-meta"
        data-attention={overview.state === 'partial' || overview.state === 'unpriced' ? 'true' : undefined}
      >
        {meta}
      </span>
      {supported ? (
        <div className="usage-cost-actions">
          <Popover
            align="start"
            label={isZh ? '计价说明' : 'Pricing notes'}
            testId="usage-cost-notes"
            contentClassName="usage-cost-notes"
            trigger={(
              <Button variant="ghost" size="compact" className="usage-cost-action" data-testid="usage-cost-notes-trigger">
                {isZh ? '计价说明' : 'Pricing notes'}
              </Button>
            )}
          >
            <UsageCostNotes rollup={rollup} isZh={isZh} />
          </Popover>
          {rollup.byModelKey.length > 0 ? (
            <Button
              variant="ghost"
              size="compact"
              className="usage-cost-action"
              aria-expanded={detailsOpen}
              aria-controls={USAGE_COST_DETAILS_ID}
              data-testid="usage-cost-details-toggle"
              onClick={() => onDetailsOpen(!detailsOpen)}
            >
              {isZh ? (detailsOpen ? '收起明细' : '费用明细') : detailsOpen ? 'Hide breakdown' : 'Breakdown'}
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function UsageCostNotes({ rollup, isZh }: { rollup: UsageRollup; isZh: boolean }): ReactElement {
  const overview = resolveUsageCostOverview(rollup);
  const catalog = rollup.pricingCatalog;
  const mappings = listUsageCostReferenceMappings(rollup.byModelKey);
  const catalogLabel = catalog
    ? `${catalog.source === 'models.dev' ? 'models.dev' : isZh ? 'Pi 内置目录' : 'Pi catalog'}${catalog.fetchedAt ? ` · ${catalog.fetchedAt.slice(0, 10)}` : ''}`
    : isZh ? '未知' : 'Unknown';
  return (
    <div className="usage-cost-notes-body">
      <dl className="usage-cost-notes-facts">
        <div>
          <dt>{isZh ? '精确金额' : 'Exact amount'}</dt>
          <dd data-testid="usage-cost-exact">{formatUsageUsd(overview.totalUsd)}</dd>
        </div>
        <div>
          <dt>{isZh ? '计价覆盖' : 'Coverage'}</dt>
          <dd data-testid="usage-cost-coverage">
            {isZh
              ? `已计价 ${formatUsageExact(overview.pricedCount)} / ${formatUsageExact(overview.entryCount)} 次`
              : `${formatUsageExact(overview.pricedCount)} / ${formatUsageExact(overview.entryCount)} calls priced`}
            {overview.unpricedCount > 0
              ? isZh ? ` · 未计价 ${formatUsageExact(overview.unpricedCount)} 次` : ` · ${formatUsageExact(overview.unpricedCount)} unpriced`
              : ''}
          </dd>
        </div>
        <div>
          <dt>{isZh ? '价格目录' : 'Catalog'}</dt>
          <dd data-testid="usage-cost-source" title={catalog?.catalogVersion}>{catalogLabel}</dd>
        </div>
      </dl>
      <p className="usage-cost-notes-basis">
        {isZh
          ? '参考估算，不是实际扣费。按当前目录基础单价重估全部历史，含缓存读写；不含长上下文阶梯、缓存 TTL、服务等级、渠道折扣与工具附加费。'
          : 'A reference estimate, not a charge. All history is re-estimated at current catalog base rates, including cache reads/writes; long-context tiers, cache TTLs, service tiers, discounts and tool fees are excluded.'}
      </p>
      {mappings.length > 0 ? (
        <div className="usage-cost-notes-mappings" data-testid="usage-cost-mappings">
          <span>{isZh ? '计价参考' : 'Priced as'}</span>
          <ul>
            {mappings.map((mapping) => (
              <li key={`${mapping.modelId}\u0000${mapping.reference}`}>
                <code>{mapping.modelId}</code> → <code>{mapping.reference}</code>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
