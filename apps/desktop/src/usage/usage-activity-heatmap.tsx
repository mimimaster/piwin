/**
 * Usage heatmap: the last year as a weeks × weekdays grid, one cell per day,
 * shaded by quartile of that day's usage — "which days, and how much" at a
 * glance. It reads its own one-year rollup so the page's range selector (7 or
 * 30 days) never shrinks the calendar to a few columns.
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import type { HostResponse, UsageBucket, UsageRollup } from '@piwin/contracts';
import { SegmentedControl } from '@piwin/ui-kit';
import { CalendarDays, Flame } from 'lucide-react';
import { formatUsageUsdSummary, resolveUsageCostOverview } from './usage-cost-view.js';
import { UsageSummaryDetail } from './usage-summary-detail.js';
import { formatUsageCompact, formatUsageExact, normalizeUsageRollup } from './usage-panel-statistics';
import {
  buildUsageActivityCalendar,
  USAGE_ACTIVITY_WEEKS,
  type UsageActivityCell,
  type UsageActivityMetric,
} from './usage-activity-calendar';

export type UsageActivityHeatmapProps = {
  request: (command: {
    type: 'usage/get-rollup';
    projectPath?: string;
    modelId?: string;
    window?: { from?: string };
    timeZone?: string;
  }) => Promise<HostResponse>;
  projectPath?: string;
  modelId?: string;
  timeZone: string;
  /** Changes whenever the page refreshes, so the calendar re-reads with it. */
  reloadKey: string | null;
  locale: string;
  isZh: boolean;
};

const YEAR_WINDOW_DAYS = USAGE_ACTIVITY_WEEKS * 7 + 7;

function formatDay(day: string, locale: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(locale, {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    weekday: 'short',
  });
}

function formatMonth(month: string, locale: string): string {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString(locale, {
    timeZone: 'UTC',
    month: 'short',
  });
}

function formatValue(value: number, metric: UsageActivityMetric, isZh: boolean): string {
  if (metric === 'tokens') return `${formatUsageCompact(Math.round(value))} tokens`;
  const count = formatUsageExact(Math.round(value));
  return isZh ? `${count} 次请求` : `${count} requests`;
}

