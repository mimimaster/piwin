/** Opt-in model × Key cost breakdown. One compact table, no second headline. */
import type { ReactElement } from 'react';
import type { UsageModelKeyTotal } from '@piwin/contracts';
import { formatUsageCompact, formatUsageExact, formatUsageUsd } from './usage-panel-statistics';
import { sortUsageCostRows, USAGE_COST_DETAILS_ID } from './usage-cost-view';

export function UsageCostDetails({ rows, isZh }: {
  rows: readonly UsageModelKeyTotal[];
  isZh: boolean;
}): ReactElement {
  return (
    <section
      id={USAGE_COST_DETAILS_ID}
      className="usage-card usage-cost-details"
      data-testid="usage-cost-details"
      aria-label={isZh ? '费用明细：按模型与 Key' : 'Cost breakdown by model and Key'}
    >
      <div className="usage-table-scroll usage-cost-details-scroll">
        <table className="usage-table usage-cost-table">
          <thead>
            <tr>
              <th>{isZh ? '模型' : 'Model'}</th>
              <th>Key</th>
              <th className="usage-num">{isZh ? '请求数' : 'Calls'}</th>
              <th className="usage-num">Token</th>
              <th className="usage-num">{isZh ? '估算费用' : 'Est. cost'}</th>
            </tr>
          </thead>
          <tbody>
            {sortUsageCostRows(rows).map((row) => {
              const unpriced = row.entryCount - (row.pricedEntryCount ?? 0);
              return (
                <tr key={JSON.stringify([row.providerId, row.modelId])} data-testid="usage-cost-model-row">
                  <td className="usage-table-model">
                    <strong title={row.costReference ? `${row.modelId} → ${row.costReference}` : row.modelId}>
                      {row.modelId}
                    </strong>
                  </td>
                  <td><span className="usage-key-label">{row.providerId ?? (isZh ? '未知 Key' : 'Unknown Key')}</span></td>
                  <td className="usage-num">{formatUsageExact(row.entryCount)}</td>
                  <td className="usage-num" title={formatUsageExact(row.totalTokens)}>{formatUsageCompact(row.totalTokens)}</td>
                  <td className="usage-num" data-testid="usage-cost-row-cost">
                    {formatUsageUsd(row.estimatedCostUsd)}
                    {unpriced > 0 && row.estimatedCostUsd !== undefined ? (
                      <small>{isZh ? `${formatUsageExact(unpriced)} 次未计价` : `${formatUsageExact(unpriced)} unpriced`}</small>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
