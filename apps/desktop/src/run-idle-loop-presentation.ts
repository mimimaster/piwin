/**
 * Pure copy/state projection for the idle-loop card
 * (docs/plans/2026-09-28-run-idle-loop-notice.md). Kept separate from the
 * component so the three states and the diagnostics text are unit-tested.
 */

import type { ModelRef, RunIdleLoopNotice } from '@piwin/contracts';

/** looping (live) · recovered · ended while still looping. */
export type RunIdleLoopCardVariant = 'looping' | 'recovered' | 'ended';

export type RunIdleLoopCardView = {
  variant: RunIdleLoopCardVariant;
  title: string;
  tag: string;
  body: string;
  /** Loop calls with counts; empty for the recovered state. */
  calls: RunIdleLoopNotice['calls'];
  meta: string;
  /** Per-call repeat count, e.g. "11 次" (no glyph icons; shell icon policy). */
  countLabel: (count: number) => string;
  dismissLabel: string;
  copyLabel: string;
  copiedLabel: string;
  diagnostics: string;
};

export function presentRunIdleLoopCard(input: {
  notice: RunIdleLoopNotice;
  runEnded: boolean;
  model?: ModelRef | undefined;
  locale?: string | undefined;
}): RunIdleLoopCardView {
  const zh = input.locale === undefined || input.locale.startsWith('zh');
  const { notice } = input;
  const variant: RunIdleLoopCardVariant =
    notice.state === 'recovered' ? 'recovered' : input.runEnded ? 'ended' : 'looping';
  const duration = formatDuration(notice.detectedAt, notice.updatedAt, zh);
  const range = `${notice.firstToolIndex}–${notice.lastToolIndex}`;
  const model = input.model ? `${input.model.providerId} · ${input.model.modelId}` : undefined;
  const count = notice.repeatedCalls;

  const title =
    variant === 'recovered'
      ? zh ? '曾疑似空转，之后已恢复' : 'Idle loop, since recovered'
      : variant === 'ended'
        ? zh ? `疑似空转 · 运行已结束` : 'Idle loop · run ended'
        : zh ? '疑似空转' : 'Possible idle loop';
  const tag =
    variant === 'recovered'
      ? zh ? `第 ${range} 次调用` : `calls ${range}`
      : zh ? `已重复 ${count} 次` : `${count} repeats`;
  const body =
    variant === 'recovered'
      ? zh
        ? `这段时间重复了 ${count} 次相同调用，之后模型开始了新的调用。`
        : `It repeated the same calls ${count} times, then started new work.`
      : variant === 'ended'
        ? zh
          ? `直到结束，模型都在重复同样的调用，共 ${count} 次。可以换个模型重试，或把诊断信息反馈给 provider。`
          : `The model repeated the same calls ${count} times until the run ended. Try another model, or send the diagnostics to the provider.`
        : zh
          ? `模型在反复执行同样的调用，已重复 ${count} 次，任务没有推进。这通常是 provider 或模型侧的问题（上下文丢失、服务端异常），piwin 不会中止这次运行。`
          : `The model keeps making the same calls (${count} so far) without progress. This is usually a provider or model problem (lost context, server fault). piwin will not stop the run.`;
  const metaParts = [
    ...(model ? [model] : []),
    zh ? `第 ${range} 次工具调用` : `tool calls ${range}`,
    ...(duration
      ? [variant === 'looping' ? (zh ? `已持续 ${duration}` : `for ${duration}`) : zh ? `共 ${duration}` : duration]
      : []),
  ];

  const diagnostics = [
    'piwin idle-loop notice',
    `state: ${variant}`,
    ...(model ? [`model: ${model}`] : []),
    `repeated calls: ${count}`,
    `tool calls: ${range}`,
    `detected: ${notice.detectedAt}`,
    `updated: ${notice.updatedAt}`,
    ...notice.calls.map((call) => `  ${call.toolName} ×${call.count}: ${call.preview}`),
  ].join('\n');

  return {
    variant,
    title,
    tag,
    body,
    calls: variant === 'recovered' ? [] : notice.calls,
    meta: metaParts.join(' · '),
    countLabel: (value) => (zh ? `${value} 次` : `${value} times`),
    dismissLabel: zh ? '关闭提示' : 'Dismiss notice',
    copyLabel: zh ? '复制诊断' : 'Copy diagnostics',
    copiedLabel: zh ? '已复制' : 'Copied',
    diagnostics,
  };
}

function formatDuration(fromIso: string, toIso: string, zh: boolean): string | undefined {
  const ms = Date.parse(toIso) - Date.parse(fromIso);
  if (!Number.isFinite(ms) || ms < 1_000) return undefined;
  const totalSeconds = Math.round(ms / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return zh ? `${seconds} 秒` : `${seconds}s`;
  return zh ? `${minutes} 分 ${seconds} 秒` : `${minutes}m ${seconds}s`;
}