function useYearByDay(props: UsageActivityHeatmapProps): Record<string, UsageBucket> | null {
  const { request, projectPath, modelId, timeZone, reloadKey } = props;
  const [byDay, setByDay] = useState<Record<string, UsageBucket> | null>(null);
  useEffect(() => {
    let cancelled = false;
    const from = new Date(Date.now() - YEAR_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
    void request({
      type: 'usage/get-rollup',
      ...(projectPath ? { projectPath } : {}),
      ...(modelId ? { modelId } : {}),
      window: { from },
      timeZone,
    })
      .then((response) => {
        if (cancelled || !response.success) return;
        const data = response.data as { rollup?: UsageRollup };
        setByDay(normalizeUsageRollup(data.rollup).byDay);
      })
      .catch((error: unknown) => {
        // The summary cards above surface request failures; the calendar just stays empty.
        console.warn('[usage] heatmap rollup failed', error);
      });
    return () => {
      cancelled = true;
    };
  }, [request, projectPath, modelId, timeZone, reloadKey]);
  return byDay;
}

export function UsageActivityHeatmap(props: UsageActivityHeatmapProps): ReactElement {
  const { locale, isZh, timeZone } = props;
  const byDay = useYearByDay(props);
  const [metric, setMetric] = useState<UsageActivityMetric>('tokens');
  const [hovered, setHovered] = useState<{ column: number; row: number } | null>(null);
  const calendar = useMemo(
    () => buildUsageActivityCalendar(byDay ?? {}, metric, { timeZone }),
    [byDay, metric, timeZone],
  );
  const { weeks, monthStarts, activeDays, activeAverage, peak, today, streak } = calendar;
  const hoveredCell = hovered === null ? null : (weeks[hovered.column]?.[hovered.row] ?? null);
  const scopeLabel = isZh ? '过去一年 · 不随上方时间范围变化' : 'Past year · independent of the time range above';
  const activityHint = isZh
    ? `日均（活跃日）${activeAverage === null ? '—' : formatValue(activeAverage, metric, isZh)} · 峰值 ${peak === null ? '—' : `${formatValue(peak.value, metric, isZh)} · ${formatDay(peak.day, locale)}`}`
    : `Avg / active day ${activeAverage === null ? '—' : formatValue(activeAverage, metric, isZh)} · Peak ${peak === null ? '—' : `${formatValue(peak.value, metric, isZh)} · ${formatDay(peak.day, locale)}`}`;
  const weekdayLabels = isZh ? ['一', '', '三', '', '五', '', ''] : ['Mon', '', 'Wed', '', 'Fri', '', ''];

  return (
    <section className="usage-card usage-heatmap-card" data-testid="usage-activity-heatmap">
      <div className="usage-section-header usage-heatmap-header">
        <div className="usage-heatmap-heading">
          <h3>
            {isZh ? '用量活跃度' : 'Usage activity'}
            <span className="usage-scope-pill" data-testid="usage-heatmap-scope" title={scopeLabel}>
              {isZh ? '过去一年' : 'Past year'}
            </span>
          </h3>
        </div>
        <SegmentedControl
          size="xs"
          className="usage-heatmap-metric"
          aria-label={isZh ? '热力图指标' : 'Heatmap metric'}
          value={metric}
          onChange={(value) => setMetric(value as UsageActivityMetric)}
          data={[
            { value: 'tokens', label: 'Token' },
            { value: 'requests', label: isZh ? '请求数' : 'Requests' },
          ]}
          testId="usage-activity-metric"
        />
      </div>

      <div className="usage-heatmap-figure">
        <div className="usage-heatmap-weekdays" aria-hidden="true">
          {weekdayLabels.map((label, index) => (
            <span key={index}>{label}</span>
          ))}
        </div>
        <div className="usage-heatmap-body">
          <div
            className="usage-heatmap-grid"
            style={{ gridTemplateColumns: `repeat(${weeks.length}, minmax(0, 1fr))` }}
            onMouseLeave={() => setHovered(null)}
            data-testid="usage-heatmap-grid"
          >
            {weeks.map((week, column) =>
              week.map((cell, row) =>
                cell === null ? (
                  <span key={`${column}-${row}`} className="usage-heatmap-cell" data-future="true" />
                ) : (
                  <span
                    key={cell.day}
                    className="usage-heatmap-cell"
                    data-level={cell.level}
                    data-today={cell.day === today?.day ? 'true' : undefined}
                    role="img"
                    aria-label={`${formatDay(cell.day, locale)}: ${formatValue(cell.value, metric, isZh)}`}
                    onMouseEnter={() => setHovered({ column, row })}
                  />
                ),
              ),
            )}
            {hoveredCell !== null && hovered !== null ? (
              <HeatmapTooltip
                cell={hoveredCell}
                metric={metric}
                locale={locale}
                isZh={isZh}
                left={(hovered.column + 0.5) / weeks.length}
                top={hovered.row / 7}
              />
            ) : null}
          </div>
          <div
            className="usage-heatmap-months"
            style={{ gridTemplateColumns: `repeat(${weeks.length}, minmax(0, 1fr))` }}
            aria-hidden="true"
          >
            {monthStarts.map(({ column, month }) => (
              <span key={month} style={{ gridColumn: `${column + 1} / span 4` }}>
                {formatMonth(month, locale)}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="usage-heatmap-footer">
        <div className="usage-heatmap-stats" title={activityHint}>
          <UsageSummaryDetail icon={CalendarDays} label={isZh ? '活跃天数' : 'Active days'}>
            {isZh ? `${formatUsageExact(activeDays)} 天活跃` : `${formatUsageExact(activeDays)} active days`}
          </UsageSummaryDetail>
          <UsageSummaryDetail icon={Flame} label={isZh ? '连续活跃' : 'Streak'}>
            {isZh ? `连续 ${streak} 天` : `${streak}-day streak`}
          </UsageSummaryDetail>
        </div>
        <div className="usage-heatmap-legend" aria-hidden="true">
          <span>{isZh ? '少' : 'Less'}</span>
          {[0, 1, 2, 3, 4].map((level) => (
            <i key={level} className="usage-heatmap-cell" data-level={level} />
          ))}
          <span>{isZh ? '多' : 'More'}</span>
        </div>
      </div>
    </section>
  );
}

function HeatmapTooltip(props: {
  cell: UsageActivityCell;
  metric: UsageActivityMetric;
  locale: string;
  isZh: boolean;
  left: number;
  top: number;
}): ReactElement {
  const { cell, isZh } = props;
  const other: UsageActivityMetric = props.metric === 'tokens' ? 'requests' : 'tokens';
  const cost = cell.bucket ? resolveUsageCostOverview(cell.bucket) : null;
  const edge = props.left < 0.1 ? 'start' : props.left > 0.9 ? 'end' : 'center';
  return (
    <div
      className="usage-heatmap-tooltip"
      data-edge={edge}
      style={{ left: `${props.left * 100}%`, top: `${props.top * 100}%` }}
      data-testid="usage-heatmap-tooltip"
    >
      <strong>
        {formatValue(cell.value, props.metric, isZh)}
        <span> · {formatDay(cell.day, props.locale)}</span>
      </strong>
      {cost ? <span data-testid="usage-heatmap-cost">
        {isZh ? '参考估算' : 'Reference estimate'} {formatUsageUsdSummary(cost.totalUsd)}
        {cost.unpricedCount > 0 ? (isZh ? ` · ${formatUsageExact(cost.unpricedCount)} 次未计价` : ` · ${formatUsageExact(cost.unpricedCount)} unpriced`) : ''}
      </span> : null}
      {cell.bucket !== undefined ? (
        <span>
          {formatValue(
            other === 'tokens' ? cell.bucket.totalTokens : cell.bucket.entryCount,
            other,
            isZh,
          )}
          {' · '}
          {isZh ? '输出' : 'output'} {formatUsageCompact(cell.bucket.completionTokens)}
        </span>
      ) : null}
    </div>
  );
}
