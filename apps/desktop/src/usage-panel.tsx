/**
 * Token usage statistics & activity dashboard panel (CE-OBS).
 * Renders token metrics, GitHub-style activity contribution heatmap grid,
 * interactive SVG daily trend chart, provider/model token distribution visualizers,
 * and a per-session breakdown list.
 */
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { Button } from '@piwin/ui-kit';
import type { HostResponse, UsageBucket, UsageRollup, UsageSessionTotal } from '@piwin/contracts';
import { useDesktopLocale } from './desktop-locale-context';

export type UsagePanelProps = {
  /** Current trusted project path; null when no project is open. */
  projectPath: string | null;
  request: (command: {
    type: 'usage/get-rollup';
    projectPath?: string;
    scope?: { kind: 'general' };
    window?: { from?: string; to?: string };
    topSessions?: number;
  }) => Promise<HostResponse>;
  /** Open a session from the breakdown list (resume). */
  onOpenSession?: (sessionId: string) => void;
};

type ScopeMode = 'project' | 'global';
type TimeRange = 'all' | 'today' | '7d' | '30d' | '1y';
type ChartMetric = 'total' | 'split' | 'turns';

function resolveWindow(range: TimeRange): { from?: string; to?: string } | undefined {
  if (range === 'all') return undefined;
  const now = Date.now();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  let fromMs: number;
  if (range === 'today') {
    fromMs = startOfToday.getTime();
  } else if (range === '7d') {
    fromMs = now - 7 * 24 * 60 * 60 * 1000;
  } else if (range === '30d') {
    fromMs = now - 30 * 24 * 60 * 60 * 1000;
  } else if (range === '1y') {
    fromMs = now - 365 * 24 * 60 * 60 * 1000;
  } else {
    fromMs = now - 30 * 24 * 60 * 60 * 1000;
  }
  return { from: new Date(fromMs).toISOString() };
}

/** Derive a provider label from a model id ("provider/model" or "provider::model"). */
function providerOfModel(modelId: string): string {
  const slash = modelId.indexOf('/');
  if (slash > 0) return modelId.slice(0, slash);
  const sep = modelId.indexOf('::');
  if (sep > 0) return modelId.slice(0, sep);
  return modelId;
}

const PROVIDER_COLORS: Record<string, string> = {
  openai: '#10a37f',
  anthropic: '#d97706',
  google: '#4285f4',
  gemini: '#8ab4f8',
  ollama: '#06b6d4',
  deepseek: '#6366f1',
  openrouter: '#ec4899',
  mistral: '#f97316',
  groq: '#f43f5e',
  azure: '#0284c7',
  bedrock: '#f59e0b',
  custom: '#8b5cf6',
};

function getProviderColor(provider: string, index: number): string {
  const normalized = provider.toLowerCase();
  if (PROVIDER_COLORS[normalized]) return PROVIDER_COLORS[normalized];
  const fallbackColors = [
    '#3b82f6',
    '#10b981',
    '#8b5cf6',
    '#f59e0b',
    '#ec4899',
    '#06b6d4',
    '#6366f1',
    '#84cc16',
    '#14b8a6',
    '#a855f7',
  ];
  return fallbackColors[index % fallbackColors.length];
}

const EMPTY_ROLLUP: UsageRollup = {
  scope: { kind: 'global' },
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  entryCount: 0,
  sessionCount: 0,
  firstAt: null,
  lastAt: null,
  byModel: {},
  byDay: {},
  bySession: [],
};

