import type { ReactElement } from 'react';
import type { SearchRoutePreviewData } from '@piwin/contracts';
import { StatusBadge } from '@piwin/ui-kit';

export type SearchRouteStatusProps = {
  preview: SearchRoutePreviewData | null;
  loading: boolean;
  locale: 'zh-CN' | 'en';
};

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
      <StatusBadge
        tone={warning ? 'warning' : route.selected ? 'success' : 'warning'}
        label={selectedLabel}
        testId="search-route-selected"
      />
      <div className="muted" data-testid="search-route-model">
        {props.preview.modelLabel ??
          props.preview.model?.modelId ??
          (zh ? '未选择模型' : 'No model selected')}
      </div>
      {fallbackLabel ? (
        <div className="muted" data-testid="search-route-fallback">
          {zh ? `不可用时回退：${fallbackLabel}` : `Fallback when unavailable: ${fallbackLabel}`}
        </div>
      ) : null}
      {route.issues.length > 0 ? (
        <ul className="muted" data-testid="search-route-issues">
          {route.issues.slice(0, 3).map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
