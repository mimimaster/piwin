import type { ReactElement } from 'react';
import { Activity, ArrowDownLeft, ArrowUpRight, CalendarDays, Database, Layers, MessagesSquare } from 'lucide-react';
import { computePromptCacheHitRate, type UsageRollup } from '@piwin/contracts';
import { UsageCostReadout } from './usage-cost-readout.js';
import { UsageSummaryDetail } from './usage-summary-detail.js';
import { formatUsageCompact, formatUsageDate, formatUsageExact, formatUsagePercent } from './usage-panel-statistics.js';

export function UsageSummary({ rollup, locale, isZh }: {
  rollup: UsageRollup;
  locale: string;
  isZh: boolean;
}): ReactElement {
  const cacheRead = rollup.cacheReadTokens ?? 0;
  const cacheWrite = rollup.cacheWriteTokens ?? 0;
  const promptTotal = rollup.promptTokens + cacheRead + cacheWrite;
  const activeDays = Object.values(rollup.byDay).filter((bucket) => bucket.totalTokens > 0).length;
  const range = `${formatUsageDate(rollup.firstAt, locale)} – ${formatUsageDate(rollup.lastAt, locale)}`;
  const totalHint = isZh
    ? `直接输入 ${formatUsageExact(rollup.promptTokens)} · 输出 ${formatUsageExact(rollup.completionTokens)} · 总量含缓存读写 ${formatUsageExact(cacheRead + cacheWrite)} Token`
    : `Total includes ${formatUsageExact(cacheRead + cacheWrite)} cache read/write tokens`;
  const cacheHint = isZh
    ? `缓存率 = 缓存读取 ÷ 提示词总量（直接输入 + 缓存读写）；提示词共 ${formatUsageExact(promptTotal)}`
    : `Cache hit rate = cache read ÷ prompt total (direct input + cache read/write); ${formatUsageExact(promptTotal)} prompt tokens`;
  return (
    <div className="usage-summary-grid">
      <section className="usage-summary-card" data-testid="usage-total-card">
        <span className="usage-summary-label"><Layers size={14} aria-hidden="true" />{isZh ? '总用量' : 'Total tokens'}</span>
        <strong className="usage-summary-value" data-testid="usage-total" title={totalHint}>{formatUsageCompact(rollup.totalTokens)}</strong>
        <UsageCostReadout rollup={rollup} isZh={isZh} />
      </section>
      <section className="usage-summary-card usage-summary-card-cache" data-testid="usage-cache-summary" title={cacheHint}>
        <span className="usage-summary-label"><Database size={14} aria-hidden="true" />{isZh ? '缓存命中率' : 'Cache hit rate'}</span>
        <strong className="usage-summary-value" data-testid="usage-cache-rate">{formatUsagePercent(computePromptCacheHitRate(rollup))}</strong>
        <div className="usage-summary-details">
          <UsageSummaryDetail icon={ArrowDownLeft} label={isZh ? '缓存读取' : 'Cache read'}>{formatUsageCompact(cacheRead)}</UsageSummaryDetail>
          <UsageSummaryDetail icon={ArrowUpRight} label={isZh ? '缓存写入' : 'Cache write'}>{formatUsageCompact(cacheWrite)}</UsageSummaryDetail>
        </div>
      </section>
      <section className="usage-summary-card" title={range}>
        <span className="usage-summary-label"><Activity size={14} aria-hidden="true" />{isZh ? '请求数' : 'Requests'}</span>
        <strong className="usage-summary-value" data-testid="usage-request-count">{formatUsageExact(rollup.entryCount)}</strong>
        <div className="usage-summary-details">
          <UsageSummaryDetail icon={MessagesSquare} label={isZh ? '会话' : 'Sessions'}>{formatUsageExact(rollup.sessionCount)}</UsageSummaryDetail>
          <UsageSummaryDetail icon={CalendarDays} label={isZh ? '活跃天数' : 'Active days'}>{formatUsageExact(activeDays)}</UsageSummaryDetail>
        </div>
      </section>
    </div>
  );
}