function formatNumber(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}k`;
  }
  return String(value);
}

function formatFull(value: number): string {
  return value.toLocaleString('en-US');
}

/** Generate a 52-week activity contribution grid ending at today or last activity date. */
function generateHeatmapGrid(byDay: Record<string, UsageBucket>): {
  weeks: Array<{
    dates: Array<{
      dateStr: string;
      bucket?: UsageBucket;
      level: number;
    }>;
  }>;
  months: Array<{ name: string; weekIndex: number }>;
  totalActiveDays: number;
  maxDayTokens: number;
} {
  const endDate = new Date();
  endDate.setHours(0, 0, 0, 0);

  // Align end to current week Saturday (day 6)
  const endDayOfWeek = endDate.getDay();
  const gridEnd = new Date(endDate);
  gridEnd.setDate(gridEnd.getDate() + (6 - endDayOfWeek));

  // 52 weeks = 364 days
  const gridStart = new Date(gridEnd);
  gridStart.setDate(gridStart.getDate() - 364 + 1);

  let totalActiveDays = 0;
  let maxDayTokens = 1;

  for (const bucket of Object.values(byDay)) {
    if (bucket.totalTokens > maxDayTokens) {
      maxDayTokens = bucket.totalTokens;
    }
    if (bucket.totalTokens > 0) {
      totalActiveDays++;
    }
  }

  const weeks: Array<{
    dates: Array<{
      dateStr: string;
      bucket?: UsageBucket;
      level: number;
    }>;
  }> = [];
  const months: Array<{ name: string; weekIndex: number }> = [];

  let lastMonth = -1;
  const cur = new Date(gridStart);
  let currentWeek: Array<{ dateStr: string; bucket?: UsageBucket; level: number }> = [];

  for (let i = 0; i < 364; i++) {
    const year = cur.getFullYear();
    const month = cur.getMonth();
    const dateNum = cur.getDate();
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(dateNum).padStart(2, '0')}`;

    if (currentWeek.length === 0) {
      if (month !== lastMonth) {
        const monthName = cur.toLocaleString('en-US', { month: 'short' });
        months.push({ name: monthName, weekIndex: weeks.length });
        lastMonth = month;
      }
    }

    const bucket = byDay[dateStr];
    let level = 0;
    if (bucket && bucket.totalTokens > 0) {
      const ratio = bucket.totalTokens / maxDayTokens;
      if (ratio <= 0.25) level = 1;
      else if (ratio <= 0.5) level = 2;
      else if (ratio <= 0.75) level = 3;
      else level = 4;
    }

    currentWeek.push({ dateStr, bucket, level });

    if (currentWeek.length === 7) {
      weeks.push({ dates: currentWeek });
      currentWeek = [];
    }

    cur.setDate(cur.getDate() + 1);
  }

  if (currentWeek.length > 0) {
    weeks.push({ dates: currentWeek });
  }

  return { weeks, months, totalActiveDays, maxDayTokens };
}

