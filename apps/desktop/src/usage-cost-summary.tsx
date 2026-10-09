import type { ReactElement } from 'react';
import type { UsageRollup } from '@piwin/contracts';
import { formatUsageExact, formatUsageUsd } from './usage-panel-statistics';
import './styles/usage-cost-summary.css';

export function UsageCostSummary({ rollup, isZh }: {
  rollup: UsageRollup;
  isZh: boolean;
}): ReactElement {
  const priced = rollup.pricedEntryCount;
  const unpriced = Math.max(0, rollup.entryCount - (priced ?? 0));
  const total = rollup.entryCount === 0 && priced !== undefined ? 0 : rollup.estimatedCostUsd;
  const catalog = rollup.pricingCatalog;
  const rows = [...rollup.byModelKey].sort(
    (left, right) => (right.estimatedCostUsd ?? -1) - (left.estimatedCostUsd ?? -1),
  );
  return (
    <section className="usage-card usage-model-key-card usage-cost-card" data-testid="usage-cost-summary">
      <div className="usage-section-header">
        <div className="usage-cost-heading">
          <h3>{isZh ? '参考费用（USD）' : 'Reference cost (USD)'}</h3>
          <p>{isZh
            ? '按当前模型目录基础单价换算，含缓存读写；同步价格后会重新估算历史用量。'
            : 'At current catalog base rates, including cache reads/writes. Price sync re-estimates history.'}</p>
        </div>
        <strong className="usage-summary-value" data-testid="usage-cost-total">
          {formatUsageUsd(total)}
        </strong>
      </div>
      <p className="usage-summary-meta" data-testid="usage-cost-coverage">
        {priced === undefined
          ? isZh ? '当前 Host 尚未提供费用统计' : 'This Host does not provide cost estimates yet'
          : isZh
            ? `已计价 ${formatUsageExact(priced)} / ${formatUsageExact(rollup.entryCount)} 次 · 未计价 ${formatUsageExact(unpriced)} 次`
            : `${formatUsageExact(priced)} / ${formatUsageExact(rollup.entryCount)} calls priced · ${formatUsageExact(unpriced)} unpriced`}
        {catalog ? (
          <span title={catalog.catalogVersion} data-testid="usage-cost-source">
            {' · '}{catalog.source === 'models.dev' ? 'models.dev' : isZh ? 'Pi 内置目录' : 'Pi catalog'}
            {catalog.fetchedAt ? ` · ${catalog.fetchedAt.slice(0, 10)}` : ''}
          </span>
        ) : null}
      </p>
      {rows.length > 0 ? (
        <div className="usage-table-scroll">
          <table className="usage-table usage-cost-table" aria-label={isZh ? '模型与 Key 参考费用' : 'Model and Key reference costs'}>
            <thead>
              <tr>
                <th>{isZh ? '模型 / 计价参考' : 'Model / pricing reference'}</th>
                <th>Key</th>
                <th>{isZh ? '已计价 / 请求' : 'Priced / calls'}</th>
                <th>{isZh ? '参考费用（USD）' : 'Reference cost (USD)'}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={JSON.stringify([row.providerId, row.modelId])} data-testid="usage-cost-model-row">
                  <td className="usage-table-model">
                    <strong title={row.modelId}>{row.modelId}</strong>
                    {row.costReference ? <span className="usage-summary-meta usage-cost-reference" title={row.costReference}>{row.costReference}</span> : null}
                  </td>
                  <td><span className="usage-key-label">{row.providerId ?? (isZh ? '未知 Key' : 'Unknown Key')}</span></td>
                  <td>{formatUsageExact(row.pricedEntryCount ?? 0)} / {formatUsageExact(row.entryCount)}</td>
                  <td>{formatUsageUsd(row.estimatedCostUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
