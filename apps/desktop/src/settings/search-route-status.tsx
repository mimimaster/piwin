import type { ReactElement } from 'react';
import type { SearchRoutePreviewData } from '@piwin/contracts';
import { StatusBadge } from '@piwin/ui-kit';

export type SearchRouteStatusProps = {
  preview: SearchRoutePreviewData | null;
  loading: boolean;
  locale: 'zh-CN' | 'en';
};

const ISSUE_TRANSLATIONS_ZH: Record<string, string> = {
  'selected chat model is not tagged native-web-search': '当前选择的对话模型未标记“模型内置搜索”能力',
  'no enabled external search source': '未启用任何外部搜索源',
  'no search backend is ready for the configured policy': '当前配置的路由策略下无可用搜索渠道',
  'no chat model selected for native web search': '未选择对话模型',
  'selected chat model is disabled': '当前选择的对话模型已停用',
  'active Pi adapter cannot express provider-native web search for this model':
    '当前运行适配器不支持该模型的内置网络搜索',
  'native web search request shaping is available, but citation normalization is not fully supported':
    '支持内置搜索请求，但引用解析尚未完全支持',
  'native search adapter is unavailable': '内置搜索适配器不可用',
};

function formatIssue(issue: string, zh: boolean): string {
  if (!zh) return issue;
  return ISSUE_TRANSLATIONS_ZH[issue] ?? issue;
}

export function SearchRouteStatus(props: SearchRouteStatusProps): ReactElement | null {
  const zh = props.locale === 'zh-CN';
  if (!props.preview) {
    return props.loading ? (
      <p className="muted" data-testid="search-route-loading">
        {zh ? '正在计算搜索路由…' : 'Resolving search route…'}
      </p>
    ) : null;
  }

  const { route } = props.preview;
  const selectedLabel =
    route.selected === 'native'
      ? zh
        ? '模型内置搜索'
        : 'Provider-native search'
      : route.selected === 'external'
        ? zh
          ? 'piwin 外部搜索'
          : 'External Host search'
        : zh
          ? '未启用搜索'
          : 'No search backend';
  const fallbackLabel =
    route.fallback === 'native'
      ? zh
        ? '模型内置搜索'
        : 'native search'
      : route.fallback === 'external'
        ? zh
          ? '外部搜索'
          : 'external search'
        : null;
  const warning = route.issues.length > 0;

  return (
    <div className="search-route-status" data-testid="search-route-status">
      <div className="search-route-status-header">
        <StatusBadge
          tone={warning ? 'warning' : route.selected ? 'success' : 'warning'}
          label={selectedLabel}
          testId="search-route-selected"
        />
        <div className="search-route-model muted" data-testid="search-route-model">
          {props.preview.modelLabel ??
            props.preview.model?.modelId ??
            (zh ? '未选择模型' : 'No model selected')}
        </div>
      </div>
      {fallbackLabel ? (
        <div className="muted search-route-fallback-label" data-testid="search-route-fallback">
          {zh ? `不可用时回退：${fallbackLabel}` : `Fallback when unavailable: ${fallbackLabel}`}
        </div>
      ) : null}
      {route.issues.length > 0 ? (
        <ul className="muted search-route-issue-list" data-testid="search-route-issues">
          {route.issues.slice(0, 3).map((issue) => (
            <li key={issue}>{formatIssue(issue, zh)}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

