/**
 * Settings → Web → Call log. Cross-session `web_search` calls recorded by the
 * Host, newest first, with per-source outcome on expand.
 */
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import type { HostResponse, WebSearchLogEntry, WebSearchLogPage, WebSearchLogStatusFilter } from '@piwin/contracts';
import { Button, SegmentedControl } from '@piwin/ui-kit';
import { IconRefresh } from '../shell-icons.js';
import { isRemoteCommandGapError } from '../remote-command-gap.js';
import { formatToolDuration } from '../tool-call-head';
import { WebSearchSourceAttempts } from '../web-search-diagnostics-display';

const PAGE_SIZE = 50;

export type WebSearchLogPanelProps = {
  locale: 'zh-CN' | 'en';
  request: (command: {
    type: 'web/search-log-list' | 'web/search-log-clear';
    limit?: number;
    offset?: number;
    logStatus?: WebSearchLogStatusFilter;
  }) => Promise<HostResponse>;
  /** Remote read-only settings may list but not clear. */
  readOnly?: boolean;
};

export function WebSearchLogPanel(props: WebSearchLogPanelProps): ReactElement {
  const { locale, readOnly } = props;
  const isZh = locale === 'zh-CN';
  const [status, setStatus] = useState<WebSearchLogStatusFilter>('all');
  const [entries, setEntries] = useState<WebSearchLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const requestRef = useRef(props.request);
  requestRef.current = props.request;

  const load = useCallback(
    async (offset: number) => {
      setLoading(true);
      setError(null);
      try {
        const response = await requestRef.current({
          type: 'web/search-log-list',
          limit: PAGE_SIZE,
          offset,
          logStatus: status,
        });
        if (!response.success) {
          if (isRemoteCommandGapError(response.error)) {
            setUnsupported(true);
          } else {
            setError(response.error);
          }
          return;
        }
        const page = (response.data as { page?: WebSearchLogPage }).page;
        const rows = Array.isArray(page?.entries) ? page.entries : [];
        setEntries((previous) => (offset === 0 ? rows : [...previous, ...rows]));
        setTotal(typeof page?.total === 'number' ? page.total : rows.length);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      } finally {
        setLoading(false);
      }
    },
    [status],
  );

  useEffect(() => {
    void load(0);
  }, [load]);

  async function clearLog(): Promise<void> {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    setConfirmClear(false);
    const response = await requestRef.current({ type: 'web/search-log-clear' });
    if (!response.success) {
      setError(response.error);
      return;
    }
    setExpandedId(null);
    await load(0);
  }

  if (unsupported) {
    return (
      <div className="settings-section settings-section-card" data-testid="web-search-log">
        <p className="muted">
          {isZh
            ? '当前连接的 Host 版本不支持搜索调用日志。'
            : 'The connected Host does not support the search call log.'}
        </p>
      </div>
    );
  }

  return (
    <div
      className="settings-section settings-section-card web-search-log"
      data-testid="web-search-log"
      aria-busy={loading}
    >
      <div className="web-search-log-toolbar">
        <SegmentedControl
          value={status}
          onChange={(value) => {
            setExpandedId(null);
            setStatus(value as WebSearchLogStatusFilter);
          }}
          data={[
            { value: 'all', label: isZh ? '全部' : 'All' },
            { value: 'failed', label: isZh ? '有失败' : 'With failures' },
          ]}
          testId="web-search-log-status"
        />
        <span className="web-search-log-count" data-testid="web-search-log-count">
          {isZh ? `共 ${total} 条` : `${total} calls`}
        </span>
        <Button
          variant="ghost"
          size="compact"
          onClick={() => void load(0)}
          disabled={loading}
          data-testid="web-search-log-refresh"
        >
          <IconRefresh width={13} height={13} />
          <span>{isZh ? '刷新' : 'Refresh'}</span>
        </Button>
        {readOnly ? null : (
          <Button
            variant={confirmClear ? 'danger' : 'ghost'}
            size="compact"
            onClick={() => void clearLog()}
            onBlur={() => setConfirmClear(false)}
            disabled={loading || total === 0}
            data-testid="web-search-log-clear"
          >
            {confirmClear ? (isZh ? '确认清空' : 'Confirm clear') : isZh ? '清空' : 'Clear'}
          </Button>
        )}
      </div>

      {error ? (
        <div className="web-search-log-error" role="alert">
          {error}
        </div>
      ) : null}

      {entries.length === 0 && !loading ? (
        <div className="web-search-log-empty" data-testid="web-search-log-empty">
          {status === 'failed'
            ? isZh
              ? '没有失败的搜索调用。'
              : 'No failed search calls.'
            : isZh
              ? '还没有搜索调用记录。Agent 调用 web_search 后会出现在这里。'
              : 'No search calls yet. They appear here after the agent calls web_search.'}
        </div>
      ) : (
        <ul className="web-search-log-list">
          {entries.map((entry) => {
            const expanded = expandedId === entry.id;
            const failedSources = entry.attempts.filter((attempt) => !attempt.ok).length;
            const tone = !entry.ok ? 'is-failed' : failedSources > 0 ? 'is-partial' : 'is-ok';
            return (
              <li key={entry.id} className={`web-search-log-row ${tone}`}>
                <button
                  type="button"
                  className="web-search-log-summary"
                  aria-expanded={expanded}
                  onClick={() => setExpandedId(expanded ? null : entry.id)}
                  data-testid="web-search-log-row"
                >
                  <span className="web-search-log-time" title={formatFull(entry.recordedAt, locale)}>
                    {formatWhen(entry.recordedAt, locale)}
                  </span>
                  <span className="web-search-log-mark" aria-hidden="true">
                    {entry.ok ? (failedSources > 0 ? '!' : '✓') : '✗'}
                  </span>
                  <span className="web-search-log-query" title={entry.query}>
                    {entry.query}
                  </span>
                  <span className="web-search-log-result">
                    {entry.ok
                      ? isZh
                        ? `${entry.hitCount} 条`
                        : `${entry.hitCount} hits`
                      : isZh
                        ? '失败'
                        : 'failed'}
                    {entry.ok && failedSources > 0
                      ? isZh
                        ? ` · ${failedSources} 源失败`
                        : ` · ${failedSources} failed`
                      : ''}
                  </span>
                  <span className="web-search-log-duration">
                    {formatToolDuration(entry.durationMs)}
                  </span>
                </button>
                {expanded ? (
                  <div className="web-search-log-detail" data-testid="web-search-log-detail">
                    <dl className="web-search-log-meta">
                      <dt>{isZh ? '查询' : 'Query'}</dt>
                      <dd>{entry.query}</dd>
                      <dt>{isZh ? '搜索后端' : 'Backend'}</dt>
                      <dd>{entry.providerId}</dd>
                      <dt>{isZh ? '会话' : 'Session'}</dt>
                      <dd>{entry.sessionId}</dd>
                      <dt>{isZh ? '时间' : 'Time'}</dt>
                      <dd>{formatFull(entry.recordedAt, locale)}</dd>
                    </dl>
                    {entry.error ? <div className="web-search-log-error">{entry.error}</div> : null}
                    <WebSearchSourceAttempts
                      diagnostics={{
                        kind: 'web-search-diagnostics',
                        providerId: entry.providerId,
                        hitCount: entry.hitCount,
                        durationMs: entry.durationMs,
                        attempts: entry.attempts,
                      }}
                      locale={locale}
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {entries.length < total ? (
        <div className="web-search-log-more">
          <Button
            variant="ghost"
            size="compact"
            disabled={loading}
            onClick={() => void load(entries.length)}
            data-testid="web-search-log-more"
          >
            {isZh ? `加载更多（还有 ${total - entries.length} 条）` : `Load more (${total - entries.length} left)`}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** Today → clock time; otherwise month/day plus clock. */
function formatWhen(value: string, locale: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  const time = date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false });
  if (date.toDateString() === new Date().toDateString()) return time;
  return `${date.toLocaleDateString(locale, { month: '2-digit', day: '2-digit' })} ${time}`;
}

function formatFull(value: string, locale: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'medium' })
    : value;
}
