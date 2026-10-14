/**
 * Plain-text helpers for a subagent's report and work counters, shared by
 * every shell (Desktop rows/preview, TUI fan-out/preview).
 */

/**
 * A scheme report contract opens the child's last message with a verdict line
 * (`complete`, `done`, `pass`). After 「已完成」 that word only repeats the
 * status, so drop it (and the bullet it leaves leading). Other verdicts
 * (`partial`, `blocked`, …) carry news and stay.
 */
export function withoutSuccessVerdict(value: string): string {
  const match = /^\s*(?:complete|done|pass)[ \t]*(?:\r?\n|$)/i.exec(value);
  if (!match) return value;
  return value.slice(match[0].length).replace(/^\s*[-*•]\s+/, '');
}

/** First non-blank line, whitespace-collapsed; empty when there is none. */
export function firstTextLine(value: string | undefined): string {
  if (!value) return '';
  for (const line of value.split(/\r?\n/)) {
    const text = line.replace(/\s+/g, ' ').trim();
    if (text) return text;
  }
  return '';
}

export type SubagentTextLocale = 'zh-CN' | 'en';

/** `830 tok`, `4.2k tok`, `38k tok`; empty for an invalid count. */
export function formatSubagentTokens(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens < 0) return '';
  if (tokens < 1000) return `${Math.round(tokens)} tok`;
  return `${(tokens / 1000).toFixed(tokens >= 10_000 ? 0 : 1)}k tok`;
}

/** Row meta piece: `3 工具` / `3 tools`. */
export function formatSubagentToolCount(count: number, locale: SubagentTextLocale): string {
  return locale === 'zh-CN' ? `${count} 工具` : `${count} tool${count === 1 ? '' : 's'}`;
}

/** Detail line: `3 次工具调用` / `3 tool calls`. */
export function formatSubagentToolCalls(count: number, locale: SubagentTextLocale): string {
  return locale === 'zh-CN' ? `${count} 次工具调用` : `${count} tool call${count === 1 ? '' : 's'}`;
}
