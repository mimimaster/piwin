/**
 * `web_search` per-source outcome, lifted by the Host into
 * `presentation.webSearch`. The model only sees merged hits; this is where a
 * silently failed or slow source becomes visible, plus provider-native facts
 * (provider badge, issued queries, grounded brief, Gemini Search Suggestions).
 */
import type { ReactElement } from 'react';
import type {
  NativeSearchAdapterKind,
  WebSearchDiagnostics,
  WebSearchSourceAttempt,
} from '@piwin/contracts';
import { formatToolDuration } from './tool-call-head';
import { SearchSuggestionsFrame } from './search-suggestions-frame';

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

/** Vendor label for a native adapter; never guessed from provider ids. */
export function nativeSearchVendorLabel(adapter: NativeSearchAdapterKind): string | undefined {
  switch (adapter) {
    case 'openai-responses-tool':
    case 'openai-web-search-options':
      return 'OpenAI';
    case 'anthropic-web-search-tool':
      return 'Anthropic';
    case 'google-search-tool':
      return 'Gemini';
    case 'xai-web-search-tool':
      return 'xAI';
  }
}

export function WebSearchSourceAttempts(props: {
  diagnostics: WebSearchDiagnostics;
  locale: Locale;
  /** Grounded brief from the native executor (model-visible output). */
  answer?: string;
}): ReactElement | null {
  const { diagnostics, locale } = props;
  const native = diagnostics.native;
  if (diagnostics.attempts.length === 0 && !native) return null;
  const isZh = locale === 'zh-CN';
  const vendor = native ? nativeSearchVendorLabel(native.diagnostic.adapter) : undefined;
  return (
    <div className="tool-call-web-search-sources" data-testid="tool-call-web-search-sources">
      <div className="tool-call-web-search-sources-head">
        {native && vendor ? (
          <span className="tool-call-web-search-badge" data-testid="tool-call-web-search-badge">
            {isZh ? `${vendor} 原生搜索` : `${vendor} native`}
            {native.fellBackToSources ? (isZh ? ' → 已回退到搜索源' : ' → fell back to sources') : ''}
          </span>
        ) : null}
        {isZh
          ? `搜索源 · 返回 ${diagnostics.hitCount} 条 · ${formatToolDuration(diagnostics.durationMs)}`
          : `Sources · ${diagnostics.hitCount} returned · ${formatToolDuration(diagnostics.durationMs)}`}
      </div>
      {native?.searchQueries && native.searchQueries.length > 0 ? (
        <div className="tool-call-web-search-queries" data-testid="tool-call-web-search-queries">
          {isZh ? '实际搜索：' : 'Searched: '}
          {native.searchQueries.join(' · ')}
        </div>
      ) : null}
      {native && props.answer ? (
        <p className="tool-call-web-search-answer" data-testid="tool-call-web-search-answer">
          {props.answer}
        </p>
      ) : null}
      {native?.searchSuggestionsHtml && native.diagnostic.adapter === 'google-search-tool' ? (
        <SearchSuggestionsFrame html={native.searchSuggestionsHtml} />
      ) : null}
      {diagnostics.attempts.length > 0 ? (
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
      ) : null}
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
