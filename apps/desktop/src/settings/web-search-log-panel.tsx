/**
 * Settings → Web → Call log. Cross-session `web_search` calls recorded by the
 * Host, newest first, with per-source outcome, pagination, and enriched fields.
 */
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import type { HostResponse, WebSearchLogEntry, WebSearchLogPage, WebSearchLogStatusFilter } from '@piwin/contracts';
import { Button, Select } from '@piwin/ui-kit';
import { IconRefresh } from '../shell-icons.js';
import { isRemoteCommandGapError } from '../remote-command-gap.js';
import { formatToolDuration } from '../tool-call-head';
import { WebSearchSourceAttempts } from '../web-search-diagnostics-display';

export const WEB_SEARCH_LOG_PAGE_SIZES = [20, 50, 100] as const;
const DEFAULT_PAGE_SIZE = 20;

export type WebSearchSourceKindTag = 'model' | 'provider' | 'custom' | 'aggregate' | 'unknown';

export type WebSearchSourceInfo = {
  label: string;
  kind: WebSearchSourceKindTag;
  title: string;
};

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
  const [entries, setEntries] = useState<WebSearchLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const requestRef = useRef(props.request);
  requestRef.current = props.request;

  const load = useCallback(
    async (targetPage: number, targetPageSize: number) => {
      setLoading(true);
      setError(null);
      try {
        const offset = Math.max(0, (targetPage - 1) * targetPageSize);
        const response = await requestRef.current({
          type: 'web/search-log-list',
          limit: targetPageSize,
          offset,
          logStatus: 'all',
        });
        if (!response.success) {
          if (isRemoteCommandGapError(response.error)) {
            setUnsupported(true);
          } else {
            setError(response.error);
          }
          return;
        }
        const pageData = (response.data as { page?: WebSearchLogPage }).page;
        const rows = Array.isArray(pageData?.entries) ? pageData.entries : [];
        const nextTotal = typeof pageData?.total === 'number' ? pageData.total : rows.length;
        setEntries(rows);
        setTotal(nextTotal);

        // Clamping page if total shrank
        const maxPage = Math.max(1, Math.ceil(nextTotal / targetPageSize));
        if (targetPage > maxPage && nextTotal > 0) {
          setPage(maxPage);
        }
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void load(page, pageSize);
  }, [load, page, pageSize]);

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
    setPage(1);
    await load(1, pageSize);
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const firstRow = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastRow = total === 0 ? 0 : Math.min(page * pageSize, total);

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
        <div className="web-search-log-heading">
          <span className="web-search-log-count" data-testid="web-search-log-count">
            {isZh ? `共 ${total} 条记录（最近 300 条）` : `Total ${total} calls (latest 300)`}
          </span>
        </div>
        <div className="web-search-log-actions">
          <Button
            variant="ghost"
            size="compact"
            onClick={() => void load(page, pageSize)}
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
      </div>

      {error ? (
        <div className="web-search-log-error" role="alert">
          {error}
        </div>
      ) : null}

      {entries.length === 0 && !loading ? (
        <div className="web-search-log-empty" data-testid="web-search-log-empty">
          {isZh
            ? '还没有搜索调用记录。Agent 调用 web_search 后会出现在这里（仅保留最近 300 条）。'
            : 'No search calls yet. They appear here after the agent calls web_search (latest 300 kept).'}
        </div>
      ) : (
        <ul className="web-search-log-list">
          {entries.map((entry) => {
            const expanded = expandedId === entry.id;
            const failedSources = entry.attempts.filter((attempt) => !attempt.ok).length;
            const tone = !entry.ok ? 'is-failed' : failedSources > 0 ? 'is-partial' : 'is-ok';
            const sourceInfo = parseWebSearchSourceInfo(entry.providerId, isZh);
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
                  <span
                    className={`web-search-log-source-tag tone-${sourceInfo.kind}`}
                    title={sourceInfo.title}
                    data-testid="web-search-log-source-tag"
                  >
                    {sourceInfo.label}
                  </span>
                  <span
                    className="web-search-log-session"
                    title={entry.sessionId}
                    data-testid="web-search-log-session"
                  >
                    {formatSessionTag(entry.sessionId)}
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
                      <dt>{isZh ? '查询关键词' : 'Query'}</dt>
                      <dd>{entry.query}</dd>
                      <dt>{isZh ? '调用来源' : 'Source'}</dt>
                      <dd className="web-search-log-source-row">
                        <span className={`web-search-log-source-tag tone-${sourceInfo.kind}`}>
                          {sourceInfo.label}
                        </span>
                        {sourceInfo.title !== sourceInfo.label ? (
                          <span className="web-search-log-source-title">{sourceInfo.title}</span>
                        ) : null}
                        <code className="web-search-log-code">{entry.providerId}</code>
                      </dd>
                      <dt>{isZh ? '执行状态' : 'Status'}</dt>
                      <dd>
                        {entry.ok
                          ? isZh
                            ? `成功 · 返回 ${entry.hitCount} 条结果`
                            : `Success · ${entry.hitCount} hits returned`
                          : isZh
                            ? '执行失败'
                            : 'Execution failed'}
                        {failedSources > 0 && entry.ok
                          ? isZh
                            ? `（其中 ${failedSources} 个搜索源失败）`
                            : ` (${failedSources} sources failed)`
                          : null}
                      </dd>
                      <dt>{isZh ? '执行耗时' : 'Duration'}</dt>
                      <dd>{`${entry.durationMs}ms (${formatToolDuration(entry.durationMs)})`}</dd>
                      <dt>{isZh ? '会话标识' : 'Session ID'}</dt>
                      <dd>
                        <code className="web-search-log-code">{entry.sessionId}</code>
                      </dd>
                      <dt>{isZh ? '记录时间' : 'Recorded At'}</dt>
                      <dd>{formatFull(entry.recordedAt, locale)}</dd>
                    </dl>
                    {entry.error ? (
                      <div className="web-search-log-error" role="alert">
                        <strong>{isZh ? '错误详情：' : 'Error: '}</strong>
                        {entry.error}
                      </div>
                    ) : null}
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

      {total > 0 ? (
        <div className="web-search-log-pager" data-testid="web-search-log-pager">
          <span className="web-search-log-range" data-testid="web-search-log-range">
            {isZh
              ? `第 ${firstRow}–${lastRow} 条 / 共 ${total} 条`
              : `${firstRow}–${lastRow} of ${total}`}
          </span>
          <div className="web-search-log-pager-controls">
            <label className="web-search-log-page-size">
              <span>{isZh ? '每页' : 'Rows'}</span>
              <Select
                data={WEB_SEARCH_LOG_PAGE_SIZES.map((size) => ({
                  value: String(size),
                  label: String(size),
                }))}
                value={String(pageSize)}
                onChange={(event) => {
                  const next = Number(event.currentTarget.value);
                  setPageSize(next);
                  setPage(1);
                }}
                testId="web-search-log-page-size"
                aria-label={isZh ? '每页条数' : 'Rows per page'}
              />
            </label>
            <Button
              variant="ghost"
              size="compact"
              disabled={page <= 1 || loading}
              onClick={() => setPage(1)}
              data-testid="web-search-log-first"
              title={isZh ? '首页' : 'First page'}
            >
              {isZh ? '首页' : 'First'}
            </Button>
            <Button
              variant="ghost"
              size="compact"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              data-testid="web-search-log-prev"
            >
              {isZh ? '上一页' : 'Previous'}
            </Button>
            <span className="web-search-log-page-indicator" data-testid="web-search-log-page-indicator">
              {isZh ? `第 ${page} / ${totalPages} 页` : `Page ${page} of ${totalPages}`}
            </span>
            <Button
              variant="ghost"
              size="compact"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              data-testid="web-search-log-next"
            >
              {isZh ? '下一页' : 'Next'}
            </Button>
            <Button
              variant="ghost"
              size="compact"
              disabled={page >= totalPages || loading}
              onClick={() => setPage(totalPages)}
              data-testid="web-search-log-last"
              title={isZh ? '末页' : 'Last page'}
            >
              {isZh ? '末页' : 'Last'}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Parses providerId into a structured descriptor with readable labels and tone kinds. */
export function parseWebSearchSourceInfo(providerId: string, isZh: boolean): WebSearchSourceInfo {
  if (!providerId || providerId === 'unconfigured' || providerId === 'none') {
    return {
      label: isZh ? '未配置' : 'Unconfigured',
      kind: 'unknown',
      title: providerId || 'unconfigured',
    };
  }
  if (providerId.startsWith('model-delegate:')) {
    const model = providerId.slice('model-delegate:'.length);
    return {
      label: isZh ? '模型内置' : 'Model native',
      kind: 'model',
      title: isZh ? `模型内置搜索 (${model})` : `Model native search (${model})`,
    };
  }
  if (providerId.startsWith('aggregate:')) {
    const rawSources = providerId.slice('aggregate:'.length).split('+');
    const sourceNames = rawSources.map(formatSingleSourceName).join(' + ');
    return {
      label: isZh ? `聚合 (${rawSources.length}源)` : `Aggregate (${rawSources.length})`,
      kind: 'aggregate',
      title: isZh ? `聚合搜索 (${sourceNames})` : `Aggregate search (${sourceNames})`,
    };
  }
  if (providerId === 'tavily') {
    return { label: 'Tavily', kind: 'provider', title: 'Tavily Search API' };
  }
  if (providerId === 'brave') {
    return { label: 'Brave', kind: 'provider', title: 'Brave Search API' };
  }
  if (providerId === 'duckduckgo') {
    return { label: 'DuckDuckGo', kind: 'provider', title: 'DuckDuckGo Search' };
  }
  if (providerId === 'searxng') {
    return { label: 'SearXNG', kind: 'provider', title: 'SearXNG Search' };
  }
  if (providerId === 'cli') {
    return { label: isZh ? '自定义 CLI' : 'Custom CLI', kind: 'custom', title: 'CLI command search' };
  }
  if (providerId === 'http') {
    return { label: isZh ? '自定义 HTTP' : 'Custom HTTP', kind: 'custom', title: 'Custom HTTP search' };
  }
  return {
    label: providerId,
    kind: 'custom',
    title: providerId,
  };
}

function formatSingleSourceName(id: string): string {
  if (id === 'tavily') return 'Tavily';
  if (id === 'brave') return 'Brave';
  if (id === 'duckduckgo') return 'DuckDuckGo';
  if (id === 'searxng') return 'SearXNG';
  if (id === 'cli') return 'CLI';
  if (id === 'http') return 'HTTP';
  return id;
}

/** Short, stable tag for a session UUID in a dense list row. */
export function formatSessionTag(sessionId: string): string {
  const trimmed = sessionId.trim();
  if (trimmed.length === 0) return '—';
  return trimmed.length <= 8 ? trimmed : `${trimmed.slice(0, 8)}…`;
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

