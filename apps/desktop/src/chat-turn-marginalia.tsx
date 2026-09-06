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

/**
 * Short, clean label for display in marginalia.
 *
 * Normalizes vendor prefixes, snapshot dates, and version patterns:
 * - 'claude-3-7-sonnet-20250219' → 'Sonnet 3.7'
 * - 'claude-sonnet-4-6' → 'Sonnet 4.6'
 * - 'gemini-2-5-pro' → 'Gemini 2.5 Pro'
 * - 'deepseek-reasoner' → 'DeepSeek R1'
 * - 'deepseek-chat' → 'DeepSeek V3'
 * - 'openai-gpt-5-4' → 'GPT-5.4'
 * - 'gpt-4o-2024-11-20' → 'GPT-4o'
 */
export function shortModelLabel(modelId: string): string {
  if (!modelId) return '';
  const trimmed = modelId.trim();

  // Strip org prefix before slash (e.g. 'anthropic/claude-3-7-sonnet' -> 'claude-3-7-sonnet')
  const afterSlash = trimmed.split(/[\\/]/).pop() ?? trimmed;

  // Specific canonical mappings first
  if (/^deepseek-reasoner/i.test(afterSlash)) return 'DeepSeek R1';
  if (/^deepseek-chat/i.test(afterSlash)) return 'DeepSeek V3';

  // Strip date stamps at the end: e.g. -20250219, -2024-11-20, -20241022, -01-21, -latest, -preview
  const clean = afterSlash
    .replace(/[-_]\d{4}[-_]\d{2}[-_]\d{2}$/, '')
    .replace(/[-_]\d{8}$/, '')
    .replace(/[-_]\d{2}-\d{2}$/, '')
    .replace(/[-_](latest|preview|exp)$/i, '');

  // Claude: claude-3-7-sonnet -> Sonnet 3.7; claude-sonnet-4-6 -> Sonnet 4.6
  const claudeMatch = clean.match(/^claude-(?:(\d+)[-_](\d+)[-_])?([a-z]+)(?:[-_](\d+)(?:[-_](\d+))?)?/i);
  if (claudeMatch) {
    const major = claudeMatch[1] ?? claudeMatch[4];
    const minor = claudeMatch[2] ?? claudeMatch[5];
    const familyRaw = claudeMatch[3] ?? '';
    const family = familyRaw.charAt(0).toUpperCase() + familyRaw.slice(1).toLowerCase();
    if (major && minor) return `${family} ${major}.${minor}`;
    if (major) return `${family} ${major}`;
    if (family) return family;
  }

  // Gemini: gemini-2-5-pro -> Gemini 2.5 Pro; gemini-2.0-flash... -> Gemini 2.0 Flash
  const geminiMatch = clean.match(/^gemini[-_](\d+)(?:[._-](\d+))?[-_]([a-z]+)/i);
  if (geminiMatch) {
    const major = geminiMatch[1];
    const minor = geminiMatch[2] ?? '0';
    const tierRaw = geminiMatch[3] ?? '';
    const tier = tierRaw.charAt(0).toUpperCase() + tierRaw.slice(1).toLowerCase();
    return `Gemini ${major}.${minor} ${tier}`;
  }

  // GPT: gpt-4o, gpt-4o-mini, gpt-5-4, openai-gpt-5-4
  const gptMatch = clean.match(/^(?:openai[-_])?gpt[-_]([0-9a-z.-]+)/i);
  if (gptMatch) {
    const rest = gptMatch[1] ?? '';
    if (/^\d+[-_.]\d+$/.test(rest)) {
      return `GPT-${rest.replace(/[-_]/g, '.')}`;
    }
    if (/^4o[-_]mini$/i.test(rest)) return 'GPT-4o mini';
    if (/^4o$/i.test(rest)) return 'GPT-4o';
    return `GPT-${rest}`;
  }

  // o1 / o3: o1-mini, o3-mini, o1
  if (/^o[13](?:-mini)?$/i.test(clean)) {
    return clean;
  }

  // DeepSeek: DeepSeek-V3, DeepSeek-R1
  const dsMatch = clean.match(/^deepseek[-_](r1|v3)/i);
  if (dsMatch) {
    const ver = dsMatch[1]?.toUpperCase() ?? '';
    return `DeepSeek ${ver}`;
  }

  // Fallback cleanup: strip leading vendor prefixes
  const stripped = clean.replace(/^(claude|anthropic|openai|google|gemini|deepseek|gpt)-/i, '');
  const parts = stripped.split(/[-_.]/).filter(Boolean);
  if (parts.length === 0) return clean;
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
  modelId?: string,
  providerId?: string,
  themeId?: string,
): string {
  const target = `${providerId ?? ''} ${modelId ?? ''}`.toLowerCase();
  if (target.includes('claude') || target.includes('anthropic')) return 'C';
  if (target.includes('gemini') || target.includes('google')) return 'G';
  if (target.includes('deepseek')) return 'D';
  if (target.includes('qwen')) return 'Q';
  if (target.includes('openai') || target.includes('gpt') || target.includes('o1') || target.includes('o3')) return 'O';
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
  fullModelId?: string | null | undefined;
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
      who: options?.locale === 'en' ? 'You' : '你',
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
    fullModelId: modelId.length > 0 ? modelId : label,
    avatar,
    clock: formatTurnClock(assistantMsg?.createdAt ?? ''),
    usage,
    ...(options?.status ? { status: options.status } : {}),
  };
}

export function ChatTurnMarginalia(props: { data: TurnMarginaliaData }): ReactElement {
  const { data } = props;
  const isAssistant = data.avatar !== null;
  return (
    <aside
      className={`marg chat-marginalia ${isAssistant ? 'is-assistant' : 'is-user'}`}
      aria-hidden="true"
    >
      {data.avatar !== null ? <div className="av">{data.avatar}</div> : null}
      <span
        className={isAssistant ? 'who' : 'who is-user'}
        {...(data.fullModelId ? { title: data.fullModelId } : {})}
      >
        {data.who}
      </span>
      {data.clock.length > 0 ? <span>{data.clock}</span> : null}
      {data.usage !== null ? <span>{data.usage}</span> : null}
      {data.status ? <span data-st="status">{data.status}</span> : null}
    </aside>
  );
}

export function ChatTurnHead(props: { data: TurnMarginaliaData }): ReactElement {
  const { data } = props;
  const isAssistant = data.avatar !== null;
  return (
    <div
      className={`head chat-turn-head ${isAssistant ? 'is-assistant' : 'is-user'}`}
      aria-hidden="true"
    >
      {data.avatar !== null ? <span className="av">{data.avatar}</span> : null}
      <span
        className={isAssistant ? 'who' : 'who is-user'}
        {...(data.fullModelId ? { title: data.fullModelId } : {})}
      >
        {data.who}
      </span>
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
