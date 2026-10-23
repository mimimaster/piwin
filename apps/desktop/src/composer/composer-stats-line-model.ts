/**
 * Composer status bar (below the composer card), three sections:
 * Pi extension status │ this turn (elapsed · first token · speed) │
 * resources (context bar · turns · tokens · cache · cost). Pure; the component only
 * renders it. Metrics come from the shared contracts helper the CLI uses too.
 */
import {
  buildStatusMetrics,
  computeTokensPerSecond,
  formatCompactTokens,
  formatStatusSeconds,
  formatStatusUsd,
  type ExtensionUiSurfaceSnapshot,
  type SessionUsageTotals,
  type StatusTone,
} from '@piwin/contracts';
import type { ContextRingLastRequest } from '../context/context-telemetry-selector.js';
import type { ConversationUsageLocale } from '../conversation/conversation-usage-copy.js';

export type ComposerStatusItemKey = 'elapsed' | 'ttft' | 'tps' | 'turns' | 'tokens' | 'cache' | 'cost';

/** Priority 2 hides in a narrow bar, 3 already in a medium one (container queries). */
export type ComposerStatusItem = {
  key: ComposerStatusItemKey;
  text: string;
  label?: string;
  title: string;
  priority: 2 | 3;
  tone?: StatusTone;
  running?: boolean;
};

export type ComposerStatusExtension = { key: string; text: string; working: boolean };

export type ComposerStatusBar = {
  extensions: ComposerStatusExtension[];
  turn: ComposerStatusItem[];
  resources: ComposerStatusItem[];
};

export type ComposerStatsLineInput = {
  totals: SessionUsageTotals | null;
  lastRequest?: ContextRingLastRequest | undefined;
  extensionSurface?: ExtensionUiSurfaceSnapshot | null | undefined;
  locale: ConversationUsageLocale;
  /** Elapsed time of the turn in flight; undefined when idle. */
  runningElapsedMs?: number | undefined;
};

/**
 * Output tokens per second of the latest request. Delegates to the shared
 * contracts rule so a buffered flush (tiny decode window) falls back to the
 * end-to-end duration instead of showing thousands of tok/s.
 */
export function generationTokensPerSecond(
  request:
    | Pick<
        ContextRingLastRequest,
        'completionTokens' | 'durationMs' | 'firstTokenMs' | 'reasoningTokens' | 'firstTokenKind'
      >
    | undefined,
): number | null {
  if (!request || typeof request.completionTokens !== 'number') return null;
  return computeTokensPerSecond({
    completionTokens: request.completionTokens,
    ...(request.durationMs !== undefined ? { durationMs: request.durationMs } : {}),
    ...(request.firstTokenMs !== undefined ? { firstTokenMs: request.firstTokenMs } : {}),
    ...(request.reasoningTokens !== undefined ? { reasoningTokens: request.reasoningTokens } : {}),
    ...(request.firstTokenKind !== undefined ? { firstTokenKind: request.firstTokenKind } : {}),
  });
}

function formatRunning(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return total < 60 ? `${total}s` : `${Math.floor(total / 60)}m${String(total % 60).padStart(2, '0')}s`;
}

export function buildComposerStatusBar(input: ComposerStatsLineInput): ComposerStatusBar {
  const zh = input.locale === 'zh-CN';
  const totals = input.totals && input.totals.entryCount > 0 ? input.totals : null;
  // The session read carries the latest request's timing and refreshes on
  // every usage push; the context ring's copy is only filled on hydrate.
  const metrics = buildStatusMetrics({ totals, lastRequest: totals?.latestRequest ?? input.lastRequest });
  const counts = totals
    ? zh
      ? `${totals.userTurnCount} 轮 · ${totals.entryCount} 步`
      : `${totals.userTurnCount} ${totals.userTurnCount === 1 ? 'turn' : 'turns'} · ${totals.entryCount} ${totals.entryCount === 1 ? 'step' : 'steps'}`
    : undefined;

  const turn: ComposerStatusItem[] = [];
  if (input.runningElapsedMs !== undefined) {
    turn.push({
      key: 'elapsed', running: true, priority: 2,
      text: formatRunning(input.runningElapsedMs),
      label: zh ? '进行中' : 'running',
      title: zh ? '本轮已用时间' : 'Time spent on this turn',
    });
  } else if (metrics.lastDurationMs !== undefined) {
    turn.push({
      key: 'elapsed', priority: 2,
      text: formatStatusSeconds(metrics.lastDurationMs),
      label: zh ? '上轮' : 'last',
      title: [zh ? '最近一次模型请求用时' : 'Duration of the latest model request', counts].filter(Boolean).join('\n'),
    });
  }
  if (metrics.ttftMs !== undefined) {
    turn.push({
      key: 'ttft', priority: 2,
      text: formatStatusSeconds(metrics.ttftMs),
      label: zh ? '首字' : 'TTFT',
      title: zh ? '首字延迟：发出请求到收到第一个 token' : 'Time to first token of the latest request',
      ...(metrics.ttftTone && metrics.ttftTone !== 'ok' ? { tone: metrics.ttftTone } : {}),
    });
  }
  if (metrics.tokensPerSecond !== undefined) {
    turn.push({
      key: 'tps', priority: 2,
      text: `${Math.round(metrics.tokensPerSecond)} tok/s`,
      title: zh ? '最近一次请求的生成速度（不含首字等待）' : 'Generation speed of the latest request, excluding the first-token wait',
    });
  }

  const resources: ComposerStatusItem[] = [];
  if (metrics.userTurnCount !== undefined) {
    const turnCount = metrics.userTurnCount;
    resources.push({
      key: 'turns', priority: 3,
      text: zh ? `${turnCount} 轮` : `${turnCount} ${turnCount === 1 ? 'turn' : 'turns'}`,
      title: [zh ? '本会话用户轮数' : 'User turns in this session', counts].filter(Boolean).join('\n'),
    });
  }
  if (totals && metrics.inputTokens !== undefined && metrics.outputTokens !== undefined) {
    resources.push({
      key: 'tokens', priority: 3,
      text: `↑${formatCompactTokens(metrics.inputTokens)} ↓${formatCompactTokens(metrics.outputTokens)}`,
      title: [
        zh ? `本会话累计 ${formatCompactTokens(totals.totalTokens)} tok（↑输入含缓存 · ↓输出）` : `Session total ${formatCompactTokens(totals.totalTokens)} tok (↑ input incl. cache · ↓ output)`,
        counts,
      ].filter(Boolean).join('\n'),
    });
  }
  if (metrics.cacheHitRate !== undefined) {
    resources.push({
      key: 'cache', priority: 3,
      text: `${Math.round(metrics.cacheHitRate * 100)}%`,
      label: zh ? '缓存' : 'cache',
      title: zh ? '缓存命中 = 缓存读取 ÷ 全部输入' : 'Cache hit = cache reads ÷ all input',
    });
  }
  // Shown whenever the Host priced at least one request; unpriced sessions omit it.
  if (metrics.costUsd !== undefined) {
    resources.push({
      key: 'cost', priority: 3,
      text: formatStatusUsd(metrics.costUsd),
      title: zh ? '按当前价格估算的本会话费用' : 'Estimated session cost at current prices',
    });
  }

  const extensions: ComposerStatusExtension[] = [];
  const surface = input.extensionSurface;
  if (surface?.workingMessage !== undefined) {
    extensions.push({ key: '__working__', text: surface.workingMessage, working: true });
  }
  for (const status of surface?.statuses ?? []) {
    extensions.push({ key: status.key, text: status.text, working: false });
  }
  return { extensions, turn, resources };
}
