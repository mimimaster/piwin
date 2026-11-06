/**
 * Compact token usage dashboard (CE-OBS).
 *
 * Three summary cards integrate reference costs into token usage, followed
 * by the annual calendar and recent calls. Model filters are Host-owned. Provider
 * configuration ids are the safe Key dimension: API key values never reach
 * the client.
 */
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { Button, Select } from '@piwin/ui-kit';
import { IconRefresh } from '../tool-cards/shell-icons.js';
import type { HostResponse, UsageCallLog, UsageRollup } from '@piwin/contracts';
import { isRemoteCommandGapError } from '../host/remote-command-gap.js';
import { useDesktopLocale } from '../i18n/desktop-locale-context';
import { UsageActivityHeatmap } from './usage-activity-heatmap';
import { UsageRecentCalls } from './usage-recent-calls';
import { UsageSummary } from './usage-summary.js';
import {
  resolveUsageScopeProjectPath,
  UsageScopeControl,
  type UsageScopeChoice,
} from './usage-scope-control';
import {
  EMPTY_USAGE_CALL_LOG,
  EMPTY_USAGE_ROLLUP,
  RECENT_CALLS_PAGE_SIZE,
  RECENT_CALLS_POLL_MS,
  RECENT_CALLS_WINDOW_MINUTES,
  formatUsageClock,
  normalizeUsageCallLog,
  normalizeUsageRollup,
  resolveUsageWindow,
  type UsageTimeRange,
} from './usage-panel-statistics';

/** Days in the chart are the viewer's days, not UTC ones. */
const VIEWER_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

export type UsagePanelProps = {
  /** The open project, offered as a scope choice; usage starts across all projects. */
  projectPath?: string | null;
  request: (command: {
    type: 'usage/get-rollup' | 'usage/list-recent';
    projectPath?: string;
    modelId?: string;
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
  // The daily reading wins by default; wider windows are one click away.
  const [timeRange, setTimeRange] = useState<UsageTimeRange>('today');
  const [modelId, setModelId] = useState('');
  const rollupGeneration = useRef(0);
  const callGeneration = useRef(0);
  const [scopeChoice, setScopeChoice] = useState<UsageScopeChoice>('all');
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

  const scopedProjectPath = resolveUsageScopeProjectPath(scopeChoice, props.projectPath);

  /**
   * Rolling call log. Kept separate from the rollup load so a 20s poll never
   * re-reads the 30-day aggregate, and so a Host without the command only
   * hides this one card.
   */
  const loadCallLog = useCallback(async () => {
    const generation = ++callGeneration.current;
    setCallsLoading(true);
    try {
      const response = await requestRef.current({
        type: 'usage/list-recent',
        ...(scopedProjectPath ? { projectPath: scopedProjectPath } : {}),
        ...(modelId ? { modelId } : {}),
        windowMinutes: RECENT_CALLS_WINDOW_MINUTES,
        limit: callPageSize,
        offset: callOffset,
      });
      if (generation !== callGeneration.current) return;
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
      if (generation === callGeneration.current) setCallLogSupported(false);
    } finally {
      if (generation === callGeneration.current) setCallsLoading(false);
    }
  }, [callOffset, callPageSize, scopedProjectPath, modelId]);

  const load = useCallback(async () => {
    const generation = ++rollupGeneration.current;
    setLoading(true);
    setError(null);
    try {
      const window = resolveUsageWindow(timeRange);
      const response = await props.request({
        type: 'usage/get-rollup',
        ...(scopedProjectPath ? { projectPath: scopedProjectPath } : {}),
        ...(modelId ? { modelId } : {}),
        ...(window ? { window } : {}),
        timeZone: VIEWER_TIME_ZONE,
      });
      if (generation !== rollupGeneration.current) return;
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
      if (generation === rollupGeneration.current) setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      if (generation === rollupGeneration.current) setLoading(false);
    }
  }, [props.request, scopedProjectPath, timeRange, modelId]);

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

  // A scope switch is a different result set; start it from the newest page.
  useEffect(() => {
    setCallOffset(0);
  }, [scopedProjectPath]);

  // A new page starts at its first row, not wherever the previous page was
  // scrolled to.
  // The table grows with the page (no nested vertical scroller), so bring the
  // card's top back into view instead of resetting an inner scrollTop.
  const callPagingMounted = useRef(false);
  useEffect(() => {
    if (!callPagingMounted.current) {
      callPagingMounted.current = true;
      return;
    }
    callScrollRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [callOffset, callPageSize]);

  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setHeaderSlot(document.getElementById('settings-main-header-actions'));
  }, []);

  const refreshedLabel = refreshedAt ? formatUsageClock(refreshedAt, locale) : null;

  const modelOptions = [...new Set([...(rollup.availableModels ?? []), ...(modelId ? [modelId] : [])])];

  const timeRangeOptions = [
    { value: 'today', label: isZh ? '今天' : 'Today' },
    { value: '7d', label: isZh ? '最近 7 天' : 'Last 7 days' },
    { value: '30d', label: isZh ? '最近 30 天' : 'Last 30 days' },
    { value: '90d', label: isZh ? '最近 90 天' : 'Last 90 days' },
    { value: 'all', label: isZh ? '全部时间' : 'All time' },
  ];

  const toolbarControls = (
    <div className="usage-toolbar-controls" data-testid="usage-toolbar-controls">
      {props.projectPath ? (
        <UsageScopeControl
          value={scopeChoice}
          projectPath={props.projectPath}
          isZh={isZh}
          onChange={setScopeChoice}
        />
      ) : null}
      <Select
        className="usage-model-filter"
        value={modelId}
        disabled={rollup.availableModels === undefined}
        data={[{ value: '', label: isZh ? '所有模型' : 'All models' }, ...modelOptions.map((value) => ({ value, label: value }))]}
        onChange={(event) => { setModelId(event.currentTarget.value); setCallOffset(0); }}
        testId="usage-model-select"
        aria-label={isZh ? '筛选模型' : 'Filter model'}
        title={rollup.availableModels === undefined ? (isZh ? '当前 Host 不支持模型筛选' : 'Model filtering unavailable on this Host') : (modelId || (isZh ? '所有模型' : 'All models'))}
      />
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
        <UsageSummary rollup={rollup} locale={locale} isZh={isZh} />

        <UsageActivityHeatmap
          request={props.request}
          {...(scopedProjectPath ? { projectPath: scopedProjectPath } : {})}
          {...(modelId ? { modelId } : {})}
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
