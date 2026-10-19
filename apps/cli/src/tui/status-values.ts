import {
  contextBar,
  formatCompactTokens,
  formatStatusSeconds,
  formatStatusUsd,
  type StatusMetrics,
  type StatusTone,
} from '@piwin/contracts';
import type { StatusValues } from './status-template.js';
import { describeRunPhase, formatElapsed } from './status-line.js';
import type { createStyle } from './tui-style.js';

type Style = ReturnType<typeof createStyle>;

export type StatusMetricValuesInput = {
  metrics: StatusMetrics;
  style: Style;
  /** The turn in flight, if any. */
  running?: { phase: string | undefined; elapsedMs: number } | undefined;
  compacting?: boolean;
  showCost?: boolean;
};

function tone(style: Style, value: StatusTone | undefined, text: string): string {
  if (value === 'critical') return style.bold(style.red(text));
  if (value === 'warn') return style.yellow(text);
  return text;
}

/** The turn and resource fields of the status line, with dim labels and threshold colours. */
export function buildStatusMetricValues(input: StatusMetricValuesInput): StatusValues {
  const { metrics, style } = input;
  const label = (text: string) => style.gray(text);
  const values: StatusValues = {};
  if (input.running !== undefined) {
    values.elapsed = `${style.green('●')} ${describeRunPhase(input.running.phase)} ${formatElapsed(input.running.elapsedMs)}`;
  } else if (metrics.lastDurationMs !== undefined) {
    values.elapsed = `${label('上轮')} ${formatStatusSeconds(metrics.lastDurationMs)}`;
  }
  if (metrics.ttftMs !== undefined) values.ttft = `${label('首字')} ${tone(style, metrics.ttftTone, formatStatusSeconds(metrics.ttftMs))}`;
  if (metrics.tokensPerSecond !== undefined) values.tps = `${Math.round(metrics.tokensPerSecond)} ${label('tok/s')}`;
  if (input.compacting === true) {
    const text = style.yellow('⟳ 压缩中');
    values.context = text;
    values.ctx = text;
    values.ctxbar = text;
  } else if (metrics.context !== undefined) {
    const { ratio, used, limit, estimated } = metrics.context;
    const percent = `${estimated ? '~' : ''}${Math.round(ratio * 100)}%`;
    const amounts = label(`${formatCompactTokens(used)}/${formatCompactTokens(limit)}`);
    values.context = `${label('ctx')} ${tone(style, metrics.context.tone, percent)}`;
    values.ctx = `${values.context} ${amounts}`;
    values.ctxbar = `${label('ctx')} ${tone(style, metrics.context.tone, `${contextBar(ratio)} ${percent}`)} ${amounts}`;
  }
  if (metrics.userTurnCount !== undefined) values.turns = `${metrics.userTurnCount} ${label('轮')}`;
  if (metrics.inputTokens !== undefined && metrics.outputTokens !== undefined) {
    values.tokens = `${label('↑')}${formatCompactTokens(metrics.inputTokens)} ${label('↓')}${formatCompactTokens(metrics.outputTokens)}`;
  }
  if (metrics.cacheHitRate !== undefined) values.cache = `${label('缓存')} ${Math.round(metrics.cacheHitRate * 100)}%`;
  if (input.showCost === true && metrics.costUsd !== undefined) values.cost = formatStatusUsd(metrics.costUsd);
  return values;
}
