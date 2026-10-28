/**
 * Daily (or weekly) cost bars. Hover only changes the readout line and bar
 * colour, never layout, so the chart does not move under the pointer.
 */
import { useState, type ReactElement } from 'react';
import { formatUsageExact } from './usage-panel-statistics';
import { formatUsageUsdAverage, formatUsageUsdSummary } from './usage-cost-view';
import type { UsageCostBar, UsageCostSeries } from './usage-cost-daily';

const X_TICK_COUNT = 5;

export function UsageCostTrend({ series, locale, isZh }: {
  series: UsageCostSeries;
  locale: string;
  isZh: boolean;
}): ReactElement {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const { bars, axisMaxUsd, peak } = series;
  const weekly = series.bucketDays === 7;
  const totalUsd = bars.reduce((sum, bar) => sum + (bar.costUsd ?? 0), 0);
  const hovered = hoverIndex === null ? undefined : bars[hoverIndex];
  const label = (bar: UsageCostBar): string => formatBarLabel(bar, locale, isZh);

  const readout = (() => {
    if (hovered) {
      const amount = hovered.costUsd === undefined
        ? isZh ? '未计价' : 'unpriced'
        : formatUsageUsdSummary(hovered.costUsd);
      const calls = isZh ? `${formatUsageExact(hovered.calls)} 次请求` : `${formatUsageExact(hovered.calls)} calls`;
      return `${label(hovered)} · ${amount} · ${calls}`;
    }
    if (!peak || axisMaxUsd === 0) return isZh ? '暂无可计价费用' : 'No priced cost yet';
    const average = formatUsageUsdAverage(series.dayCount > 0 ? totalUsd / series.dayCount : undefined);
    return isZh
      ? `峰值 ${label(peak)} · ${formatUsageUsdSummary(peak.costUsd)} · 日均 ${average}`
      : `Peak ${label(peak)} · ${formatUsageUsdSummary(peak.costUsd)} · ${average}/day`;
  })();

  const ticks = pickTickIndexes(bars.length);
  return (
    <div className="usage-cost-trend" data-testid="usage-cost-trend">
      <div className="usage-cost-trend-head">
        <span>{weekly ? (isZh ? '每周费用' : 'Weekly cost') : isZh ? '每日费用' : 'Daily cost'}</span>
        <span className="usage-cost-trend-readout" data-active={hovered ? 'true' : undefined} data-testid="usage-cost-trend-readout">
          {readout}
        </span>
      </div>
      <div className="usage-cost-trend-plot">
        <div className="usage-cost-trend-axis" aria-hidden="true">
          <span>{formatAxis(axisMaxUsd)}</span>
          <span>{formatAxis(axisMaxUsd / 2)}</span>
          <span>$0</span>
        </div>
        <div
          className="usage-cost-trend-bars"
          role="img"
          aria-label={readout}
          data-hovering={hovered ? 'true' : undefined}
          onMouseLeave={() => setHoverIndex(null)}
        >
          {bars.map((bar, index) => (
            <div
              key={bar.start}
              className="usage-cost-trend-slot"
              data-active={index === hoverIndex ? 'true' : undefined}
              data-unpriced={bar.costUsd === undefined ? 'true' : undefined}
              data-testid="usage-cost-trend-bar"
              onMouseEnter={() => setHoverIndex(index)}
            >
              <span style={{ height: barHeight(bar, axisMaxUsd) }} />
            </div>
          ))}
        </div>
        <span aria-hidden="true" />
        <div className="usage-cost-trend-ticks" aria-hidden="true">
          {ticks.map((index) => {
            const bar = bars[index];
            return bar ? <span key={bar.start}>{formatDay(bar.start, locale)}</span> : null;
          })}
        </div>
      </div>
    </div>
  );
}

function barHeight(bar: UsageCostBar, axisMaxUsd: number): string {
  if (bar.costUsd === undefined) return '2px';
  if (axisMaxUsd <= 0 || bar.costUsd <= 0) return '0';
  // Keep any priced spend visible even when it is tiny next to the peak.
  return `max(2px, ${((bar.costUsd / axisMaxUsd) * 100).toFixed(2)}%)`;
}

function pickTickIndexes(count: number): number[] {
  if (count <= 0) return [];
  if (count <= X_TICK_COUNT) return Array.from({ length: count }, (_, index) => index);
  const step = (count - 1) / (X_TICK_COUNT - 1);
  return Array.from({ length: X_TICK_COUNT }, (_, index) => Math.round(index * step));
}

function formatDay(key: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${key}T00:00:00Z`));
}

function formatBarLabel(bar: UsageCostBar, locale: string, isZh: boolean): string {
  if (bar.start === bar.end) return formatDay(bar.start, locale);
  return `${formatDay(bar.start, locale)}${isZh ? ' – ' : '–'}${formatDay(bar.end, locale)}`;
}

function formatAxis(value: number): string {
  if (value <= 0) return '$0';
  if (value >= 1000) return `$${(value / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })}k`;
  return `$${value.toLocaleString('en-US', { maximumFractionDigits: value < 1 ? 3 : 1 })}`;
}
