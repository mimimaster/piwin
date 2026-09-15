/**
 * Compact token usage dashboard (CE-OBS).
 *
 * Information is intentionally consolidated into three summary cards, one
 * token-composition trend, and one model + Key table. Provider configuration
 * ids are the safe Key dimension: API key values never reach the client.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { Button, Select, Switch, TextInput } from '@piwin/ui-kit';
import { IconRefresh } from './shell-icons.js';
import {
  computePromptCacheHitRate,
  computeTokensPerSecond,
  type HostResponse,
  type UsageCallLog,
  type UsageRollup,
} from '@piwin/contracts';
import { isRemoteCommandGapError } from './remote-command-gap.js';
import { useDesktopLocale } from './desktop-locale-context';
import {
  EMPTY_USAGE_CALL_LOG,
  EMPTY_USAGE_ROLLUP,
  RECENT_CALLS_PAGE_SIZE,
  RECENT_CALLS_PAGE_SIZES,
  RECENT_CALLS_WINDOW_MINUTES,
  deriveLegacyModelKeyRows,
  formatTokensPerSecond,
  formatUsageClock,
  formatUsageCompact,
  formatUsageDate,
  formatUsageDuration,
  formatUsageExact,
  formatUsagePercent,
  formatUsageSessionTag,
  formatUsageTimestamp,
  normalizeUsageCallLog,
  normalizeUsageRollup,
  resolveUsageCallLogPage,
  resolveUsageWindow,
  summarizeUsageCallLog,
  tokenComponents,
  type UsageTimeRange,
} from './usage-panel-statistics';

/** How often the live call log re-reads the ledger while the page is visible. */
const RECENT_CALLS_POLL_MS = 20_000;

export type UsagePanelProps = {
  /** Optional trusted project path; null/undefined for global usage. */
  projectPath?: string | null;
  request: (command: {
    type: 'usage/get-rollup' | 'usage/list-recent';
    projectPath?: string;
    scope?: { kind: 'general' };
    window?: { from?: string; to?: string };
    topSessions?: number;
    windowMinutes?: number;
    limit?: number;
    offset?: number;
  }) => Promise<HostResponse>;
};

