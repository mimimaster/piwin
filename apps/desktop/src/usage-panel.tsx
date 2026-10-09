/**
 * Compact token usage dashboard (CE-OBS).
 *
 * Information is intentionally consolidated into four peer summary cards
 * (reference cost first), one usage heatmap, and the recent-call log. The
 * model + Key cost breakdown is opt-in and collapsed by default. Provider
 * configuration ids are the safe Key dimension: API key values never reach
 * the client.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { Button, Select } from '@piwin/ui-kit';
import { IconRefresh } from './shell-icons.js';
import {
  computePromptCacheHitRate,
  type HostResponse,
  type UsageCallLog,
  type UsageRollup,
} from '@piwin/contracts';
import { isRemoteCommandGapError } from './remote-command-gap.js';
import { useDesktopLocale } from './desktop-locale-context';
import { UsageActivityHeatmap } from './usage-activity-heatmap';
import { UsageRecentCalls } from './usage-recent-calls';
import { UsageCostOverviewCard } from './usage-cost-overview';
import { UsageCostDetails } from './usage-cost-details';
import {
  EMPTY_USAGE_CALL_LOG,
  EMPTY_USAGE_ROLLUP,
  RECENT_CALLS_PAGE_SIZE,
  RECENT_CALLS_POLL_MS,
  RECENT_CALLS_WINDOW_MINUTES,
  formatUsageClock,
  formatUsageCompact,
  formatUsageDate,
  formatUsageExact,
  formatUsagePercent,
  normalizeUsageCallLog,
  normalizeUsageRollup,
  resolveUsageWindow,
  type UsageTimeRange,
} from './usage-panel-statistics';

/** Days in the chart are the viewer's days, not UTC ones. */
const VIEWER_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

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
    timeZone?: string;
  }) => Promise<HostResponse>;
};

export function UsagePanel(props: UsagePanelProps): ReactElement {
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';
  const [timeRange, setTimeRange] = useState<UsageTimeRange>('30d');
  const [rollup, setRollup] = useState<UsageRollup>(EMPTY_USAGE_ROLLUP);
  const [callLog, setCallLog] = useState<UsageCallLog>(EMPTY_USAGE_CALL_LOG);
  const [callLogSupported, setCallLogSupported] = useState(true);
  const [callPageSize, setCallPageSize] = useState<number>(RECENT_CALLS_PAGE_SIZE);
  const [callOffset, setCallOffset] = useState(0);
  const [callsLoading, setCallsLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [costDetailsOpen, setCostDetailsOpen] = useState(false);
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
        timeZone: VIEWER_TIME_ZONE,
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

  const activeDays = useMemo(
    () => Object.values(rollup.byDay).filter((bucket) => bucket.totalTokens > 0).length,
    [rollup.byDay],
  );

  const cacheReadTokens = rollup.cacheReadTokens ?? 0;
  const cacheWriteTokens = rollup.cacheWriteTokens ?? 0;
  const cacheTrafficTokens = cacheReadTokens + cacheWriteTokens;
  const cacheableInputTokens = rollup.promptTokens + cacheReadTokens + cacheWriteTokens;
  const cacheHitRate = computePromptCacheHitRate(rollup);
  const rangeLabel = `${formatUsageDate(rollup.firstAt, locale)} – ${formatUsageDate(rollup.lastAt, locale)}`;

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
          <UsageCostOverviewCard
            rollup={rollup}
            isZh={isZh}
            detailsOpen={costDetailsOpen}
            onDetailsOpen={setCostDetailsOpen}
          />

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
            <span className="usage-summary-label">{isZh ? '请求数' : 'Requests'}</span>
            <strong className="usage-summary-value" data-testid="usage-request-count">
              {formatUsageExact(rollup.entryCount)}
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

        {costDetailsOpen && rollup.byModelKey.length > 0 ? (
          <UsageCostDetails rows={rollup.byModelKey} isZh={isZh} />
        ) : null}

        <UsageActivityHeatmap
          request={props.request}
          {...(scopedProjectPath ? { projectPath: scopedProjectPath } : {})}
          timeZone={VIEWER_TIME_ZONE}
          reloadKey={refreshedAt}
          locale={locale}
          isZh={isZh}
        />

        {callLogSupported ? (
          <UsageRecentCalls
            callLog={callLog} locale={locale} isZh={isZh} autoRefresh={autoRefresh}
            callOffset={callOffset} callPageSize={callPageSize} callsLoading={callsLoading}
            callScrollRef={callScrollRef} onAutoRefresh={setAutoRefresh}
            onOffset={setCallOffset} onPageSize={setCallPageSize}
          />
        ) : null}
      </div>
    </section>
  );
}
