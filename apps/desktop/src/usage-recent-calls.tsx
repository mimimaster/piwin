import type { ReactElement, RefObject } from 'react';
import { Button, Select, Switch } from '@piwin/ui-kit';
import { computePromptCacheHitRate, computeTokensPerSecond, type UsageCallLog } from '@piwin/contracts';
import {
  RECENT_CALLS_PAGE_SIZES, RECENT_CALLS_POLL_MS, formatThinkingLabel, formatTokensPerSecond, formatUsageClock,
  formatUsageCompact, formatUsageDuration, formatUsageExact, formatUsagePercent,
  formatUsageTimestamp, resolveUsageCallLogPage, summarizeUsageCallLog,
} from './usage-panel-statistics';

export type UsageRecentCallsProps = {
  callLog: UsageCallLog;
  locale: string;
  isZh: boolean;
  autoRefresh: boolean;
  callOffset: number;
  callPageSize: number;
  callsLoading: boolean;
  callScrollRef: RefObject<HTMLDivElement | null>;
  onAutoRefresh: (value: boolean) => void;
  onOffset: (value: number) => void;
  onPageSize: (value: number) => void;
};

export function UsageRecentCalls({
  callLog, locale, isZh, autoRefresh, callOffset, callPageSize, callsLoading, callScrollRef,
  onAutoRefresh: setAutoRefresh, onOffset: setCallOffset, onPageSize: setCallPageSize,
}: UsageRecentCallsProps): ReactElement {
  const callSummary = summarizeUsageCallLog(callLog.entries);
  const callPage = resolveUsageCallLogPage(callLog);
  const livePaused = !autoRefresh || callOffset > 0;
  return (
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
                      <th>{isZh ? '模型' : 'Model'}</th>
                      <th>Key</th>
                      <th title={isZh ? '本次调用的思考度' : 'Thinking level for this call'}>
                        {isZh ? '思考度' : 'Thinking'}
                      </th>
                      <th>{isZh ? '缓存' : 'Cache'}</th>
                      <th title={isZh ? '首字延迟（Time to First Token）' : 'Time to first token'}>
                        {isZh ? '首字延迟' : 'First token'}
                      </th>
                      <th title={isZh ? '每秒 Token 数（Tokens Per Second）' : 'Tokens per second'}>
                        TPS
                      </th>
                      <th>{isZh ? '直接输入 / 输出' : 'Direct input / output'}</th>
                      <th>{isZh ? '缓存读 / 写' : 'Cache read / write'}</th>
                      <th>{isZh ? '总计' : 'Total'}</th>
                      <th>{isZh ? '时间' : 'Time'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {callLog.entries.map((entry) => {
                      const entryHitRate = computePromptCacheHitRate(entry);
                      const tokensPerSecond = computeTokensPerSecond({
                         completionTokens: entry.completionTokens,
                         ...(entry.durationMs !== undefined ? { durationMs: entry.durationMs } : {}),
                         ...(entry.firstTokenMs !== undefined
                           ? { firstTokenMs: entry.firstTokenMs }
                           : {}),
                         ...(entry.reasoningTokens !== undefined
                           ? { reasoningTokens: entry.reasoningTokens }
                           : {}),
                         ...(entry.firstTokenKind !== undefined
                           ? { firstTokenKind: entry.firstTokenKind }
                           : {}),
                      });
                      return (
                        <tr
                          key={entry.id}
                          data-testid="usage-call-row"
                          data-failed={entry.success === false ? 'true' : undefined}
                        >
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
                          <td className="usage-call-thinking" data-testid="usage-call-thinking">
                            {formatThinkingLabel(entry.thinkingLevel, isZh)}
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
                          <td
                            className="usage-tps-cell"
                            title={
                              entry.durationMs !== undefined
                                ? `${isZh ? '总用时: ' : 'Total: '}${formatUsageDuration(entry.durationMs)}`
                                : undefined
                            }
                            data-testid="usage-call-first-token"
                          >
                            {formatUsageDuration(entry.firstTokenMs)}
                          </td>
                          <td
                            className="usage-tps-cell"
                            data-testid="usage-call-tps"
                            title={entry.timingScope === 'turn'
                              ? isZh
                                ? '整轮平均 TPS，包含工具执行和审批等待'
                                : 'Turn average TPS, including tools and approvals'
                              : undefined}
                          >
                            {formatTokensPerSecond(tokensPerSecond)}
                            {entry.timingScope === 'turn' && tokensPerSecond !== null
                              ? (isZh ? '（整轮）' : ' (turn)') : ''}
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
                          <td title={formatUsageExact(entry.totalTokens)}>
                            <strong>{formatUsageCompact(entry.totalTokens)}</strong>
                          </td>
                          <td
                            className="usage-call-time"
                            title={formatUsageTimestamp(entry.recordedAt, locale)}
                          >
                            {formatUsageClock(entry.recordedAt, locale)}
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
  );
}
