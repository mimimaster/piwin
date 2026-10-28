/**
 * Reference cost as the first of the usage summary cards. It reads like its
 * peers (headline, two pairs, one meta line); the breakdown, trend and
 * pricing notes live in the 费用构成 section below.
 */
import type { ReactElement } from 'react';
import type { UsageRollup } from '@piwin/contracts';
import { formatUsageExact } from './usage-panel-statistics';
import {
  formatUsageUsdAverage,
  formatUsageUsdSummary,
  resolveUsageCostOverview,
} from './usage-cost-view';
import '../styles/usage-cost.css';

export function UsageCostOverviewCard({ rollup, dayCount, isZh }: {
  rollup: UsageRollup;
  /** Days in the selected range, for the daily average. */
  dayCount: number;
  isZh: boolean;
}): ReactElement {
  const overview = resolveUsageCostOverview(rollup);
  const priced = overview.totalUsd !== undefined && overview.pricedCount > 0;
  const dailyUsd = priced && dayCount > 0 ? (overview.totalUsd ?? 0) / dayCount : undefined;
  const perCallUsd = priced ? (overview.totalUsd ?? 0) / overview.pricedCount : undefined;
  const coverage = overview.entryCount > 0 ? overview.pricedCount / overview.entryCount : 0;
  const meta = (() => {
    switch (overview.state) {
      case 'unsupported':
        return isZh ? '当前 Host 不提供费用估算' : 'This Host does not estimate cost';
      case 'partial':
        return isZh
          ? `已计价 ${formatCoverage(coverage)} · ${formatUsageExact(overview.unpricedCount)} 次未计价`
          : `${formatCoverage(coverage)} priced · ${formatUsageExact(overview.unpricedCount)} unpriced`;
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
        <UsdAmount text={formatUsageUsdSummary(overview.totalUsd)} />
      </strong>
      <dl className="usage-summary-pairs">
        <div>
          <dt>{isZh ? '日均' : 'Per day'}</dt>
          <dd data-testid="usage-cost-daily">{formatUsageUsdAverage(dailyUsd)}</dd>
        </div>
        <div>
          <dt>{isZh ? '每次请求' : 'Per call'}</dt>
          <dd data-testid="usage-cost-per-call">{formatUsageUsdAverage(perCallUsd)}</dd>
        </div>
      </dl>
      <span
        className="usage-summary-meta usage-cost-meta"
        data-testid="usage-cost-meta"
        data-attention={overview.state === 'partial' || overview.state === 'unpriced' ? 'true' : undefined}
      >
        {meta}
      </span>
    </section>
  );
}

function formatCoverage(rate: number): string {
  // 99.6% must not read as complete coverage.
  const percent = Math.floor(rate * 1000) / 10;
  return `${percent >= 10 ? Math.floor(percent) : percent}%`;
}

/** The dollar sign reads as a unit, not a glyph as tall as the digits. */
function UsdAmount({ text }: { text: string }) {
  const match = /^(<?\$)(.*)$/.exec(text);
  if (!match) return <>{text}</>;
  return (
    <>
      <span className="usage-cost-currency">{match[1]}</span>
      {match[2]}
    </>
  );
}
