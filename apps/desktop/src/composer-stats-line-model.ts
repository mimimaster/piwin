/**
 * Composer stats line (below the composer card): the session's turns, model
 * requests, generation speed, cumulative tokens and prompt-cache hit rate,
 * followed by whatever Pi extensions publish (ADR 0080). Pure: the component
 * only renders these segments.
 */
import {
  computePromptCacheHitRate,
  computeTokensPerSecond,
  type ExtensionUiSurfaceSnapshot,
  type SessionUsageTotals,
} from '@piwin/contracts';
import type { ContextRingLastRequest } from './context-telemetry-selector.js';
import { formatUsageTokenCount, type ConversationUsageLocale } from './conversation-usage-copy.js';

export type ComposerStatsSegment =
  | { kind: 'activity'; text: string; title: string }
  | { kind: 'tokens'; text: string; title: string }
  | { kind: 'extension'; key: string; text: string; working: boolean };

export type ComposerStatsLineInput = {
  totals: SessionUsageTotals | null;
  lastRequest?: ContextRingLastRequest | undefined;
  extensionSurface?: ExtensionUiSurfaceSnapshot | null | undefined;
  locale: ConversationUsageLocale;
};

/**
 * Output tokens per second of the latest request. Delegates to the shared
 * contracts rule so a buffered flush (tiny decode window) falls back to the
 * end-to-end duration instead of showing thousands of tok/s.
 */
export function generationTokensPerSecond(
  request: Pick<ContextRingLastRequest, 'completionTokens' | 'durationMs' | 'firstTokenMs'> | undefined,
): number | null {
  if (!request || typeof request.completionTokens !== 'number') return null;
  return computeTokensPerSecond({
    completionTokens: request.completionTokens,
    ...(request.durationMs !== undefined ? { durationMs: request.durationMs } : {}),
    ...(request.firstTokenMs !== undefined ? { firstTokenMs: request.firstTokenMs } : {}),
  });
}

export function buildComposerStatsSegments(input: ComposerStatsLineInput): ComposerStatsSegment[] {
  const zh = input.locale === 'zh-CN';
  const segments: ComposerStatsSegment[] = [];
  const totals = input.totals;

  if (totals && totals.entryCount > 0) {
    const parts = [
      zh ? `${totals.userTurnCount} 轮` : `${totals.userTurnCount} ${totals.userTurnCount === 1 ? 'turn' : 'turns'}`,
      zh ? `${totals.entryCount} 步` : `${totals.entryCount} ${totals.entryCount === 1 ? 'step' : 'steps'}`,
    ];
    // The session read carries the latest request's timing and refreshes on
    // every usage push; the context ring's copy is only filled on hydrate.
    const speed = generationTokensPerSecond(totals.latestRequest ?? input.lastRequest);
    if (speed !== null) parts.push(`${Math.round(speed)} tok/s`);
    segments.push({
      kind: 'activity',
      text: parts.join(' · '),
      title: zh
        ? '轮 = 你发出的消息数；步 = 模型请求次数；速度取最近一次请求的生成阶段'
        : 'Turns = messages you sent; steps = model requests; speed is the latest request’s generation phase',
    });

    const hitRate = computePromptCacheHitRate(totals);
    const tokenParts = [`${formatUsageTokenCount(totals.totalTokens)} tok`];
    if (hitRate !== null) {
      tokenParts.push(zh ? `缓存命中 ${Math.round(hitRate * 100)}%` : `cache ${Math.round(hitRate * 100)}%`);
    }
    segments.push({
      kind: 'tokens',
      text: tokenParts.join(' · '),
      title: zh
        ? '本会话累计 token；缓存命中 = 缓存读取 ÷ 全部输入'
        : 'Session total tokens; cache hit = cache reads ÷ all input',
    });
  }

  const surface = input.extensionSurface;
  if (surface?.workingMessage !== undefined) {
    segments.push({ kind: 'extension', key: 'working-message', text: surface.workingMessage, working: true });
  }
  for (const status of surface?.statuses ?? []) {
    segments.push({ kind: 'extension', key: status.key, text: status.text, working: false });
  }
  return segments;
}
