import type { ReactElement } from 'react';
import type { ContextUsageSnapshot, ModelRef } from '@piwin/contracts';
import type { ChatMessageUi } from './chat-reducer';

/**
 * Inkstone turn marginalia (proto-01 §1 block 06).
 *
 * One column-left rail per turn: who produced it, when, and what it cost.
 * Sticky inside the turn so it pins while that turn scrolls past. The inline
 * head is the same data for narrow stages. CSS shows the rail via
 * `@container transcript-stage (min-width: 1080px)` on `.chat-stage`
 * (proto-01 `.stage`), never on the scrollport — querying the scrollport
 * oscillates at the threshold.
 */

export function formatTurnClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** 'claude-sonnet-4-6' → 'Sonnet 4.6'; 'gpt-5.4' → 'GPT-5.4'; fallback: capitalize. */
export function shortModelLabel(modelId: string): string {
  const stripped = modelId.replace(/^(claude|anthropic|openai|google|gemini|deepseek|gpt)-/i, '');
  const parts = stripped.split(/[-_.]/).filter(Boolean);
  if (parts.length === 0) return modelId;
  const head = parts[0] ?? '';
  const tailParts = parts.slice(1);
  const name = head.charAt(0).toUpperCase() + head.slice(1);
  if (tailParts.length === 0) return name;
  const tail = tailParts.every((p) => /^\d+$/.test(p))
    ? tailParts.join('.')
    : tailParts.join(' ');
  return `${name} ${tail}`;
}

export function resolveModelAvatarInitial(
  _modelId?: string,
  _providerId?: string,
  themeId?: string,
): string {
  if (themeId && !themeId.includes('inkstone')) {
    return '智';
  }
  return '墨';
}

export function formatTokensK(tokens: number): string {
  if (tokens >= 1000) {
    const k = tokens / 1000;
    return `${k >= 10 ? Math.round(k) : k.toFixed(1)}k`;
  }
  return String(tokens);
}

export function formatDurationSeconds(ms: number): string {
  const sec = Math.round(ms / 1000);
  return `${sec}s`;
}

export type TurnMarginaliaData = {
  who: string;
  avatar: string | null;
  clock: string;
  usage: string | null;
  status?: string | null;
};

export type ResolveTurnMarginaliaOptions = {
  editingMessageId?: string | null | undefined;
  locale?: 'zh-CN' | 'en' | undefined;
  elapsedMs?: number | undefined;
  contextUsage?: ContextUsageSnapshot | null | undefined;
  status?: string | null | undefined;
  model?: ModelRef | null | undefined;
  forceRole?: 'user' | 'assistant' | undefined;
  themeId?: string | undefined;
};