export function UsagePanel(props: UsagePanelProps): ReactElement {
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';
  const [scopeMode, setScopeMode] = useState<ScopeMode>(props.projectPath ? 'project' : 'global');
  const [timeRange, setTimeRange] = useState<TimeRange>('all');
  const [chartMetric, setChartMetric] = useState<ChartMetric>('total');
  const [hoveredBarIndex, setHoveredBarIndex] = useState<number | null>(null);
  const [rollup, setRollup] = useState<UsageRollup>(EMPTY_ROLLUP);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const scope =
      scopeMode === 'global'
        ? { kind: 'global' as const }
        : props.projectPath
          ? { kind: 'project' as const, projectPath: props.projectPath }
          : { kind: 'global' as const };
    const window = resolveWindow(timeRange);
    const response = await props.request({
      type: 'usage/get-rollup',
      ...(scope.kind === 'project' ? { projectPath: scope.projectPath } : {}),
      ...(window ? { window } : {}),
      topSessions: 20,
    });
    setLoading(false);
    if (!response.success) {
      setError(response.error);
      return;
    }
    const data = response.data as { rollup?: UsageRollup };
    setRollup(data.rollup ?? EMPTY_ROLLUP);
  }, [props.request, scopeMode, props.projectPath, timeRange]);

  useEffect(() => {
    void load();
  }, [load]);

  const days = useMemo(
    () => Object.entries(rollup.byDay).sort(([a], [b]) => a.localeCompare(b)),
    [rollup.byDay],
  );

  const heatmap = useMemo(() => generateHeatmapGrid(rollup.byDay), [rollup.byDay]);

  // Provider grouping derived from model ids ("provider/model" or "provider::model").
  const byProvider = useMemo(() => {
    const map = new Map<
      string,
      { promptTokens: number; completionTokens: number; totalTokens: number; models: Set<string> }
    >();
    for (const [modelId, bucket] of Object.entries(rollup.byModel)) {
      const provider = providerOfModel(modelId);
      const entry = map.get(provider) ?? {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        models: new Set<string>(),
      };
      entry.promptTokens += bucket.promptTokens;
      entry.completionTokens += bucket.completionTokens;
      entry.totalTokens += bucket.totalTokens;
      entry.models.add(modelId);
      map.set(provider, entry);
    }
    return map;
  }, [rollup.byModel]);

  const providers = useMemo(
    () => [...byProvider.entries()].sort(([, a], [, b]) => b.totalTokens - a.totalTokens),
    [byProvider],
  );

  const providerColorMap = useMemo(() => {
    const map = new Map<string, string>();
    providers.forEach(([provider], idx) => {
      map.set(provider, getProviderColor(provider, idx));
    });
    return map;
  }, [providers]);

  const scopeLabel = isZh
    ? scopeMode === 'project'
      ? '当前项目'
      : '全局'
    : scopeMode === 'project'
      ? 'Current project'
      : 'Global';

  // Compute Prompt vs Completion ratio
  const promptRatio =
    rollup.totalTokens > 0
      ? Math.round((rollup.promptTokens / rollup.totalTokens) * 100)
      : 50;
  const completionRatio = 100 - promptRatio;

  // Chart data calculations
  const chartMaxTokens = Math.max(
    1,
    ...days.map(([, bucket]) =>
      chartMetric === 'turns' ? bucket.entryCount : bucket.totalTokens,
    ),
  );

  return (
    <section className="usage-panel" data-testid="usage-panel" data-scope={scopeMode}>
      <header className="usage-panel-header">
        <div className="usage-header-main">
          <div
            className="usage-panel-scope-switch"
            role="group"
            aria-label={isZh ? '统计范围' : 'Scope'}
          >
            {(['project', 'global'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                className={scopeMode === mode ? 'active' : ''}
                disabled={mode === 'project' && !props.projectPath}
                onClick={() => setScopeMode(mode)}
                data-testid={`usage-scope-${mode}`}
              >
                {mode === 'project' ? (isZh ? '项目' : 'Project') : isZh ? '全局' : 'Global'}
              </button>
            ))}
          </div>

          <div
            className="usage-panel-scope-switch"
            role="group"
            aria-label={isZh ? '时间范围' : 'Time range'}
          >
            {(
              [
                ['all', isZh ? '全部' : 'All'],
                ['today', isZh ? '今天' : 'Today'],
                ['7d', isZh ? '7天' : '7d'],
                ['30d', isZh ? '30天' : '30d'],
                ['1y', isZh ? '1年' : '1y'],
              ] as const
            ).map(([range, label]) => (
              <button
                key={range}
                type="button"
                className={timeRange === range ? 'active' : ''}
                onClick={() => setTimeRange(range)}
                data-testid={`usage-range-${range}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <Button variant="ghost" size="compact" onClick={() => void load()} disabled={loading}>
          {loading ? (isZh ? '加载中…' : 'Loading…') : isZh ? '刷新' : 'Refresh'}
        </Button>
      </header>

      {error ? (
        <div className="usage-panel-error" role="alert">
          {error}
        </div>
      ) : null}

      <div className="usage-panel-body">
        {/* KPI Cards Header */}
        <div className="usage-kpis">
          <div className="usage-kpi">
            <span className="usage-kpi-label">{isZh ? '总 Tokens' : 'Total tokens'}</span>
            <span className="usage-kpi-value" data-testid="usage-total" title={formatFull(rollup.totalTokens)}>
              {formatNumber(rollup.totalTokens)}
            </span>
            <span className="usage-kpi-sub">
              {formatFull(rollup.totalTokens)} {isZh ? '个' : 'tokens'}
            </span>
          </div>

          <div className="usage-kpi">
            <span className="usage-kpi-label">{isZh ? '输入 (Prompt)' : 'Input (Prompt)'}</span>
            <span className="usage-kpi-value">{formatNumber(rollup.promptTokens)}</span>
            <span className="usage-kpi-sub">{promptRatio}% {isZh ? '占比' : 'of total'}</span>
          </div>

          <div className="usage-kpi">
            <span className="usage-kpi-label">{isZh ? '输出 (Completion)' : 'Output (Completion)'}</span>
            <span className="usage-kpi-value">{formatNumber(rollup.completionTokens)}</span>
            <span className="usage-kpi-sub">{completionRatio}% {isZh ? '占比' : 'of total'}</span>
          </div>

          <div className="usage-kpi">
            <span className="usage-kpi-label">{isZh ? '轮数 / 会话数' : 'Turns / Sessions'}</span>
            <span className="usage-kpi-value">
              {rollup.entryCount} <span className="usage-kpi-unit">/ {rollup.sessionCount}</span>
            </span>
            <span className="usage-kpi-sub">
              {scopeLabel} {rollup.firstAt ? `(${rollup.firstAt.slice(0, 10)})` : ''}
            </span>
          </div>
        </div>

        {/* Input vs Output Visual Ratio Progress Bar */}
        {rollup.totalTokens > 0 ? (
          <div className="usage-ratio-card">
            <div className="usage-ratio-labels">
              <span className="usage-ratio-prompt">
                <span className="usage-ratio-dot prompt" />
                {isZh ? '输入 Tokens' : 'Input Tokens'}: {formatNumber(rollup.promptTokens)} ({promptRatio}%)
              </span>
              <span className="usage-ratio-completion">
                <span className="usage-ratio-dot completion" />
                {isZh ? '输出 Tokens' : 'Output Tokens'}: {formatNumber(rollup.completionTokens)} ({completionRatio}%)
              </span>
            </div>
            <div className="usage-ratio-bar">
              <div
                className="usage-ratio-fill prompt"
                style={{ width: `${promptRatio}%` }}
                title={`Input: ${formatFull(rollup.promptTokens)} (${promptRatio}%)`}
              />
              <div
                className="usage-ratio-fill completion"
                style={{ width: `${completionRatio}%` }}
                title={`Output: ${formatFull(rollup.completionTokens)} (${completionRatio}%)`}
              />
            </div>
          </div>
        ) : null}

        {rollup.entryCount === 0 && !loading ? (
          <div className="right-panel-empty">
            {isZh
              ? '还没有 token 使用记录。运行几次会话后这里会显示统计。'
              : 'No token usage yet. Run a few sessions to populate stats.'}
          </div>
        ) : null}

        {/* GitHub-style Activity Contribution Heatmap Grid */}
        <section className="usage-section usage-heatmap-section">
          <div className="usage-section-header">
            <div>
              <h4 className="usage-section-title">
                {isZh ? '活动贡献图' : 'Activity Contribution'}
              </h4>
              <p className="usage-section-desc">
                {formatFull(rollup.totalTokens)} {isZh ? '个 tokens' : 'tokens'} · {heatmap.totalActiveDays}{' '}
                {isZh ? '个活跃天数' : 'active days'}
              </p>
            </div>
          </div>

          <div className="usage-heatmap-card">
            <div className="usage-heatmap-grid-container">
              {/* Month Header Labels */}
              <div className="usage-heatmap-months">
                <div className="usage-heatmap-day-spacer" />
                <div className="usage-heatmap-month-labels">
                  {heatmap.months.map((m, idx) => (
                    <span
                      key={`${m.name}-${idx}`}
                      className="usage-heatmap-month-label"
                      style={{ gridColumnStart: m.weekIndex + 1 }}
                    >
                      {m.name}
                    </span>
                  ))}
                </div>
              </div>

              <div className="usage-heatmap-body">
                {/* Day Labels */}
                <div className="usage-heatmap-days">
                  <span>{isZh ? '一' : 'Mon'}</span>
                  <span>{isZh ? '三' : 'Wed'}</span>
                  <span>{isZh ? '五' : 'Fri'}</span>
                </div>

                {/* Weeks Grid */}
                <div className="usage-heatmap-weeks">
                  {heatmap.weeks.map((week, wIdx) => (
                    <div key={wIdx} className="usage-heatmap-week">
                      {week.dates.map(({ dateStr, bucket, level }) => {
                        const total = bucket?.totalTokens ?? 0;
                        const entries = bucket?.entryCount ?? 0;
                        const titleText = `${dateStr}: ${formatFull(total)} tokens (${entries} ${
                          isZh ? '轮对话' : 'turns'
                        })`;
                        return (
                          <div
                            key={dateStr}
                            className="usage-heatmap-cell"
                            data-level={level}
                            title={titleText}
                          />
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Heatmap Legend */}
            <div className="usage-heatmap-legend">
              <span className="usage-heatmap-legend-label">{isZh ? '少' : 'Less'}</span>
              <div className="usage-heatmap-cell" data-level={0} />
              <div className="usage-heatmap-cell" data-level={1} />
              <div className="usage-heatmap-cell" data-level={2} />
              <div className="usage-heatmap-cell" data-level={3} />
              <div className="usage-heatmap-cell" data-level={4} />
              <span className="usage-heatmap-legend-label">{isZh ? '多' : 'More'}</span>
            </div>
          </div>
        </section>

        {/* Daily Usage Trend SVG Chart */}
        {days.length > 0 ? (
          <section className="usage-section">
            <div className="usage-section-header">
              <h4 className="usage-section-title">{isZh ? '每日用量趋势' : 'Daily Trend'}</h4>
              <div className="usage-chart-toolbar">
                {(
                  [
                    ['total', isZh ? '总 Tokens' : 'Total Tokens'],
                    ['split', isZh ? '输入 / 输出' : 'In / Out'],
                    ['turns', isZh ? '对话轮数' : 'Turns'],
                  ] as const
                ).map(([metric, label]) => (
                  <button
                    key={metric}
                    type="button"
                    className={`usage-chart-toggle ${chartMetric === metric ? 'active' : ''}`}
                    onClick={() => setChartMetric(metric)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="usage-chart-card">
              {/* Daily Trend Bars (Legacy container for tests + visual flex bars) */}
              <div className="usage-day-bars" data-testid="usage-day-bars">
                {days.map(([day, bucket], idx) => {
                  const isHovered = hoveredBarIndex === idx;
                  const total = bucket.totalTokens;
                  const prompt = bucket.promptTokens;
                  const completion = bucket.completionTokens;
                  const heightPct = Math.max(
                    4,
                    Math.round(
                      ((chartMetric === 'turns' ? bucket.entryCount : total) / chartMaxTokens) * 100,
                    ),
                  );

                  return (
                    <div
                      key={day}
                      className={`usage-day-bar ${isHovered ? 'hovered' : ''}`}
                      onMouseEnter={() => setHoveredBarIndex(idx)}
                      onMouseLeave={() => setHoveredBarIndex(null)}
                      title={`${day}: ${formatFull(total)} tokens (${bucket.entryCount} turns)`}
                    >
                      <div className="usage-day-bar-track">
                        {chartMetric === 'split' ? (
                          <>
                            <div
                              className="usage-day-bar-fill completion"
                              style={{
                                height: `${total > 0 ? Math.round((completion / total) * heightPct) : 0}%`,
                              }}
                            />
                            <div
                              className="usage-day-bar-fill prompt"
                              style={{
                                height: `${total > 0 ? Math.round((prompt / total) * heightPct) : heightPct}%`,
                              }}
                            />
                          </>
                        ) : (
                          <div
                            className="usage-day-bar-fill"
                            style={{ height: `${heightPct}%` }}
                          />
                        )}
                      </div>
                      <span className="usage-day-bar-label">
                        {days.length > 15 ? (idx % Math.ceil(days.length / 10) === 0 ? day.slice(5) : '') : day.slice(5)}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Hover Inspection Banner */}
              {hoveredBarIndex !== null && days[hoveredBarIndex] ? (
                <div className="usage-chart-hover-info">
                  <span className="usage-chart-hover-date">{days[hoveredBarIndex][0]}</span>
                  <span className="usage-chart-hover-stat">
                    <strong>{formatFull(days[hoveredBarIndex][1].totalTokens)}</strong> tokens
                  </span>
                  <span className="usage-chart-hover-split">
                    ↑ {formatNumber(days[hoveredBarIndex][1].promptTokens)} | ↓{' '}
                    {formatNumber(days[hoveredBarIndex][1].completionTokens)} | {days[hoveredBarIndex][1].entryCount}{' '}
                    {isZh ? '轮' : 'turns'}
                  </span>
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        {/* Provider Distribution Card & Table */}
        {providers.length > 0 ? (
          <section className="usage-section">
            <h4 className="usage-section-title">{isZh ? '按 AI 提供商' : 'By Provider'}</h4>

            {/* Provider Distribution Stacked Bar */}
            <div className="usage-dist-card">
              <div className="usage-dist-stacked-bar">
                {providers.map(([provider, entry]) => {
                  const pct =
                    rollup.totalTokens > 0
                      ? Math.max(1, (entry.totalTokens / rollup.totalTokens) * 100)
                      : 0;
                  const color = providerColorMap.get(provider) ?? '#3b82f6';
                  return (
                    <div
                      key={provider}
                      className="usage-dist-segment"
                      style={{ width: `${pct}%`, backgroundColor: color }}
                      title={`${provider}: ${formatFull(entry.totalTokens)} (${pct.toFixed(1)}%)`}
                    />
                  );
                })}
              </div>

              <div className="usage-dist-legend">
                {providers.map(([provider, entry]) => {
                  const pct =
                    rollup.totalTokens > 0
                      ? ((entry.totalTokens / rollup.totalTokens) * 100).toFixed(1)
                      : '0';
                  const color = providerColorMap.get(provider) ?? '#3b82f6';
                  return (
                    <div key={provider} className="usage-dist-legend-item">
                      <span className="usage-dist-dot" style={{ backgroundColor: color }} />
                      <span className="usage-dist-name">{provider}</span>
                      <span className="usage-dist-pct">{pct}%</span>
                    </div>
                  );
                })}
              </div>
            </div>

            <table className="usage-table">
              <thead>
                <tr>
                  <th>{isZh ? '提供商' : 'Provider'}</th>
                  <th>{isZh ? '模型数' : 'Models'}</th>
                  <th>{isZh ? '输入' : 'In'}</th>
                  <th>{isZh ? '输出' : 'Out'}</th>
                  <th>{isZh ? '总计' : 'Total'}</th>
                  <th>{isZh ? '占比' : 'Share'}</th>
                </tr>
              </thead>
              <tbody>
                {providers.map(([provider, entry]) => {
                  const pct =
                    rollup.totalTokens > 0
                      ? Math.round((entry.totalTokens / rollup.totalTokens) * 100)
                      : 0;
                  const color = providerColorMap.get(provider) ?? '#3b82f6';
                  return (
                    <tr key={provider}>
                      <td className="usage-table-model">
                        <span className="usage-table-provider-badge">
                          <span className="usage-dist-dot" style={{ backgroundColor: color }} />
                          {provider}
                        </span>
                      </td>
                      <td>{entry.models.size}</td>
                      <td>{formatNumber(entry.promptTokens)}</td>
                      <td>{formatNumber(entry.completionTokens)}</td>
                      <td>
                        <strong>{formatNumber(entry.totalTokens)}</strong>
                      </td>
                      <td className="usage-table-progress-cell">
                        <div className="usage-table-progress-wrap">
                          <div
                            className="usage-table-progress-bar"
                            style={{ width: `${pct}%`, backgroundColor: color }}
                          />
                          <span className="usage-table-progress-text">{pct}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        ) : null}

        {/* Model Breakdown Table */}
        {Object.keys(rollup.byModel).length > 0 ? (
          <section className="usage-section">
            <h4 className="usage-section-title">{isZh ? '按模型明细' : 'By Model'}</h4>
            <table className="usage-table">
              <thead>
                <tr>
                  <th>{isZh ? '模型 ID' : 'Model ID'}</th>
                  <th>{isZh ? '输入' : 'In'}</th>
                  <th>{isZh ? '输出' : 'Out'}</th>
                  <th>{isZh ? '总计' : 'Total'}</th>
                  <th>{isZh ? '占比' : 'Share'}</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(rollup.byModel)
                  .sort(([, a], [, b]) => b.totalTokens - a.totalTokens)
                  .map(([modelId, bucket]) => {
                    const pct =
                      rollup.totalTokens > 0
                        ? Math.round((bucket.totalTokens / rollup.totalTokens) * 100)
                        : 0;
                    const provider = providerOfModel(modelId);
                    const color = providerColorMap.get(provider) ?? 'var(--accent, #60a5fa)';
                    return (
                      <tr key={modelId}>
                        <td className="usage-table-model" title={modelId}>
                          <code>{modelId}</code>
                        </td>
                        <td>{formatNumber(bucket.promptTokens)}</td>
                        <td>{formatNumber(bucket.completionTokens)}</td>
                        <td>
                          <strong>{formatNumber(bucket.totalTokens)}</strong>
                        </td>
                        <td className="usage-table-progress-cell">
                          <div className="usage-table-progress-wrap">
                            <div
                              className="usage-table-progress-bar"
                              style={{ width: `${pct}%`, backgroundColor: color }}
                            />
                            <span className="usage-table-progress-text">{pct}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </section>
        ) : null}

        {/* Session Breakdown */}
        {rollup.bySession.length > 0 ? (
          <section className="usage-section">
            <h4 className="usage-section-title">{isZh ? '会话使用记录' : 'By Session'}</h4>
            <ul className="usage-session-list">
              {rollup.bySession.map((session: UsageSessionTotal) => (
                <li key={session.sessionId}>
                  <button
                    type="button"
                    className="usage-session-row"
                    onClick={() => props.onOpenSession?.(session.sessionId)}
                    disabled={!props.onOpenSession}
                  >
                    <div className="usage-session-main">
                      <span className="usage-session-id">
                        <code>{session.sessionId.slice(0, 8)}</code>
                      </span>
                      {session.firstAt ? (
                        <span className="usage-session-time">
                          {session.firstAt.replace('T', ' ').slice(0, 16)}
                        </span>
                      ) : null}
                    </div>

                    <div className="usage-session-bucket">
                      <span className="usage-session-total">
                        {formatNumber(session.totalTokens)}{' '}
                        <span className="usage-session-unit">tokens</span>
                      </span>
                      <span className="usage-session-inout">
                        ↑ {formatNumber(session.promptTokens)} · ↓{' '}
                        {formatNumber(session.completionTokens)} · {session.entryCount}{' '}
                        {isZh ? '轮' : 'turns'}
                      </span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </section>
  );
}
