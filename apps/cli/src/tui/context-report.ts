import type { ContextOccupancy, SessionContextPhase } from '@piwin/contracts';
import { computePromptCacheHitRate } from '@piwin/contracts';

const BAR_WIDTH = 24;
const NEAR_LIMIT_RATIO = 0.8;

/** What both a stored measurement and a live usage update say about one request. */
export type RequestUsage = {
  promptTokens?: number | undefined;
  completionTokens?: number | undefined;
  cacheReadTokens?: number | undefined;
  cacheWriteTokens?: number | undefined;
  reasoningTokens?: number | undefined;
  totalTokens?: number | undefined;
  durationMs?: number | undefined;
  firstTokenMs?: number | undefined;
};

export type ContextReportInput = {
  occupancy: ContextOccupancy | undefined;
  phase?: SessionContextPhase;
  /** The latest finished model request of the session. */
  lastRequest: RequestUsage | null;
  model: string;
  thinking?: string;
};

/** The text of `/context`: how full the context window is and what the last request cost. */
export function buildContextReport(input: ContextReportInput): string[] {
  const lines = [...describeOccupancy(input.occupancy, input.phase), ''];
  lines.push(`模型    ${[input.model, input.thinking === undefined ? undefined : `思考 ${input.thinking}`].filter(Boolean).join(' · ')}`);
  lines.push(...describeLastRequest(input.lastRequest));
  return lines;
}

function describeOccupancy(occupancy: ContextOccupancy | undefined, phase: SessionContextPhase | undefined): string[] {
  if (occupancy?.kind !== 'known') {
    const reason = occupancy === undefined || occupancy.reason === 'never-sampled' ? '还没有发过请求' : occupancy.reason;
    return [`上下文  暂无数据（${phase === 'compacting' ? '正在压缩' : reason}）`];
  }
  const lines: string[] = [];
  const quality = occupancy.quality === 'measured' ? '实测' : '估算';
  const coverage = occupancy.coverage === 'partial' ? ' · 仅含部分消息' : '';
  if (occupancy.tokensLimit === undefined) {
    return [`上下文  ${formatTokens(occupancy.tokensUsed)} tokens（窗口大小未知）· ${quality}${coverage}`];
  }
  const ratio = occupancy.tokensUsed / occupancy.tokensLimit;
  lines.push(`上下文  ${renderBar(ratio)} ${Math.round(ratio * 100)}%`);
  lines.push(`        ${formatTokens(occupancy.tokensUsed)} / ${formatTokens(occupancy.tokensLimit)} tokens · ${quality}${coverage}`);
  if (ratio >= NEAR_LIMIT_RATIO) lines.push('        ⚠ 接近上限，可以用 /compact 压缩上下文');
  return lines;
}

function describeLastRequest(request: RequestUsage | null): string[] {
  if (request === null) return ['', '最近一次请求  还没有'];
  const lines = ['', '最近一次请求'];
  const prompt = request.promptTokens;
  const output = request.completionTokens;
  const reasoning = request.reasoningTokens;
  const parts = [
    prompt === undefined ? undefined : `输入 ${formatTokens(prompt)}`,
    output === undefined
      ? undefined
      : `输出 ${formatTokens(output)}${reasoning === undefined || reasoning === 0 ? '' : `（其中推理 ${formatTokens(reasoning)}）`}`,
  ].filter((part): part is string => part !== undefined);
  if (request.totalTokens !== undefined) parts.push(`合计 ${formatTokens(request.totalTokens)}`);
  lines.push(`  ${parts.join(' · ')}`);
  const cacheRead = request.cacheReadTokens ?? 0;
  const cacheWrite = request.cacheWriteTokens ?? 0;
  const hitRate = computePromptCacheHitRate({
    promptTokens: prompt ?? 0,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
  });
  if (hitRate !== null && (cacheRead > 0 || cacheWrite > 0)) {
    lines.push(`  缓存命中 ${Math.round(hitRate * 100)}%（读 ${formatTokens(cacheRead)} · 写 ${formatTokens(cacheWrite)}）`);
  }
  const timing = [
    request.durationMs === undefined ? undefined : `耗时 ${formatSeconds(request.durationMs)}`,
    request.firstTokenMs === undefined ? undefined : `首字 ${formatSeconds(request.firstTokenMs)}`,
  ].filter((part): part is string => part !== undefined);
  if (timing.length > 0) lines.push(`  ${timing.join(' · ')}`);
  return lines;
}

function renderBar(ratio: number): string {
  const clamped = Math.min(1, Math.max(0, ratio));
  const filled = Math.round(clamped * BAR_WIDTH);
  return `[${'█'.repeat(filled)}${'░'.repeat(BAR_WIDTH - filled)}]`;
}

export function formatTokens(count: number): string {
  if (count < 1_000) return String(Math.round(count));
  if (count < 1_000_000) return `${(count / 1_000).toFixed(1)}k`;
  return `${(count / 1_000_000).toFixed(2)}M`;
}

function formatSeconds(milliseconds: number): string {
  return `${(milliseconds / 1_000).toFixed(1)}s`;
}
