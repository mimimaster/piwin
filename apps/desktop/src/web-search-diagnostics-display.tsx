/**
 * `web_search` per-source outcome, lifted by the Host into
 * `presentation.webSearch`. The model only sees merged hits; this is where a
 * silently failed or slow source becomes visible.
 */
import type { ReactElement } from 'react';
import type { WebSearchDiagnostics, WebSearchSourceAttempt } from '@piwin/contracts';
import { formatToolDuration } from './tool-call-head';

type Locale = 'zh-CN' | 'en';

/** Collapsed-row tag, only when some sources failed but the call still succeeded. */
export function formatWebSearchFailureTag(
  diagnostics: WebSearchDiagnostics | undefined,
  locale: Locale,
): { summary: string; title: string } | undefined {
  if (!diagnostics) return undefined;
  const failed = diagnostics.attempts.filter((attempt) => !attempt.ok);
  if (failed.length === 0) return undefined;
  const total = diagnostics.attempts.length;
  const names = failed.map((attempt) => attempt.sourceId).join(', ');
  return locale === 'zh-CN'
    ? { summary: `${failed.length}/${total} 个源失败`, title: `失败的搜索源：${names}` }
    : {
        summary: `${failed.length}/${total} sources failed`,
        title: `Failed search sources: ${names}`,
      };
}

export function WebSearchSourceAttempts(props: {
  diagnostics: WebSearchDiagnostics;
  locale: Locale;
}): ReactElement | null {
  const { diagnostics, locale } = props;
  if (diagnostics.attempts.length === 0) return null;
  const isZh = locale === 'zh-CN';
  return (
    <div className="tool-call-web-search-sources" data-testid="tool-call-web-search-sources">
      <div className="tool-call-web-search-sources-head">
        {isZh
          ? `搜索源 · 返回 ${diagnostics.hitCount} 条 · ${formatToolDuration(diagnostics.durationMs)}`
          : `Sources · ${diagnostics.hitCount} returned · ${formatToolDuration(diagnostics.durationMs)}`}
      </div>
      <ul>
        {diagnostics.attempts.map((attempt) => (
          <li
            key={attempt.sourceId}
            className={attempt.ok ? 'is-ok' : 'is-failed'}
            data-testid="tool-call-web-search-attempt"
            {...(attempt.error ? { title: attempt.error } : {})}
          >
            <span className="tool-call-web-search-mark" aria-hidden="true">
              {attempt.ok ? '✓' : '✗'}
            </span>
            <span className="tool-call-web-search-source">{attempt.sourceId}</span>
            <span className="tool-call-web-search-outcome">{describeOutcome(attempt, isZh)}</span>
            <span className="tool-call-web-search-duration">
              {formatToolDuration(attempt.durationMs)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function describeOutcome(attempt: WebSearchSourceAttempt, isZh: boolean): string {
  if (attempt.ok) {
    return isZh ? `${attempt.hitCount} 条` : `${attempt.hitCount} hits`;
  }
  if (attempt.timedOut) {
    return isZh ? '超时' : 'timed out';
  }
  return attempt.error ?? (isZh ? '失败' : 'failed');
}
