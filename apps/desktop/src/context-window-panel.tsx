/**
 * Context window visualization panel — embedded in the Right Panel activity tab.
 * Shows a stacked bar breakdown of context usage by category with token counts.
 */
import { useMemo, type ReactElement } from 'react';
import type { ContextUsageSnapshot } from '@piwin/contracts';
import { DEFAULT_MODEL_CONTEXT_WINDOW } from '@piwin/contracts';

export type ContextWindowPanelProps = {
  usage: ContextUsageSnapshot | null;
  modelContextWindow?: number | undefined;
  breakdown?: {
    systemPromptTokens?: number;
    toolDefinitionsTokens?: number;
    rulesTokens?: number;
    skillsTokens?: number;
    mcpTokens?: number;
    conversationTokens?: number;
  };
  locale?: 'zh-CN' | 'en';
};

type Segment = {
  label: string;
  labelZh: string;
  tokens: number;
  color: string;
};

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${Math.round(value / 1000)}K`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return value.toLocaleString();
}

export function ContextWindowPanel(props: ContextWindowPanelProps): ReactElement {
  const locale = props.locale ?? 'zh-CN';

  const limit = useMemo(() => {
    if (typeof props.usage?.tokensLimit === 'number' && props.usage.tokensLimit > 0) {
      return props.usage.tokensLimit;
    }
    if (typeof props.modelContextWindow === 'number' && props.modelContextWindow > 0) {
      return props.modelContextWindow;
    }
    return DEFAULT_MODEL_CONTEXT_WINDOW;
  }, [props.usage?.tokensLimit, props.modelContextWindow]);

  const used = useMemo(() => {
    if (typeof props.usage?.tokensUsed === 'number') return props.usage.tokensUsed;
    if (typeof props.usage?.totalTokens === 'number') return props.usage.totalTokens;
    if (typeof props.usage?.promptTokens === 'number' || typeof props.usage?.completionTokens === 'number') {
      return (props.usage.promptTokens ?? 0) + (props.usage.completionTokens ?? 0);
    }
    return 0;
  }, [props.usage]);

  const breakdown = props.breakdown ?? props.usage?.breakdown;

  const segments: Segment[] = useMemo(() => {
    const raw: Segment[] = [
      { label: 'System', labelZh: '系统提示', tokens: breakdown?.systemPromptTokens ?? 0, color: '#9ca3af' },
      { label: 'Tools', labelZh: '工具定义', tokens: breakdown?.toolDefinitionsTokens ?? 0, color: '#a78bfa' },
      { label: 'Rules', labelZh: '规则', tokens: breakdown?.rulesTokens ?? 0, color: '#34d399' },
      { label: 'Skills', labelZh: '技能', tokens: breakdown?.skillsTokens ?? 0, color: '#fbbf24' },
      { label: 'MCP', labelZh: 'MCP', tokens: breakdown?.mcpTokens ?? 0, color: '#c084fc' },
      { label: 'Conversation', labelZh: '对话', tokens: breakdown?.conversationTokens ?? used, color: '#f87171' },
    ];
    return raw.filter((s) => s.tokens > 0);
  }, [breakdown, used]);

  const ratio = limit > 0 ? Math.min(1, used / limit) : 0;
  const percent = Math.round(ratio * 100);
  const tone = percent >= 90 ? 'critical' : percent >= 70 ? 'warn' : 'ok';

  const title = locale === 'zh-CN' ? '上下文窗口' : 'Context Window';
  const usedLabel = locale === 'zh-CN' ? '已使用' : 'Used';
  const freeLabel = locale === 'zh-CN' ? '剩余' : 'Free';

  return (
    <div className="context-window-panel" data-testid="context-window-panel">
      <header className="context-window-header">
        <h3>{title}</h3>
        <span className={`context-window-percent tone-${tone}`}>{percent}%</span>
      </header>

      {/* Stacked bar */}
      <div className="context-window-bar" role="img" aria-label={`${title}: ${percent}% ${usedLabel}`}>
        {segments.map((seg) => {
          const width = limit > 0 ? (seg.tokens / limit) * 100 : 0;
          return (
            <i
              key={seg.label}
              className="context-window-segment"
              style={{ width: `${Math.max(width, 0.5)}%`, background: seg.color }}
              title={`${locale === 'zh-CN' ? seg.labelZh : seg.label}: ${formatTokens(seg.tokens)}`}
            />
          );
        })}
        <i className="context-window-segment free" style={{ width: `${Math.max(100 - percent, 0)}%` }} />
      </div>

      {/* Summary row */}
      <div className="context-window-summary">
        <span className="muted">
          {usedLabel}: {formatTokens(used)} / {formatTokens(limit)}
        </span>
        <span className="muted">
          {freeLabel}: {formatTokens(Math.max(limit - used, 0))}
        </span>
      </div>

      {/* Segment legend */}
      <ul className="context-window-legend">
        {segments.map((seg) => (
          <li key={seg.label} className="context-window-legend-item">
            <i className="legend-dot" style={{ background: seg.color }} aria-hidden />
            <span className="legend-label">{locale === 'zh-CN' ? seg.labelZh : seg.label}</span>
            <span className="legend-value muted">{formatTokens(seg.tokens)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