export function resolveTurnMarginalia(
  messages: readonly ChatMessageUi[],
  options?: ResolveTurnMarginaliaOptions,
): TurnMarginaliaData {
  const lead = messages[0];
  const isAssistant =
    options?.forceRole === 'assistant' ||
    (options?.forceRole === undefined && lead !== undefined && lead.role === 'assistant');

  if (!isAssistant) {
    const isEditing = Boolean(
      options?.editingMessageId &&
        messages.some((m) => m.id === options.editingMessageId),
    );
    const isIntervention = lead?.instructionDelivery !== undefined;
    const isChinese = options?.locale !== 'en';
    const usage = isEditing
      ? isChinese
        ? '编辑中'
        : 'Editing'
      : isIntervention
        ? isChinese
          ? '介入'
          : 'Intervention'
        : null;
    return {
      who: options?.locale === 'en' ? 'You' : '我',
      avatar: null,
      clock: formatTurnClock(lead?.createdAt ?? ''),
      usage,
    };
  }

  // Find the assistant message in the turn (could be lead or subsequent)
  const assistantMsg = messages.find((m) => m.role === 'assistant') ?? lead;
  const model = assistantMsg?.model ?? options?.model ?? null;
  const modelId = model?.modelId ?? '';
  const label = modelId.length > 0 ? shortModelLabel(modelId) : 'piwin';
  const avatar = resolveModelAvatarInitial(modelId, model?.providerId, options?.themeId);

  const tokens =
    options?.contextUsage?.totalTokens ??
    options?.contextUsage?.completionTokens ??
    options?.contextUsage?.promptTokens;

  const durationMs =
    options?.elapsedMs !== undefined
      ? options.elapsedMs
      : assistantMsg?.thinkingStartedAt && assistantMsg?.thinkingEndedAt
        ? assistantMsg.thinkingEndedAt - assistantMsg.thinkingStartedAt
        : undefined;

  const totalTools = messages.reduce((acc, m) => acc + (m.tools?.length ?? 0), 0);

  let usage: string | null = null;
  if (tokens !== undefined && durationMs !== undefined && durationMs > 0) {
    usage = `${formatTokensK(tokens)} · ${formatDurationSeconds(durationMs)}`;
  } else if (durationMs !== undefined && durationMs > 0 && totalTools > 0) {
    usage = `${formatDurationSeconds(durationMs)} · ${totalTools} 工具`;
  } else if (durationMs !== undefined && durationMs > 0) {
    usage = formatDurationSeconds(durationMs);
  } else if (totalTools > 0) {
    usage = `${totalTools} 工具`;
  } else if (tokens !== undefined) {
    usage = formatTokensK(tokens);
  }

  return {
    who: label,
    avatar,
    clock: formatTurnClock(assistantMsg?.createdAt ?? ''),
    usage,
    ...(options?.status ? { status: options.status } : {}),
  };
}

export function ChatTurnMarginalia(props: { data: TurnMarginaliaData }): ReactElement {
  const { data } = props;
  return (
    <aside className="marg chat-marginalia" aria-hidden="true">
      {data.avatar !== null ? <div className="av">{data.avatar}</div> : null}
      <span className={data.avatar !== null ? 'who' : 'who is-user'}>{data.who}</span>
      {data.clock.length > 0 ? <span>{data.clock}</span> : null}
      {data.usage !== null ? <span>{data.usage}</span> : null}
      {data.status ? <span data-st="status">{data.status}</span> : null}
    </aside>
  );
}

export function ChatTurnHead(props: { data: TurnMarginaliaData }): ReactElement {
  const { data } = props;
  return (
    <div className="head chat-turn-head" aria-hidden="true">
      {data.avatar !== null ? <span className="av">{data.avatar}</span> : null}
      <span className={data.avatar !== null ? 'who' : 'who is-user'}>{data.who}</span>
      {data.clock.length > 0 ? <span>{data.clock}</span> : null}
      {data.usage !== null ? <span>{data.usage}</span> : null}
      {data.status ? <span data-st="status">{data.status}</span> : null}
    </div>
  );
}

/** proto-00 `.colo-meta`: "Sonnet 4.6 · 本轮消耗 1.8k tokens" */
export function buildAssistantColophonMeta(input: {
  message: ChatMessageUi;
  locale: 'zh-CN' | 'en';
  contextUsage?: ContextUsageSnapshot | null | undefined;
}): string | null {
  const modelId = input.message.model?.modelId;
  const label = modelId && modelId.length > 0 ? shortModelLabel(modelId) : null;
  const tokens =
    input.contextUsage?.totalTokens ??
    input.contextUsage?.completionTokens ??
    input.contextUsage?.promptTokens;

  if (label && typeof tokens === 'number' && tokens > 0) {
    return input.locale === 'zh-CN'
      ? `${label} · 本轮消耗 ${formatTokensK(tokens)} tokens`
      : `${label} · ${formatTokensK(tokens)} tokens this turn`;
  }
  if (label) return label;
  if (typeof tokens === 'number' && tokens > 0) {
    return input.locale === 'zh-CN'
      ? `本轮消耗 ${formatTokensK(tokens)} tokens`
      : `${formatTokensK(tokens)} tokens this turn`;
  }
  return null;
}
