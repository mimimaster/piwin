/**
 * Structured editor for OpenRouter provider routing (`body.provider`): which
 * upstreams serve the model, whether OpenRouter may fall back to others, and
 * the load-balancing preference. Reads from and writes to the custom request
 * body so the JSON text stays the single source of truth.
 */
import { useEffect, useState, type ReactElement } from 'react';
import { SegmentedControl, TextInput } from '@piwin/ui-kit';
import {
  OPENROUTER_UPSTREAM_SUGGESTIONS,
  parseUpstreamList,
  type OpenRouterRouting,
  type OpenRouterSort,
} from './model-request-overrides.js';

export type OpenRouterRoutingFieldsProps = {
  routing: OpenRouterRouting;
  /** The body JSON is invalid; routing cannot be read or written. */
  blocked: boolean;
  disabled: boolean;
  isChinese: boolean;
  testIdPrefix: string;
  onChange: (routing: OpenRouterRouting) => void;
};

export function OpenRouterRoutingFields({
  routing,
  blocked,
  disabled,
  isChinese,
  testIdPrefix,
  onChange,
}: OpenRouterRoutingFieldsProps): ReactElement {
  const t = isChinese ? ZH : EN;
  const orderKey = routing.order.join(',');
  const orderDisplay = routing.order.join(', ');
  // Local text so typing "anthropic, " keeps its trailing separator; resync
  // only when the body's order changes underneath (JSON edit, chip click).
  const [orderText, setOrderText] = useState(orderDisplay);
  useEffect(() => {
    setOrderText((current) =>
      parseUpstreamList(current).join(',') === orderKey ? current : orderDisplay,
    );
  }, [orderKey, orderDisplay]);

  const inactive = disabled || blocked;
  const prefix = `${testIdPrefix}-openrouter`;

  function toggleUpstream(slug: string): void {
    const order = routing.order.includes(slug)
      ? routing.order.filter((item) => item !== slug)
      : [...routing.order, slug];
    setOrderText(order.join(', '));
    onChange({ ...routing, order });
  }

  return (
    <div className="model-request-openrouter" data-testid={prefix}>
      <div className="model-request-openrouter-head">
        <span className="model-request-overrides-label">{t.title}</span>
        <span className="model-request-overrides-hint">{t.writesTo}</span>
      </div>
      {blocked ? (
        <p className="model-request-overrides-hint" data-testid={`${prefix}-blocked`}>
          {t.blocked}
        </p>
      ) : null}
      <TextInput
        value={orderText}
        onChange={(event) => {
          const text = event.currentTarget.value;
          setOrderText(text);
          onChange({ ...routing, order: parseUpstreamList(text) });
        }}
        placeholder={t.orderPlaceholder}
        aria-label={t.order}
        spellCheck={false}
        disabled={inactive}
        className="pconn-mono"
        testId={`${prefix}-order`}
      />
      <div className="model-request-openrouter-chips" role="group" aria-label={t.quickPick}>
        {OPENROUTER_UPSTREAM_SUGGESTIONS.map((slug) => {
          const index = routing.order.indexOf(slug);
          const active = index >= 0;
          return (
            <button
              key={slug}
              type="button"
              className={active ? 'model-edit-chip is-active' : 'model-edit-chip'}
              aria-pressed={active}
              disabled={inactive}
              onClick={() => toggleUpstream(slug)}
              data-testid={`${prefix}-chip-${slug}`}
            >
              {active ? <span className="model-request-openrouter-rank">{index + 1}</span> : null}
              {slug}
            </button>
          );
        })}
      </div>
      <label className="model-request-openrouter-flag">
        <input
          type="checkbox"
          checked={!routing.allowFallbacks}
          disabled={inactive || routing.order.length === 0}
          onChange={(event) => onChange({ ...routing, allowFallbacks: !event.currentTarget.checked })}
          data-testid={`${prefix}-no-fallback`}
        />
        <span>{t.noFallback}</span>
      </label>
      <div className="model-request-openrouter-sort">
        <span className="model-request-overrides-hint">{t.sort}</span>
        <SegmentedControl
          size="xs"
          value={routing.sort || 'default'}
          disabled={inactive}
          onChange={(value) =>
            onChange({ ...routing, sort: value === 'default' ? '' : (value as OpenRouterSort) })
          }
          data={[
            { value: 'default', label: t.sortDefault },
            { value: 'price', label: t.sortPrice },
            { value: 'throughput', label: t.sortThroughput },
            { value: 'latency', label: t.sortLatency },
          ]}
          testId={`${prefix}-sort`}
        />
      </div>
      <p className="model-request-overrides-hint">{t.help}</p>
    </div>
  );
}

const ZH = {
  title: 'OpenRouter 上游路由',
  writesTo: '写入请求体 provider 字段',
  blocked: '请先修正下方请求体 JSON，再使用路由设置。',
  order: '上游服务商（按顺序尝试）',
  orderPlaceholder: '上游 slug，按顺序尝试，例如 anthropic, amazon-bedrock',
  quickPick: '常用上游',
  noFallback: '只使用这些上游，不回退到其他服务商',
  sort: '未指定上游时优先',
  sortDefault: '默认',
  sortPrice: '价格',
  sortThroughput: '吞吐',
  sortLatency: '延迟',
  help: '点击常用上游可按顺序添加；完整 slug 列表见 OpenRouter 模型页的 Providers。',
};

const EN: typeof ZH = {
  title: 'OpenRouter upstream routing',
  writesTo: 'Writes the body `provider` field',
  blocked: 'Fix the request body JSON below to use routing.',
  order: 'Upstream providers (tried in order)',
  orderPlaceholder: 'Upstream slugs tried in order, e.g. anthropic, amazon-bedrock',
  quickPick: 'Common upstreams',
  noFallback: 'Only use these upstreams; never fall back to others',
  sort: 'Otherwise prefer',
  sortDefault: 'Default',
  sortPrice: 'Price',
  sortThroughput: 'Throughput',
  sortLatency: 'Latency',
  help: 'Click a common upstream to append it; see a model’s Providers tab on OpenRouter for every slug.',
};
