import type { ReactElement } from 'react';
import { CircleAlert } from 'lucide-react';
import type { UsageRollup } from '@piwin/contracts';
import { formatUsageExact } from './usage-panel-statistics.js';
import { formatUsageUsdSummary, resolveUsageCostOverview } from './usage-cost-view.js';
import { UsagePricingInfo } from './usage-pricing-info.js';
import '../styles/usage-cost.css';

/** Cost is a supporting usage metric; incomplete coverage stays visible. */
export function UsageCostReadout({ rollup, isZh }: { rollup: UsageRollup; isZh: boolean }): ReactElement {
  const overview = resolveUsageCostOverview(rollup);
  const warning = overview.state === 'partial' || overview.state === 'unpriced'
    ? isZh ? `未计价 ${formatUsageExact(overview.unpricedCount)} 次` : `${formatUsageExact(overview.unpricedCount)} unpriced`
    : overview.state === 'unsupported' ? (isZh ? '费用暂不可用' : 'Cost unavailable') : null;
  const label = overview.state === 'partial' ? (isZh ? '已计价估算' : 'Priced estimate') : isZh ? '参考估算' : 'Reference estimate';
  return (
    <div className="usage-summary-cost" data-cost-state={overview.state}>
      <span title={isZh ? 'USD · 按当前模型参考价估算，非实际扣费' : 'USD · estimate at current reference rates, not a charge'}>
        {label} <strong data-testid="usage-cost-total">{formatUsageUsdSummary(overview.totalUsd)}</strong>
      </span>
      {warning ? <span className="usage-cost-warning" data-testid="usage-cost-meta"><CircleAlert size={12} aria-hidden="true" />{warning}</span> : null}
      <UsagePricingInfo rollup={rollup} isZh={isZh} />
    </div>
  );
}
