/**
 * Compact token usage dashboard (CE-OBS).
 *
 * Information is intentionally consolidated into three summary cards, one
 * token-composition trend, and one model + Key table. Provider configuration
 * ids are the safe Key dimension: API key values never reach the client.
 */
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { Button, SegmentedControl, Select, TextInput } from '@piwin/ui-kit';
import { computePromptCacheHitRate, type HostResponse, type UsageRollup } from '@piwin/contracts';
import { useDesktopLocale } from './desktop-locale-context';
import {
  EMPTY_USAGE_ROLLUP,
  deriveLegacyModelKeyRows,
  formatUsageCompact,
  formatUsageDate,
  formatUsageExact,
  formatUsagePercent,
  normalizeUsageRollup,
  resolveUsageWindow,
  tokenComponents,
  type UsageTimeRange,
} from './usage-panel-statistics';

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
};

type ScopeMode = 'project' | 'global';

export function UsagePanel(props: UsagePanelProps): ReactElement {
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';
  const [scopeMode, setScopeMode] = useState<ScopeMode>(props.projectPath ? 'project' : 'global');
  const [timeRange, setTimeRange] = useState<UsageTimeRange>('30d');
  const [searchQuery, setSearchQuery] = useState('');
  const [rollup, setRollup] = useState<UsageRollup>(EMPTY_USAGE_ROLLUP);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!props.projectPath && scopeMode === 'project') {
      setScopeMode('global');
    }
  }, [props.projectPath, scopeMode]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const window = resolveUsageWindow(timeRange);
      const response = await props.request({
        type: 'usage/get-rollup',
        ...(scopeMode === 'project' && props.projectPath ? { projectPath: props.projectPath } : {}),
        ...(window ? { window } : {}),
      });
      if (!response.success) {
        setError(response.error);
        return;
      }
      const data = response.data as { rollup?: UsageRollup };
      setRollup(normalizeUsageRollup(data.rollup));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setLoading(false);
    }
  }, [props.projectPath, props.request, scopeMode, timeRange]);

  useEffect(() => {
    void load();
  }, [load]);

  const days = useMemo(
    () => Object.entries(rollup.byDay).sort(([left], [right]) => left.localeCompare(right)),
    [rollup.byDay],
  );
  const chartMaxTokens = useMemo(
    () =>
      Math.max(
        1,
        ...days.map(([, bucket]) => Math.max(bucket.totalTokens, tokenComponents(bucket))),
      ),
    [days],
  );
  const activeDays = useMemo(
    () => Object.values(rollup.byDay).filter((bucket) => bucket.totalTokens > 0).length,
    [rollup.byDay],
  );

  const modelKeyRows = useMemo(() => {
    const source =
      rollup.byModelKey.length > 0
        ? [...rollup.byModelKey]
        : deriveLegacyModelKeyRows(rollup.byModel);
    const query = searchQuery.trim().toLowerCase();
    return source
      .filter((row) => {
        if (!query) {
          return true;
        }
        return (
          row.modelId.toLowerCase().includes(query) ||
          (row.providerId?.toLowerCase().includes(query) ?? false)
        );
      })
      .sort((left, right) => right.totalTokens - left.totalTokens);
  }, [rollup.byModel, rollup.byModelKey, searchQuery]);

  const cacheReadTokens = rollup.cacheReadTokens ?? 0;
  const cacheWriteTokens = rollup.cacheWriteTokens ?? 0;
  const cacheTrafficTokens = cacheReadTokens + cacheWriteTokens;
  const cacheableInputTokens = rollup.promptTokens + cacheReadTokens + cacheWriteTokens;
  const cacheHitRate = computePromptCacheHitRate(rollup);
  const rangeLabel = `${formatUsageDate(rollup.firstAt, locale)} – ${formatUsageDate(rollup.lastAt, locale)}`;
  const firstDay = days[0]?.[0] ?? null;
  const lastDay = days[days.length - 1]?.[0] ?? null;

  const scopeOptions = [
    {
      value: 'project',
      label: isZh ? '当前项目' : 'Project',
      disabled: !props.projectPath,
    },
    { value: 'global', label: isZh ? '全部' : 'All' },
  ];
  const timeRangeOptions = [
    { value: '7d', label: isZh ? '最近 7 天' : 'Last 7 days' },
    { value: '30d', label: isZh ? '最近 30 天' : 'Last 30 days' },
    { value: '90d', label: isZh ? '最近 90 天' : 'Last 90 days' },
    { value: 'all', label: isZh ? '全部时间' : 'All time' },
  ];

  return (
    <section
      className="usage-panel"
      data-testid="usage-panel"
      data-scope={scopeMode}
      aria-busy={loading}
    >
      <header className="usage-toolbar">
        <div className="usage-toolbar-copy">
          <p>
            {isZh
              ? '看清 Token 去向和提示词缓存是否真正生效。'
              : 'Understand token usage and whether prompt caching is working.'}
          </p>
        </div>
        <div className="usage-toolbar-controls">
          <SegmentedControl
            data={scopeOptions}
            value={scopeMode}
            onChange={(value) => setScopeMode(value as ScopeMode)}
            testId="usage-scope-control"
            aria-label={isZh ? '统计范围' : 'Usage scope'}
          />
          <Select
            data={timeRangeOptions}
            value={timeRange}
            onChange={(event) => setTimeRange(event.currentTarget.value as UsageTimeRange)}
            testId="usage-time-select"
            aria-label={isZh ? '时间范围' : 'Time range'}
          />
          <Button variant="ghost" size="compact" onClick={() => void load()} disabled={loading}>
            {loading ? (isZh ? '加载中…' : 'Loading…') : isZh ? '刷新' : 'Refresh'}
          </Button>
        </div>
      </header>

      {error ? (
        <div className="usage-panel-error" role="alert">
          {error}
        </div>
      ) : null}

      <div className="usage-panel-body">
        <div className="usage-summary-grid">
          <section className="usage-summary-card">
            <span className="usage-summary-label">{isZh ? '总用量' : 'Total usage'}</span>
            <strong className="usage-summary-value" data-testid="usage-total">
              {formatUsageCompact(rollup.totalTokens)}
            </strong>
            <dl className="usage-summary-pairs">
              <div>
                <dt>{isZh ? '直接输入' : 'Direct input'}</dt>
                <dd title={formatUsageExact(rollup.promptTokens)}>
                  {formatUsageCompact(rollup.promptTokens)}
                </dd>
              </div>
              <div>
                <dt>{isZh ? '输出' : 'Output'}</dt>
                <dd title={formatUsageExact(rollup.completionTokens)}>
                  {formatUsageCompact(rollup.completionTokens)}
                </dd>
              </div>
            </dl>
          </section>

          <section
            className="usage-summary-card usage-summary-card-cache"
            data-testid="usage-cache-summary"
          >
            <span className="usage-summary-label">
              {isZh ? '提示词缓存率' : 'Prompt cache hit rate'}
            </span>
            <strong className="usage-summary-value" data-testid="usage-cache-rate">
              {formatUsagePercent(cacheHitRate)}
            </strong>
            <dl className="usage-summary-pairs">
              <div>
                <dt>{isZh ? '缓存读取' : 'Cache read'}</dt>
                <dd title={formatUsageExact(cacheReadTokens)}>
                  {formatUsageCompact(cacheReadTokens)}
                </dd>
              </div>
              <div>
                <dt>{isZh ? '缓存写入' : 'Cache write'}</dt>
                <dd title={formatUsageExact(cacheWriteTokens)}>
                  {formatUsageCompact(cacheWriteTokens)}
                </dd>
              </div>
            </dl>
            <span className="usage-summary-meta" data-testid="usage-cache-total">
              {isZh ? '缓存流量' : 'Cache traffic'} {formatUsageCompact(cacheTrafficTokens)} ·{' '}
              {isZh ? '提示词侧' : 'prompt-side'} {formatUsageCompact(cacheableInputTokens)}
            </span>
          </section>

          <section className="usage-summary-card">
            <span className="usage-summary-label">{isZh ? '活动' : 'Activity'}</span>
            <strong className="usage-summary-value">
              {formatUsageExact(rollup.entryCount)} {isZh ? '次请求' : 'turns'}
            </strong>
            <dl className="usage-summary-pairs">
              <div>
                <dt>{isZh ? '会话' : 'Sessions'}</dt>
                <dd>{formatUsageExact(rollup.sessionCount)}</dd>
              </div>
              <div>
                <dt>{isZh ? '活跃天数' : 'Active days'}</dt>
                <dd>{formatUsageExact(activeDays)}</dd>
              </div>
            </dl>
            <span className="usage-summary-meta">{rangeLabel}</span>
          </section>
        </div>

        <section className="usage-card usage-trend-card">
          <div className="usage-section-header">
            <div>
              <h3>{isZh ? 'Token 趋势' : 'Token trend'}</h3>
              <p>
                {isZh
                  ? '一张图合并直接输入、缓存读写与输出。'
                  : 'Direct input, cache traffic, and output in one chart.'}
              </p>
            </div>
            <div className="usage-trend-legend" aria-label={isZh ? '图例' : 'Legend'}>
              <span>
                <i data-tone="input" />
                {isZh ? '直接输入' : 'Input'}
              </span>
              <span>
                <i data-tone="cache-read" />
                {isZh ? '缓存读' : 'Cache read'}
              </span>
              <span>
                <i data-tone="cache-write" />
                {isZh ? '缓存写' : 'Cache write'}
              </span>
              <span>
                <i data-tone="output" />
                {isZh ? '输出' : 'Output'}
              </span>
            </div>
          </div>

          {days.length > 0 ? (
            <div className="usage-trend-scroll">
              <div
                className="usage-trend-plot"
                data-testid="usage-day-bars"
                style={{ minWidth: `${Math.max(560, days.length * 18)}px` }}
              >
                {days.map(([day, bucket]) => {
                  const composedTotal = tokenComponents(bucket);
                  const chartTotal = Math.max(bucket.totalTokens, composedTotal);
                  const height = Math.max(4, Math.round((chartTotal / chartMaxTokens) * 100));
                  const tooltip = isZh
                    ? `${day}｜直接输入 ${formatUsageExact(bucket.promptTokens)}｜缓存读 ${formatUsageExact(bucket.cacheReadTokens)}｜缓存写 ${formatUsageExact(bucket.cacheWriteTokens)}｜输出 ${formatUsageExact(bucket.completionTokens)}`
                    : `${day} | input ${formatUsageExact(bucket.promptTokens)} | cache read ${formatUsageExact(bucket.cacheReadTokens)} | cache write ${formatUsageExact(bucket.cacheWriteTokens)} | output ${formatUsageExact(bucket.completionTokens)}`;
                  return (
                    <div className="usage-trend-column" key={day} title={tooltip}>
                      <div
                        className="usage-trend-bar"
                        style={{ height: `${height}%` }}
                        aria-label={tooltip}
                      >
                        <span data-tone="input" style={{ flexGrow: bucket.promptTokens }} />
                        <span data-tone="cache-read" style={{ flexGrow: bucket.cacheReadTokens }} />
                        <span
                          data-tone="cache-write"
                          style={{ flexGrow: bucket.cacheWriteTokens }}
                        />
                        <span data-tone="output" style={{ flexGrow: bucket.completionTokens }} />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="usage-trend-axis">
                <span>{formatUsageDate(firstDay, locale)}</span>
                <span>{formatUsageDate(lastDay, locale)}</span>
              </div>
            </div>
          ) : (
            <div className="usage-compact-empty">
              {isZh ? '当前范围还没有按天用量。' : 'No daily usage in this range.'}
            </div>
          )}
        </section>

        <section className="usage-card usage-model-key-card" data-testid="usage-model-key-table">
          <div className="usage-section-header usage-model-key-header">
            <div>
              <h3>{isZh ? '模型 × Key 缓存' : 'Model × Key cache'}</h3>
              <p>
                {isZh
                  ? '缓存率 = 缓存读取 ÷（直接输入 + 缓存读取 + 缓存写入）。Key 仅显示提供商配置 ID，不显示密钥。'
                  : 'Hit rate = cache read ÷ (direct input + cache read + cache write). Key shows only the provider config id.'}
              </p>
            </div>
            <TextInput
              toolbar
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.currentTarget.value)}
              placeholder={isZh ? '筛选模型或 Key' : 'Filter model or Key'}
              testId="usage-search-input"
              aria-label={isZh ? '筛选模型或 Key' : 'Filter model or Key'}
            />
          </div>

          {modelKeyRows.length > 0 ? (
            <div className="usage-table-scroll">
              <table className="usage-table">
                <thead>
                  <tr>
                    <th>{isZh ? '模型' : 'Model'}</th>
                    <th>{isZh ? 'Key（提供商配置）' : 'Key (provider config)'}</th>
                    <th>{isZh ? '缓存率' : 'Hit rate'}</th>
                    <th>{isZh ? '缓存读 / 写' : 'Cache read / write'}</th>
                    <th>{isZh ? '直接输入 / 输出' : 'Direct input / output'}</th>
                    <th>{isZh ? '请求' : 'Turns'}</th>
                    <th>{isZh ? '总计' : 'Total'}</th>
                  </tr>
                </thead>
                <tbody>
                  {modelKeyRows.map((row) => {
                    const rowKey = `${row.providerId ?? 'legacy'}::${row.modelId}`;
                    const rowHitRate = computePromptCacheHitRate(row);
                    const rowHitPercent = rowHitRate === null ? 0 : Math.round(rowHitRate * 100);
                    return (
                      <tr key={rowKey} data-testid={`usage-model-key-row-${rowKey}`}>
                        <td className="usage-table-model" title={row.modelId}>
                          <strong>{row.modelId}</strong>
                        </td>
                        <td>
                          <span className="usage-key-label">
                            {row.providerId ?? (isZh ? '未知 Key' : 'Unknown Key')}
                          </span>
                          {row.providerId === null ? (
                            <small>{isZh ? '历史记录未归因' : 'Legacy record'}</small>
                          ) : null}
                        </td>
                        <td data-testid={`usage-model-key-cache-rate-${rowKey}`}>
                          <div className="usage-cache-rate-cell">
                            <strong>{formatUsagePercent(rowHitRate)}</strong>
                            <span aria-hidden="true">
                              <i style={{ width: `${rowHitPercent}%` }} />
                            </span>
                          </div>
                        </td>
                        <td className="usage-token-pair">
                          <span>
                            {isZh ? '读' : 'R'} {formatUsageCompact(row.cacheReadTokens)}
                          </span>
                          <span>
                            {isZh ? '写' : 'W'} {formatUsageCompact(row.cacheWriteTokens)}
                          </span>
                        </td>
                        <td className="usage-token-pair">
                          <span>
                            {isZh ? '入' : 'In'} {formatUsageCompact(row.promptTokens)}
                          </span>
                          <span>
                            {isZh ? '出' : 'Out'} {formatUsageCompact(row.completionTokens)}
                          </span>
                        </td>
                        <td>{formatUsageExact(row.entryCount)}</td>
                        <td>
                          <strong>{formatUsageCompact(row.totalTokens)}</strong>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="usage-compact-empty">
              {searchQuery
                ? isZh
                  ? `没有匹配“${searchQuery}”的模型或 Key。`
                  : `No model or Key matches “${searchQuery}”.`
                : isZh
                  ? '当前范围还没有可归因到模型和 Key 的用量。'
                  : 'No model and Key usage in this range.'}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