export function UsagePanel(props: UsagePanelProps): ReactElement {
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';
  const [timeRange, setTimeRange] = useState<UsageTimeRange>('30d');
  const [searchQuery, setSearchQuery] = useState('');
  const [rollup, setRollup] = useState<UsageRollup>(EMPTY_USAGE_ROLLUP);
  const [callLog, setCallLog] = useState<UsageCallLog>(EMPTY_USAGE_CALL_LOG);
  const [callLogSupported, setCallLogSupported] = useState(true);
  const [callPageSize, setCallPageSize] = useState<number>(RECENT_CALLS_PAGE_SIZE);
  const [callOffset, setCallOffset] = useState(0);
  const [callsLoading, setCallsLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const requestRef = useRef(props.request);
  requestRef.current = props.request;
  const callScrollRef = useRef<HTMLDivElement | null>(null);

  const scopedProjectPath = props.projectPath ?? null;

  /**
   * Rolling call log. Kept separate from the rollup load so a 20s poll never
   * re-reads the 30-day aggregate, and so a Host without the command only
   * hides this one card.
   */
  const loadCallLog = useCallback(async () => {
    setCallsLoading(true);
    try {
      const response = await requestRef.current({
        type: 'usage/list-recent',
        ...(scopedProjectPath ? { projectPath: scopedProjectPath } : {}),
        windowMinutes: RECENT_CALLS_WINDOW_MINUTES,
        limit: callPageSize,
        offset: callOffset,
      });
      if (!response.success) {
        // An older Host simply has no such command; drop the card instead of
        // showing a page-level error for a feature that cannot exist there.
        setCallLogSupported(false);
        return;
      }
      const data = response.data as { log?: UsageCallLog };
      const nextLog = normalizeUsageCallLog(data.log);
      setCallLog(nextLog);
      // Rows age out of the window, so the Host may have clamped the offset to
      // the last page. Follow it, or the pager would keep asking for a page
      // that no longer exists.
      if (nextLog.offset !== callOffset) {
        setCallOffset(nextLog.offset);
      }
      setCallLogSupported(true);
      setRefreshedAt(new Date().toISOString());
    } catch {
      setCallLogSupported(false);
    } finally {
      setCallsLoading(false);
    }
  }, [callOffset, callPageSize, scopedProjectPath]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const window = resolveUsageWindow(timeRange);
      const response = await props.request({
        type: 'usage/get-rollup',
        ...(scopedProjectPath ? { projectPath: scopedProjectPath } : {}),
        ...(window ? { window } : {}),
      });
      if (!response.success) {
        if (!isRemoteCommandGapError(response.error)) {
          setError(response.error);
        }
        return;
      }
      const data = response.data as { rollup?: UsageRollup };
      setRollup(normalizeUsageRollup(data.rollup));
      setRefreshedAt(new Date().toISOString());
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setLoading(false);
    }
  }, [props.request, scopedProjectPath, timeRange]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadCallLog();
  }, [loadCallLog]);

  // Poll only while the log is live, supported, on the newest page, and
  // actually on screen. Refreshing an older page would shift rows under the
  // reader as new calls land, and a backgrounded settings tab must not keep
  // re-reading the ledger.
  useEffect(() => {
    if (!autoRefresh || !callLogSupported || callOffset > 0) {
      return undefined;
    }
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return;
      }
      void loadCallLog();
    }, RECENT_CALLS_POLL_MS);
    return () => clearInterval(timer);
  }, [autoRefresh, callLogSupported, callOffset, loadCallLog]);

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

  // A scope switch is a different result set; start it from the newest page.
  useEffect(() => {
    setCallOffset(0);
  }, [scopedProjectPath]);

  // A new page starts at its first row, not wherever the previous page was
  // scrolled to.
  useEffect(() => {
    if (callScrollRef.current) {
      callScrollRef.current.scrollTop = 0;
    }
  }, [callOffset, callPageSize]);

  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setHeaderSlot(document.getElementById('settings-main-header-actions'));
  }, []);

  const callSummary = useMemo(() => summarizeUsageCallLog(callLog.entries), [callLog.entries]);
  const callPage = resolveUsageCallLogPage(callLog);
  const livePaused = !autoRefresh || callOffset > 0;
  const refreshedLabel = refreshedAt ? formatUsageClock(refreshedAt, locale) : null;

  const timeRangeOptions = [
    { value: '7d', label: isZh ? '最近 7 天' : 'Last 7 days' },
    { value: '30d', label: isZh ? '最近 30 天' : 'Last 30 days' },
    { value: '90d', label: isZh ? '最近 90 天' : 'Last 90 days' },
    { value: 'all', label: isZh ? '全部时间' : 'All time' },
  ];

  const toolbarControls = (
    <div className="usage-toolbar-controls" data-testid="usage-toolbar-controls">
      {refreshedLabel ? (
        <span className="usage-toolbar-stamp" data-testid="usage-refreshed-at">
          {isZh ? `更新于 ${refreshedLabel}` : `Updated ${refreshedLabel}`}
        </span>
      ) : null}
      <Select
        data={timeRangeOptions}
        value={timeRange}
        onChange={(event) => setTimeRange(event.currentTarget.value as UsageTimeRange)}
        testId="usage-time-select"
        aria-label={isZh ? '时间范围' : 'Time range'}
      />
      <Button
        variant="ghost"
        size="compact"
        onClick={() => {
          void load();
          void loadCallLog();
        }}
        disabled={loading}
        className="usage-refresh-button"
        data-testid="usage-refresh-button"
      >
        <IconRefresh
          width={13}
          height={13}
          className={`usage-refresh-icon${loading ? ' is-spinning' : ''}`}
        />
        <span>{loading ? (isZh ? '刷新中…' : 'Refreshing…') : isZh ? '刷新' : 'Refresh'}</span>
      </Button>
    </div>
  );

  return (
    <section
      className="usage-panel"
      data-testid="usage-panel"
      data-scope={scopedProjectPath ? 'project' : 'global'}
      aria-busy={loading}
    >
      {headerSlot ? (
        createPortal(toolbarControls, headerSlot)
      ) : (
        <header className="usage-toolbar">{toolbarControls}</header>
      )}

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
                    <th>{isZh ? '输出速率' : 'Output speed'}</th>
                    <th>{isZh ? '请求' : 'Turns'}</th>
                    <th>{isZh ? '总计' : 'Total'}</th>
                  </tr>
                </thead>
                <tbody>
                  {modelKeyRows.map((row) => {
                    const rowKey = `${row.providerId ?? 'legacy'}::${row.modelId}`;
                    const rowHitRate = computePromptCacheHitRate(row);
                    const rowHitPercent = rowHitRate === null ? 0 : Math.round(rowHitRate * 100);
                    const tokensPerSecond = computeTokensPerSecond(row);
                    const tpsDetail =
                      row.durationMs !== undefined
                        ? `${formatUsageExact(row.durationMs)}ms`
                        : undefined;
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
                        <td
                          className="usage-tps-cell"
                          data-testid={`usage-model-key-tps-${rowKey}`}
                          title={tpsDetail}
                        >
                          {formatTokensPerSecond(tokensPerSecond)}
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

        {callLogSupported ? (
          <section className="usage-card usage-calls-card" data-testid="usage-recent-calls">
            <div className="usage-section-header usage-calls-header">
              <div className="usage-calls-heading">
                <h3>
                  {isZh ? '最近调用' : 'Recent calls'}
                  <span className="usage-calls-window">
                    {isZh
                      ? `近 ${callLog.windowMinutes} 分钟`
                      : `last ${callLog.windowMinutes} min`}
                  </span>
                </h3>
                <p data-testid="usage-recent-calls-summary">
                  {callLog.totalInWindow === 0
                    ? isZh
                      ? '逐次记录模型调用，随会话实时追加。'
                      : 'Every model call, appended live as sessions run.'
                    : isZh
                      ? `共 ${formatUsageExact(callLog.totalInWindow)} 次调用 · 本页 ${formatUsageCompact(callSummary.totalTokens)} token · 缓存命中 ${formatUsageExact(callSummary.cachedCalls)}/${formatUsageExact(callSummary.calls)}（${formatUsagePercent(callSummary.cacheHitRate)}）`
                      : `${formatUsageExact(callLog.totalInWindow)} calls · ${formatUsageCompact(callSummary.totalTokens)} tokens on this page · cache hit on ${formatUsageExact(callSummary.cachedCalls)}/${formatUsageExact(callSummary.calls)} (${formatUsagePercent(callSummary.cacheHitRate)})`}
                </p>
              </div>
              <label className="usage-calls-live" data-live={livePaused ? 'off' : 'on'}>
                <span className="usage-calls-live-text" data-testid="usage-calls-live-label">
                  <i aria-hidden="true" />
                  {!autoRefresh
                    ? isZh
                      ? '自动刷新已暂停'
                      : 'Auto-refresh paused'
                    : callOffset > 0
                      ? isZh
                        ? '翻页时暂停刷新'
                        : 'Paused while paging'
                      : isZh
                        ? `每 ${RECENT_CALLS_POLL_MS / 1000} 秒自动刷新`
                        : `Auto-refresh every ${RECENT_CALLS_POLL_MS / 1000}s`}
                </span>
                <Switch
                  checked={autoRefresh}
                  onCheckedChange={setAutoRefresh}
                  testId="usage-calls-autorefresh"
                  aria-label={isZh ? '自动刷新最近调用' : 'Auto-refresh recent calls'}
                />
              </label>
            </div>

            {callLog.entries.length > 0 ? (
              <div
                className="usage-table-scroll usage-calls-scroll"
                ref={callScrollRef}
                data-testid="usage-calls-scroll"
              >
                <table className="usage-table usage-calls-table">
                  <thead>
                    <tr>
                      <th>{isZh ? '时间' : 'Time'}</th>
                      <th>{isZh ? '模型' : 'Model'}</th>
                      <th>{isZh ? 'Key（提供商配置）' : 'Key (provider config)'}</th>
                      <th>{isZh ? '会话' : 'Session'}</th>
                      <th>{isZh ? '用时' : 'Duration'}</th>
                      <th>{isZh ? '输出速率' : 'Output speed'}</th>
                      <th>{isZh ? '直接输入 / 输出' : 'Direct input / output'}</th>
                      <th>{isZh ? '缓存读 / 写' : 'Cache read / write'}</th>
                      <th>{isZh ? '缓存' : 'Cache'}</th>
                      <th>{isZh ? '总计' : 'Total'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {callLog.entries.map((entry) => {
                      const entryHitRate = computePromptCacheHitRate(entry);
                      const tokensPerSecond = computeTokensPerSecond({
                        completionTokens: entry.completionTokens,
                        ...(entry.durationMs !== undefined ? { durationMs: entry.durationMs } : {}),
                      });
                      return (
                        <tr
                          key={entry.id}
                          data-testid="usage-call-row"
                          data-failed={entry.success === false ? 'true' : undefined}
                        >
                          <td
                            className="usage-call-time"
                            title={formatUsageTimestamp(entry.recordedAt, locale)}
                          >
                            {formatUsageClock(entry.recordedAt, locale)}
                          </td>
                          <td className="usage-table-model" title={entry.modelId ?? undefined}>
                            <strong>
                              {entry.modelId ?? (isZh ? '未知模型' : 'Unknown model')}
                            </strong>
                            {entry.success === false ? (
                              <span className="usage-call-chip usage-call-chip-failed">
                                {isZh ? '失败' : 'Failed'}
                              </span>
                            ) : null}
                            {entry.source === 'host-estimate' ? (
                              <span className="usage-call-chip">{isZh ? '估算' : 'Estimated'}</span>
                            ) : null}
                          </td>
                          <td>
                            <span className="usage-key-label">
                              {entry.providerId ?? (isZh ? '未知 Key' : 'Unknown Key')}
                            </span>
                          </td>
                          <td className="usage-call-session" title={entry.sessionId}>
                            {formatUsageSessionTag(entry.sessionId)}
                          </td>
                          <td className="usage-tps-cell">
                            {formatUsageDuration(entry.durationMs)}
                          </td>
                          <td className="usage-tps-cell">
                            {formatTokensPerSecond(tokensPerSecond)}
                          </td>
                          <td className="usage-token-pair">
                            <span>
                              {isZh ? '入' : 'In'} {formatUsageCompact(entry.promptTokens)}
                            </span>
                            <span>
                              {isZh ? '出' : 'Out'} {formatUsageCompact(entry.completionTokens)}
                            </span>
                          </td>
                          <td className="usage-token-pair">
                            <span>
                              {isZh ? '读' : 'R'} {formatUsageCompact(entry.cacheReadTokens)}
                            </span>
                            <span>
                              {isZh ? '写' : 'W'} {formatUsageCompact(entry.cacheWriteTokens)}
                            </span>
                          </td>
                          <td>
                            <span
                              className="usage-call-cache"
                              data-hit={entry.cacheReadTokens > 0 ? 'true' : 'false'}
                            >
                              {entry.cacheReadTokens > 0
                                ? `${isZh ? '命中' : 'Hit'} ${formatUsagePercent(entryHitRate)}`
                                : isZh
                                  ? '未命中'
                                  : 'Miss'}
                            </span>
                          </td>
                          <td title={formatUsageExact(entry.totalTokens)}>
                            <strong>{formatUsageCompact(entry.totalTokens)}</strong>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="usage-compact-empty">
                {isZh
                  ? `最近 ${callLog.windowMinutes} 分钟内没有模型调用。`
                  : `No model calls in the last ${callLog.windowMinutes} minutes.`}
              </div>
            )}

            {callLog.totalInWindow > 0 ? (
              <div className="usage-calls-pager" data-testid="usage-calls-pager">
                <span className="usage-calls-range" data-testid="usage-calls-range">
                  {callPage.firstRow === 0
                    ? '—'
                    : `${formatUsageExact(callPage.firstRow)}–${formatUsageExact(callPage.lastRow)} / ${formatUsageExact(callLog.totalInWindow)}`}
                </span>
                <div className="usage-calls-pager-controls">
                  <label className="usage-calls-page-size">
                    <span>{isZh ? '每页' : 'Rows'}</span>
                    <Select
                      data={RECENT_CALLS_PAGE_SIZES.map((size) => ({
                        value: String(size),
                        label: String(size),
                      }))}
                      value={String(callPageSize)}
                      onChange={(event) => {
                        setCallPageSize(Number(event.currentTarget.value));
                        setCallOffset(0);
                      }}
                      testId="usage-calls-page-size"
                      aria-label={isZh ? '每页行数' : 'Rows per page'}
                    />
                  </label>
                  <Button
                    size="compact"
                    disabled={!callPage.hasPrevious || callsLoading}
                    onClick={() => setCallOffset(callPage.previousOffset)}
                    data-testid="usage-calls-prev"
                  >
                    {isZh ? '上一页' : 'Previous'}
                  </Button>
                  <Button
                    size="compact"
                    disabled={!callPage.hasNext || callsLoading}
                    onClick={() => setCallOffset(callPage.nextOffset)}
                    data-testid="usage-calls-next"
                  >
                    {isZh ? '下一页' : 'Next'}
                  </Button>
                </div>
              </div>
            ) : null}
          </section>
        ) : null}
      </div>
    </section>
  );
}
