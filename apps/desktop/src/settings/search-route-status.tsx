import type { ReactElement } from 'react';
import type { SearchChainStep, SearchRoutePreviewData } from '@piwin/contracts';
import { StatusBadge } from '@piwin/ui-kit';

export type SearchRouteStatusProps = {
  preview: SearchRoutePreviewData | null;
  loading: boolean;
  locale: 'zh-CN' | 'en';
};

const ISSUE_TRANSLATIONS_ZH: Record<string, string> = {
  'no search backend is ready for the configured policy': '当前配置的搜索优先级下无可用搜索渠道',
  'active Pi adapter cannot express provider-native web search for this model':
    '当前运行适配器不支持该模型的内置网络搜索',
  'nativeSearchAdapter is required for models tagged native-web-search':
    '标记了“模型内置搜索”的模型需要选择请求方式（nativeSearchAdapter）',
  'configured web_search delegate model is unavailable': '已指定的搜索代理模型不可用',
  'native-only policy selected but native web search is not ready': '已选择“仅内置搜索”，但内置搜索未就绪',
  'web tools config is absent': '未配置网络工具',
};

function formatIssue(issue: string, zh: boolean): string {
  if (!zh) return issue;
  const exact = ISSUE_TRANSLATIONS_ZH[issue];
  if (exact) return exact;
  const needsProtocol = /^native web search for (\S+) needs the (\S+) request protocol$/u.exec(issue);
  if (needsProtocol) {
    return `${needsProtocol[1]} 的内置搜索需要把请求协议改为 ${needsProtocol[2]}（在该模型的编辑面板里切换）`;
  }
  const incompatible = /^nativeSearchAdapter (\S+) is incompatible with (\S+)$/u.exec(issue);
  if (incompatible) return `请求方式 ${incompatible[1]} 与当前协议 ${incompatible[2]} 不兼容`;
  return issue;
}

function chainStepLabel(step: SearchChainStep, zh: boolean): string {
  switch (step) {
    case 'native':
      return zh ? '模型内置搜索' : 'Built-in search';
    case 'sources':
      return zh ? '搜索源' : 'Search sources';
    case 'duckduckgo':
      return zh ? 'DuckDuckGo 兜底' : 'DuckDuckGo floor';
  }
}

export function SearchRouteStatus(props: SearchRouteStatusProps): ReactElement | null {
  const zh = props.locale === 'zh-CN';
  if (!props.preview) {
    return props.loading ? (
      <p className="muted" data-testid="search-route-loading">
        {zh ? '正在计算搜索优先级…' : 'Resolving search route…'}
      </p>
    ) : null;
  }

  const { route } = props.preview;
  const chain = route.chain ?? [];
  const selectedLabel =
    chain.length === 0
      ? zh
        ? '未启用搜索'
        : 'No search backend'
      : chain.map((step) => chainStepLabel(step, zh)).join(zh ? ' → ' : ' → ');
  const warning = route.issues.length > 0 || chain.length === 0;

  return (
    <div className="search-route-status" data-testid="search-route-status">
      <div className="search-route-status-header">
        <StatusBadge
          tone={warning ? 'warning' : 'success'}
          label={selectedLabel}
          testId="search-route-selected"
        />
        <div className="search-route-model muted" data-testid="search-route-model">
          {props.preview.modelLabel ??
            props.preview.model?.modelId ??
            (zh ? '未选择模型' : 'No model selected')}
        </div>
      </div>
      {chain.length > 1 ? (
        <div className="muted search-route-fallback-label" data-testid="search-route-fallback">
          {zh ? '同一次 web_search 调用内按顺序尝试' : 'Tried in order inside one web_search call'}
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
